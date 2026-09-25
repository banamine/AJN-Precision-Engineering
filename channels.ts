import { archiveApiFetch } from './server/archiveLimiter';
/**
 * channels.ts — real archive.org-backed channel schedule, config-driven.
 *
 * Collection resolution:
 *   Each configured network is systematically tested against both:
 *
 *     collection:NETWORK
 *     collection:TV-NETWORK
 *
 *   The terminal logs every attempt, HTTP status, result count, and the
 *   selected collection. This makes the Archive.org collection/API path
 *   observable instead of guessing which identifier is correct.
 *
 * To add a new channel: add one entry to NETWORK_CHANNELS below.
 */

export interface NetworkChannelConfig {
  id: string;
  displayName: string;
  /** Base Archive.org TV News collection identifier, e.g. "FOXNEWSW" */
  network: string;
}

export const NETWORK_CHANNELS: NetworkChannelConfig[] = [
  { id: "fox-news", displayName: "Fox News", network: "FOXNEWSW" },
  { id: "cnn", displayName: "CNN", network: "CNNW" },
  { id: "msnbc", displayName: "MSNBC", network: "MSNBCW" },
  { id: "bbc", displayName: "BBC News", network: "BBCNEWS" },
  { id: "ntd", displayName: "NTD News", network: "NTD" },
];

export interface TVNewsItem {
  identifier: string;
  title: string;
  network: string;
  program: string;
  date: string;
  time: string;
  durationMins: number;
  thumbnailUrl: string;
  publicdate: string;
  airDateSource: "identifier" | "publicdate";
  description?: string;
}

export const TV_ID_RE =
  /^([A-Z0-9]+)_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_(.+)$/;

export function getCollectionCandidates(network: string): string[] {
  const normalized = network.trim().replace(/^TV-/i, "");
  return [normalized, `TV-${normalized}`];
}

interface ArchiveCollectionProbe {
  collection: string;
  query: string;
  url: string;
  httpStatus: number;
  ok: boolean;
  total: number;
  docs: any[];
}

async function probeArchiveCollection(
  collection: string,
  opts: {
    query?: string;
    startDate?: string;
    endDate?: string;
    rows?: number;
    start?: number;
  },
): Promise<ArchiveCollectionProbe> {
  const today = new Date().toISOString().slice(0, 10);
  const endDatePart = opts.endDate ? opts.endDate.slice(0, 10) : today;
  const effectiveEndDate = endDatePart > today ? today : endDatePart;

  const clauses = [
    `collection:${collection}`,
    "-mediatype:web",
    "-mediatype:collection",
  ];

  if (opts.query?.trim()) {
    clauses.push(`(${opts.query.trim()})`);
  }

  if (opts.startDate) {
    clauses.push(`date:[${opts.startDate}T00:00:00Z TO ${effectiveEndDate}T23:59:59Z]`);
  }

  const q = clauses.join(" AND ");
  const url =
    `${"https://archive.org/advancedsearch.php"}` +
    `?q=${encodeURIComponent(q)}` +
    `&fl%5B%5D=identifier` +
    `&fl%5B%5D=title` +
    `&fl%5B%5D=description` +
    `&fl%5B%5D=subject` +
    `&fl%5B%5D=publicdate` +
    `&fl%5B%5D=addeddate` +
    `&fl%5B%5D=collection` +
    `&rows=${Math.min(Math.max(opts.rows ?? 12, 1), 50)}` +
    `&start=${Math.max(opts.start ?? 0, 0)}` +
    `&sort%5B%5D=publicdate+desc` +
    `&output=json`;

  console.log(`[ARCHIVE COLLECTION TEST] collection:${collection}`);
  console.log(`[ARCHIVE COLLECTION TEST] query: ${q}`);
  console.log(`[ARCHIVE COLLECTION TEST] url: ${url}`);

  try {
    const response = await archiveApiFetch(url, {
      headers: {
        "User-Agent": "AJN-Precision-Engineering/1.0",
        Accept: "application/json",
      },
    });

    console.log(`[ARCHIVE COLLECTION TEST] collection:${collection} HTTP ${response.status}`);

    const body = await response.text();

    if (!response.ok) {
      console.warn(`[ARCHIVE COLLECTION TEST] collection:${collection} returned HTTP ${response.status}`);
      console.log("==================================================");
      return {
        collection,
        query: q,
        url,
        httpStatus: response.status,
        ok: false,
        total: 0,
        docs: [],
      };
    }

    let data: any;
    try {
      data = JSON.parse(body);
    } catch {
      console.warn(`[ARCHIVE COLLECTION TEST] collection:${collection} returned invalid JSON`);
      console.log("==================================================");
      return {
        collection,
        query: q,
        url,
        httpStatus: response.status,
        ok: false,
        total: 0,
        docs: [],
      };
    }

    if (data.error) {
      console.warn(`[ARCHIVE COLLECTION TEST] collection:${collection} API error:`, data.error);
    }

    const total = Number(data.response?.numFound ?? 0);
    const docs = Array.isArray(data.response?.docs) ? data.response.docs : [];

    console.log(`[ARCHIVE COLLECTION TEST] collection:${collection} results: ${total}`);
    if (docs.length > 0) {
      console.log(`[ARCHIVE COLLECTION TEST] first identifier: ${docs[0]?.identifier ?? "none"}`);
    }
    console.log(`[ARCHIVE COLLECTION TEST] usable: ${response.ok && !data.error && total > 0 ? "YES" : "NO"}`);
    console.log("==================================================");

    return {
      collection,
      query: q,
      url,
      httpStatus: response.status,
      ok: response.ok && !data.error,
      total,
      docs,
    };
  } catch (error) {
    console.error(
      `[ARCHIVE COLLECTION TEST] collection:${collection} NETWORK ERROR:`,
      error instanceof Error ? error.message : String(error),
    );
    console.log("==================================================");
    return {
      collection,
      query: q,
      url,
      httpStatus: 0,
      ok: false,
      total: 0,
      docs: [],
    };
  }
}

// Results are cached for 5 minutes per (network, query, dates, rows): the Home
// and Search views request the same five networks repeatedly, and each uncached
// call costs 2 searches + up to 24 metadata requests against Archive.
const searchCache = new Map<string, { expires: number; value: Promise<any> }>();
export async function searchTVNews(opts: Parameters<typeof searchTVNewsUncached>[0]): ReturnType<typeof searchTVNewsUncached> {
  const key = JSON.stringify(opts);
  const hit = searchCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = searchTVNewsUncached(opts);
  searchCache.set(key, { expires: Date.now() + 5 * 60_000, value });
  value.catch(() => searchCache.delete(key));
  if (searchCache.size > 200) searchCache.delete(searchCache.keys().next().value!);
  return value;
}

async function searchTVNewsUncached(opts: {
  network: string;
  query?: string;
  startDate?: string;
  endDate?: string;
  rows?: number;
  start?: number;
}): Promise<{
  items: TVNewsItem[];
  total: number;
  safeEndDate: string;
}> {
  const candidates = getCollectionCandidates(opts.network);

  console.log("");
  console.log(`[channels] Testing Archive.org collections for "${opts.network}"`);
  console.log(`[channels] Candidates: ${candidates.map((value) => `collection:${value}`).join(" | ")}`);

  for (const collection of candidates) {
    const result = await probeArchiveCollection(collection, {
      query: opts.query,
      startDate: opts.startDate,
      endDate: opts.endDate,
      rows: opts.rows,
      start: opts.start,
    });

    if (result.ok && result.total > 0) {
      console.log("");
      console.log(`[channels] SELECTED collection:${collection}`);
      console.log(`[channels] Result count: ${result.total}`);
      console.log("");

      const today = new Date().toISOString().slice(0, 10);
      const items: TVNewsItem[] = result.docs.map((doc: any) => {
        const id: string = doc.identifier ?? "";
        const match = id.match(TV_ID_RE);
        const rawDescription = doc.description ?? doc.subject;
        const description = rawDescription
          ? (Array.isArray(rawDescription) ? rawDescription[0] : String(rawDescription))
              .replace(/<[^>]*>/g, " ")
              .replace(/\s+/g, " ")
              .trim() || undefined
          : undefined;

        return {
          identifier: id,
          title: doc.title ?? id,
          network: match ? match[1] : id.split("_")[0] ?? "",
          date: match
            ? `${match[2]}-${match[3]}-${match[4]}`
            : (doc.publicdate ?? doc.addeddate ?? "").slice(0, 10),
          time: match ? `${match[5]}:${match[6]}` : "Unknown",
          program: match ? match[8].replace(/_/g, " ") : doc.title ?? id,
          durationMins: 60,
          thumbnailUrl: `https://archive.org/services/img/${id}`,
          publicdate: (doc.publicdate ?? doc.addeddate ?? "").slice(0, 10),
          airDateSource: match ? "identifier" : "publicdate",
          ...(description ? { description } : {}),
        };
      });

      return {
        items,
        total: result.total,
        safeEndDate: today,
      };
    }

    console.warn(`[channels] collection:${collection} did not produce usable results; trying next candidate`);
  }

  console.error("");
  console.error(`[channels] NO WORKING COLLECTION FOUND for "${opts.network}"`);
  console.error(`[channels] Tested: ${candidates.map((value) => `collection:${value}`).join(", ")}`);
  console.error("");

  return {
    items: [],
    total: 0,
    safeEndDate: new Date().toISOString().slice(0, 10),
  };
}

export function getSafeArchiveUrl(rawUrl: string): string {
  // Use the Archive URL exactly as given. The only rewrites allowed are
  // http -> https and a storage-node URL (iaNNN.us.archive.org/N/items/...)
  // back to its canonical archive.org/download/... form. The path, its
  // percent-encoding and the query string are never decoded, re-encoded or
  // guessed: a URL without a filename stays without one and fails honestly.
  const httpsUrl = rawUrl.replace(/^http:\/\//i, "https://");
  const cdnMatch = httpsUrl.match(
    /^https:\/\/ia\d+\.us\.archive\.org\/\d+\/items\/([^?#]+)(\?[^#]*)?$/,
  );
  const canonical = cdnMatch ? `https://archive.org/download/${cdnMatch[1]}${cdnMatch[2] ?? ""}` : httpsUrl;

  // Item-level TV News URL (archive.org/details/<ID> or /download/<ID>): Archive
  // stores the broadcast as <ID>/<ID>.mp4. This is the one documented naming
  // convention (from M3UStripTool); deeper folder URLs are never guessed.
  const itemMatch = canonical.match(/^https:\/\/archive\.org\/(?:details|download)\/([A-Za-z0-9._-]+)\/?(\?[^#]*)?$/);
  if (itemMatch && !itemMatch[1].includes(".")) {
    return `https://archive.org/download/${itemMatch[1]}/${itemMatch[1]}.mp4${itemMatch[2] ?? ""}`;
  }
  return canonical;
}

type FileCategory =
  | "video"
  | "audio"
  | "document"
  | "image"
  | "subtitle"
  | "other";

interface ArchiveFile {
  name: string;
  format?: string;
  size?: string;
  length?: string;
  source?: string;
}

interface ArchiveMetadataResponse {
  metadata?: Record<string, unknown>;
  files?: ArchiveFile[];
}

interface ResolvedFile {
  url: string;
  duration: number;
  format: string;
  fallback: boolean;
}

const BROWSER_PLAYABLE_VIDEO = [".mp4", ".m4v", ".webm", ".ogv"];
const OTHER_VIDEO = [".avi", ".mkv", ".mov", ".flv", ".wmv", ".3gp", ".mpg", ".mpeg", ".ts", ".m2ts", ".vob", ".divx"];
const VIDEO_EXTENSIONS = [...BROWSER_PLAYABLE_VIDEO, ...OTHER_VIDEO];

const AUDIO_EXTENSIONS = [
  ".mp3",
  ".flac",
  ".wav",
  ".ogg",
  ".m4a",
  ".aac",
  ".wma",
  ".opus",
  ".aiff",
];

const DOCUMENT_EXTENSIONS = [
  ".pdf",
  ".txt",
  ".doc",
  ".docx",
  ".epub",
  ".rtf",
  ".odt",
  ".csv",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
];

const IMAGE_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".svg",
  ".bmp",
  ".tiff",
  ".tif",
  ".ico",
];

const SUBTITLE_EXTENSIONS = [
  ".srt",
  ".sub",
  ".ass",
  ".ssa",
  ".vtt",
  ".smi",
  ".idx",
];

const INTERNAL_FILES = [
  "_meta.xml",
  "_files.xml",
  "_meta.sqlite",
  "_reviews.xml",
  "_scandata.xml",
];

const PLAYABLE_PRIORITY: FileCategory[] = ["video", "audio"];

function categorizeFile(filename: string): FileCategory {
  const lower = filename.toLowerCase();
  if (VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "video";
  if (AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "audio";
  if (SUBTITLE_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "subtitle";
  if (DOCUMENT_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "document";
  if (IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "image";
  return "other";
}

function isInternalFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return (
    INTERNAL_FILES.some((file) => lower.endsWith(file)) ||
    lower.endsWith("_thumb.jpg") ||
    lower.endsWith("__ia_thumb.jpg") ||
    lower.includes("_thumbs/") ||
    lower.includes("_thumbs\\") ||
    lower.endsWith(".torrent") ||
    lower === "_meta.xml" ||
    lower === "_files.xml"
  );
}

function parseDuration(length: string | undefined): number {
  if (!length) return 0;
  const seconds = parseFloat(length);
  return Number.isNaN(seconds) ? 0 : Math.round(seconds);
}

function parseSize(size: string | undefined): number {
  if (!size) return 0;
  const bytes = parseInt(size, 10);
  return Number.isNaN(bytes) ? 0 : bytes;
}

function buildFileUrl(identifier: string, filename: string): string {
  const encodedPath = filename
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `https://archive.org/download/${identifier}/${encodedPath}`;
}

const METADATA_CACHE_TTL_MS = 30 * 60 * 1000;

const metadataCache = new Map<
  string,
  {
    data: ArchiveMetadataResponse;
    expiresAt: number;
  }
>();

async function fetchArchiveMetadata(identifier: string): Promise<ArchiveMetadataResponse> {
  const cached = metadataCache.get(identifier);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const metadataUrl = `https://archive.org/metadata/${identifier}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await archiveApiFetch(metadataUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "AJN-Precision-Engineering/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(`Archive.org metadata request failed: HTTP ${response.status}`);
    }

    const data = (await response.json()) as ArchiveMetadataResponse;
    metadataCache.set(identifier, {
      data,
      expiresAt: Date.now() + METADATA_CACHE_TTL_MS,
    });
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function isBrowserPlayable(filename: string): boolean {
  const lower = filename.toLowerCase();

  return (
    BROWSER_PLAYABLE_VIDEO.some((extension) => lower.endsWith(extension)) ||
    AUDIO_EXTENSIONS.some((extension) => lower.endsWith(extension))
  );
}

export interface ResolvedMediaCandidate extends ResolvedFile {
  filename: string;
  size: number;
}

/** Like resolveArchiveMediaCandidates, but returns null when Archive metadata could not be fetched. */
export async function tryResolveArchiveMediaCandidates(identifier: string): Promise<ResolvedMediaCandidate[] | null> {
  try {
    await fetchArchiveMetadata(identifier);
  } catch {
    return null;
  }
  return resolveArchiveMediaCandidates(identifier);
}

export async function resolveArchiveMediaCandidates(identifier: string): Promise<ResolvedMediaCandidate[]> {
  try {
    const data = await fetchArchiveMetadata(identifier);
    const eligibleFiles = (data.files ?? [])
      .filter((file) => !isInternalFile(file.name))
      .filter((file) => String(file.source ?? "").toLowerCase() !== "metadata")
      .filter((file) => isBrowserPlayable(file.name));

    // Archive metadata explicitly marks generated browser-playable derivatives.
    // Prefer those derivatives over originals; never select an original when a
    // usable MP4/WebM derivative exists for the item.
    const derivativeFiles = eligibleFiles.filter((file) => {
      const source = String(file.source ?? "").toLowerCase();
      const lower = String(file.name).toLowerCase();
      return source === "derivative" && (lower.endsWith(".mp4") || lower.endsWith(".webm"));
    });
    const selectedFiles = derivativeFiles.length > 0 ? derivativeFiles : eligibleFiles;

    const mediaFiles = selectedFiles
      .map((file) => ({
        filename: file.name,
        url: buildFileUrl(identifier, file.name),
        duration: parseDuration(file.length),
        format: file.format ?? file.name.split(".").pop() ?? "",
        size: parseSize(file.size),
        fallback: false,
        category: categorizeFile(file.name),
        derivative: String(file.source ?? "").toLowerCase() === "derivative",
      }))
      .sort((a, b) => {
        const categoryA = PLAYABLE_PRIORITY.indexOf(a.category);
        const categoryB = PLAYABLE_PRIORITY.indexOf(b.category);
        return categoryA - categoryB ||
          Number(b.derivative) - Number(a.derivative) ||
          a.filename.localeCompare(b.filename);
      })
      .map(({ category: _category, derivative: _derivative, ...candidate }) => candidate);

    return mediaFiles;
  } catch (error) {
    console.warn(
      `[Resolver] Metadata unavailable for identifier "${identifier}"; refusing speculative media URL:`,
      error instanceof Error ? error.message : String(error),
    );
    return [];
  }
}

export async function resolveBestFileUrl(identifier: string): Promise<ResolvedFile> {
  const candidates = await resolveArchiveMediaCandidates(identifier);
  const best = candidates[0];
  if (best) return best;

  console.warn(`[Resolver] No browser-playable media file for ${identifier}`);
  return {
    url: "",
    duration: 0,
    format: "",
    fallback: true,
  };
}

function toProxyPath(fullUrl: string): string {
  try {
    const url = new URL(fullUrl);
    return `${url.pathname}${url.search}`;
  } catch {
    return fullUrl;
  }
}

export interface ScheduleProgram {
  externalId: string;
  title: string;
  startHour: number;
  endHour: number;
  archivePath: string;
}

export interface ScheduleChannel {
  id: string;
  name: string;
  programs: ScheduleProgram[];
}

const CACHE_TTL_MS = 15 * 60 * 1000;
const EMPTY_CACHE_TTL_MS = 60 * 1000;

let _cache: {
  data: ScheduleChannel[];
  expiresAt: number;
} | null = null;

async function itemsToProgramBlocks(items: TVNewsItem[]): Promise<ScheduleProgram[]> {
  if (items.length === 0) {
    return [];
  }

  const resolved = await Promise.all(
    items.map(async (item) => {
      const resolvedFile = await resolveBestFileUrl(item.identifier);
      if (resolvedFile.fallback || !resolvedFile.url) {
        console.warn(`[channels] skipping unavailable Archive media: ${item.identifier}`);
        return "";
      }
      return toProxyPath(getSafeArchiveUrl(resolvedFile.url));
    }),
  );

  return items
    .map((item, index) => ({ item, archivePath: resolved[index] }))
    .filter(({ archivePath }) => Boolean(archivePath))
    .map(({ item, archivePath }, index, playableItems) => ({
      externalId: item.identifier,
      title: item.title || item.program || item.identifier,
      startHour: index * (24 / playableItems.length),
      endHour: (index + 1) * (24 / playableItems.length),
      archivePath,
    }));
}

export async function getChannelSchedule(): Promise<ScheduleChannel[]> {
  if (_cache && Date.now() < _cache.expiresAt) {
    return _cache.data;
  }

  const results = await Promise.allSettled(
    NETWORK_CHANNELS.map(async (config) => {
      const { items } = await searchTVNews({
        network: config.network,
        rows: 12,
      });

      return {
        id: config.id,
        name: config.displayName,
        programs: await itemsToProgramBlocks(items),
      };
    }),
  );

  const channels: ScheduleChannel[] = [];

  results.forEach((result, index) => {
    const config = NETWORK_CHANNELS[index];

    if (result.status === "fulfilled") {
      channels.push(result.value);
      return;
    }

    console.warn(
      `[channels] Failed to fetch schedule for ${config.displayName}:`,
      result.reason instanceof Error ? result.reason.message : result.reason,
    );

    channels.push({
      id: config.id,
      name: config.displayName,
      programs: [],
    });
  });

  // A channel with no programs means the upstream search failed or returned
  // nothing playable. Cache that state only briefly so empty feeds recover on
  // the next minute instead of being served as success for 15 minutes.
  const complete = channels.every((channel) => channel.programs.length > 0);
  _cache = {
    data: channels,
    expiresAt: Date.now() + (complete ? CACHE_TTL_MS : EMPTY_CACHE_TTL_MS),
  };

  return channels;
}
