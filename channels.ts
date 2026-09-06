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
    const response = await fetch(url, {
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

export async function searchTVNews(opts: {
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
  try {
    const httpsUrl = rawUrl.replace(/^http:\/\//i, "https://");
    const cdnMatch = httpsUrl.match(
      /^(https?:\/\/)ia\d+\.us\.archive\.org\/\d+\/items\/([^/?#]+\/[^?#]*)/,
    );
    const normalized = cdnMatch ? `https://archive.org/download/${cdnMatch[2]}` : httpsUrl;
    const url = new URL(normalized.replace("/embed/", "/download/"));
    const parts = url.pathname.replace(/\/$/, "").split("/");
    const lastPart = parts[parts.length - 1];

    if (!lastPart.includes(".")) {
      const id = lastPart;
      url.pathname += `/${id}.mp4`;
    }

    url.searchParams.delete("ignore");

    return url.toString();
  } catch {
    return rawUrl;
  }
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
    const response = await fetch(metadataUrl, {
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

export async function resolveBestFileUrl(identifier: string): Promise<ResolvedFile> {
  try {
    const data = await fetchArchiveMetadata(identifier);
    const files = data.files ?? [];

    const mediaFiles = files
      .filter((file) => !isInternalFile(file.name))
      .filter((file) => isBrowserPlayable(file.name))
      .map((file) => ({
        name: file.name,
        category: categorizeFile(file.name),
        size: parseSize(file.size),
        duration: parseDuration(file.length),
        format: file.format ?? file.name.split(".").pop() ?? "",
      }));

    if (mediaFiles.length > 0) {
      mediaFiles.sort((a, b) => {
        const categoryA = PLAYABLE_PRIORITY.indexOf(a.category);
        const categoryB = PLAYABLE_PRIORITY.indexOf(b.category);
        if (categoryA !== categoryB) {
          return categoryA - categoryB;
        }
        return b.size - a.size;
      });

      const best = mediaFiles[0];
      return {
        url: buildFileUrl(identifier, best.name),
        duration: best.duration,
        format: best.format,
        fallback: false,
      };
    }

    console.warn(`[Resolver] No browser-playable media file for ${identifier}`);
    return {
      url: "",
      duration: 0,
      format: "",
      fallback: true,
    };
  } catch (error) {
    console.warn(
      `[Resolver] Metadata unavailable for identifier "${identifier}"; refusing speculative media URL:`,
      error instanceof Error ? error.message : String(error),
    );

    return {
      url: "",
      duration: 0,
      format: "",
      fallback: true,
    };
  }
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

  _cache = {
    data: channels,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };

  return channels;
}
