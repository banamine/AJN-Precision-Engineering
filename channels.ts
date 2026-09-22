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

import { calculate48HourUtcWindow, filterArchiveResultsTo48HourWindow } from "./archive-discovery.js";

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
  airDateSource: "identifier" | "publicdate" | "addeddate";
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

export const NEWS_WINDOW_HOURS = 48;
export const NEWS_TARGET_ITEMS = 25;
const NEWS_PAGE_SIZE = 50;
const METADATA_CONCURRENCY = 6;
const METADATA_RETRIES = 3;
const ARCHIVE_SEARCH_TIMEOUT_MS = 12000;

interface NewsWindow {
  start: Date;
  end: Date;
  startDate: string;
  endDate: string;
}

export interface NewsFreshnessTelemetry {
  requestedWindowHours: number;
  windowStart: string;
  windowEnd: string;
  returnedCount: number;
  availableCurrentCount: number;
  staleRejected: number;
  metadataFailures: number;
}

function buildNewsWindow(now = new Date()): NewsWindow {
  return calculate48HourUtcWindow(now);
}

function parseAirTimestamp(doc: any): { timestamp: string; source: "identifier" | "publicdate" | "addeddate" } | null {
  const identifier = String(doc?.identifier ?? "");
  const match = identifier.match(TV_ID_RE);
  if (match) {
    const parsed = new Date(`${match[2]}-${match[3]}-${match[4]}T${match[5]}:${match[6]}:${match[7]}Z`);
    if (!Number.isNaN(parsed.getTime())) {
      return { timestamp: parsed.toISOString(), source: "identifier" };
    }
  }

  for (const source of ["publicdate", "addeddate"] as const) {
    const raw = doc?.[source];
    if (!raw) continue;
    const parsed = new Date(String(raw));
    if (!Number.isNaN(parsed.getTime())) {
      return { timestamp: parsed.toISOString(), source };
    }
  }

  return null;
}

function filterCurrentDocs(docs: any[], window: NewsWindow) {
  const current: Array<{ doc: any; airTimestamp: string; airDateSource: "identifier" | "publicdate" | "addeddate" }> = [];
  const filtered = filterArchiveResultsTo48HourWindow(docs, window);
  for (const doc of filtered) {
    const air = parseAirTimestamp(doc);
    if (air) current.push({ doc, airTimestamp: air.timestamp, airDateSource: air.source });
  }
  current.sort((a, b) => b.airTimestamp.localeCompare(a.airTimestamp));
  return { current, staleRejected: docs.length - current.length };
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ARCHIVE_SEARCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "AJN-Precision-Engineering/1.0",
        Accept: "application/json",
      },
      signal: controller.signal,
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
  } finally {
    clearTimeout(timeout);
  }
}

export async function searchTVNews(opts: {
  network: string;
  query?: string;
  rows?: number;
  start?: number;
}): Promise<{
  items: TVNewsItem[];
  total: number;
  safeEndDate: string;
  freshness: NewsFreshnessTelemetry;
}> {
  const window = buildNewsWindow();
  const candidates = getCollectionCandidates(opts.network);
  const target = Math.min(Math.max(opts.rows ?? NEWS_TARGET_ITEMS, 1), NEWS_TARGET_ITEMS);
  let staleRejected = 0;
  let selectedCollection = "";
  let selectedDocs: any[] = [];
  let availableCurrentCount = 0;

  console.log("[NEWS WINDOW] network=" + opts.network + " hours=" + NEWS_WINDOW_HOURS + " start=" + window.start.toISOString() + " end=" + window.end.toISOString());

  for (const collection of candidates) {
    let pageStart = 0;
    const docs: any[] = [];
    let archiveTotal = 0;
    let currentCount = 0;

    while (pageStart < 1000 && currentCount < target) {
      const result = await probeArchiveCollection(collection, {
        query: opts.query,
        startDate: window.startDate,
        endDate: window.endDate,
        rows: NEWS_PAGE_SIZE,
        start: pageStart,
      });

      if (!result.ok) break;
      archiveTotal = result.total;
      docs.push(...result.docs);
      const page = filterCurrentDocs(result.docs, window);
      staleRejected += page.staleRejected;
      currentCount += page.current.length;

      if (result.docs.length < NEWS_PAGE_SIZE || pageStart + result.docs.length >= archiveTotal) break;
      pageStart += result.docs.length;
    }

    const filtered = filterCurrentDocs(docs, window);
    currentCount = filtered.current.length;
    console.log("[NEWS COLLECTION] network=" + opts.network + " collection=" + collection + " archiveTotal=" + archiveTotal + " currentWindowCount=" + currentCount);

    if (currentCount > 0) {
      selectedCollection = collection;
      selectedDocs = docs;
      availableCurrentCount = currentCount;
      break;
    }
  }

  const unique = new Map<string, { doc: any; airTimestamp: string; airDateSource: "identifier" | "publicdate" | "addeddate" }>();
  if (selectedCollection) {
    for (const entry of filterCurrentDocs(selectedDocs, window).current) {
      const id = String(entry.doc.identifier ?? "");
      if (id && !unique.has(id)) unique.set(id, entry);
    }
  }

  const currentEntries = [...unique.values()].sort((a, b) => b.airTimestamp.localeCompare(a.airTimestamp)).slice(0, target);
  const items: TVNewsItem[] = currentEntries.map(({ doc, airTimestamp, airDateSource }) => {
    const id: string = doc.identifier ?? "";
    const match = id.match(TV_ID_RE);
    const rawDescription = doc.description ?? doc.subject;
    const description = rawDescription
      ? (Array.isArray(rawDescription) ? rawDescription[0] : String(rawDescription))
          .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() || undefined
      : undefined;
    return {
      identifier: id,
      title: doc.title ?? id,
      network: match ? match[1] : id.split("_")[0] ?? "",
      date: airTimestamp.slice(0, 10),
      time: airTimestamp.slice(11, 16),
      program: match ? match[8].replace(/_/g, " ") : doc.title ?? id,
      durationMins: 60,
      thumbnailUrl: "https://archive.org/services/img/" + id,
      publicdate: airTimestamp,
      airDateSource: airDateSource,
      ...(description ? { description } : {}),
    };
  });

  const freshness: NewsFreshnessTelemetry = {
    requestedWindowHours: NEWS_WINDOW_HOURS,
    windowStart: window.start.toISOString(),
    windowEnd: window.end.toISOString(),
    returnedCount: items.length,
    availableCurrentCount,
    staleRejected,
    metadataFailures: 0,
  };
  console.log("[NEWS RESULT] network=" + opts.network + " collection=" + (selectedCollection || "none") + " returnedCount=" + items.length + " availableCurrentCount=" + availableCurrentCount + " staleRejected=" + staleRejected + " metadataFailures=0");

  return {
    items,
    total: availableCurrentCount,
    safeEndDate: window.end.toISOString(),
    freshness,
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
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  const metadataUrl = "https://archive.org/metadata/" + encodeURIComponent(identifier);
  let lastError: unknown = new Error("Archive.org metadata request failed");
  for (let attempt = 1; attempt <= METADATA_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(metadataUrl, { signal: controller.signal, headers: { "User-Agent": "AJN-Precision-Engineering/1.0", Accept: "application/json" } });
      if (!response.ok) throw new Error("Archive.org metadata request failed: HTTP " + response.status);
      const data = (await response.json()) as ArchiveMetadataResponse;
      metadataCache.set(identifier, { data, expiresAt: Date.now() + METADATA_CACHE_TTL_MS });
      return data;
    } catch (error) {
      lastError = error;
      if (attempt < METADATA_RETRIES) await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    } finally { clearTimeout(timeout); }
  }
  throw lastError;
}

function isBrowserPlayable(filename: string): boolean {
  const lower = filename.toLowerCase();
  return BROWSER_PLAYABLE_VIDEO.some((extension) => lower.endsWith(extension)) || AUDIO_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

async function verifyDeterministicTvNewsFallback(identifier: string): Promise<string> {
  const fallbackUrl = "https://archive.org/download/" + encodeURIComponent(identifier) + "/" + encodeURIComponent(identifier) + ".mp4";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(fallbackUrl, { method: "HEAD", headers: { "User-Agent": "AJN-Precision-Engineering/1.0", Accept: "video/mp4,*/*" }, signal: controller.signal });
    return response.ok && /^(video\/|application\/octet-stream)/i.test(response.headers.get("content-type") || "video/mp4") ? fallbackUrl : "";
  } catch { return ""; }
  finally { clearTimeout(timeout); }
}

export async function resolveBestFileUrl(identifier: string): Promise<ResolvedFile> {
  // TV News identifiers use a stable Archive.org MP4 naming convention. Keep
  // schedule generation independent of slow metadata endpoints; the playback
  // proxy remains the authoritative availability/format gate.
  if (TV_ID_RE.test(identifier)) {
    return {
      url: `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(identifier)}.mp4?start=0&end=${TV_NEWS_SLICE_SEC}`,
      duration: TV_NEWS_TOTAL_SEC,
      format: 'mp4',
      fallback: true,
    };
  }

  const verifiedFallback = await verifyDeterministicTvNewsFallback(identifier);
  if (verifiedFallback) {
    return { url: verifiedFallback, duration: 0, format: "mp4", fallback: true };
  }
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
        if (categoryA !== categoryB) return categoryA - categoryB;
        return b.size - a.size;
      });
      const best = mediaFiles[0];
      return { url: buildFileUrl(identifier, best.name), duration: best.duration, format: best.format, fallback: false };
    }

    const verifiedFallback = await verifyDeterministicTvNewsFallback(identifier);
    if (verifiedFallback) return { url: verifiedFallback, duration: 0, format: "mp4", fallback: true };
    return { url: "", duration: 0, format: "", fallback: true };
  } catch (error) {
    const verifiedFallback = await verifyDeterministicTvNewsFallback(identifier);
    if (verifiedFallback) {
      console.log(`[Resolver] Metadata unavailable; verified deterministic TV news fallback for ${identifier}`);
      return { url: verifiedFallback, duration: 0, format: "mp4", fallback: true };
    }
    console.warn(`[Resolver] Metadata unavailable for identifier "${identifier}"; no verified media URL:`, error instanceof Error ? error.message : String(error));
    return { url: "", duration: 0, format: "", fallback: true };
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

let _cache: {
  data: ScheduleChannel[];
  expiresAt: number;
} | null = null;

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function runWorker() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()));
  return results;
}

async function itemsToProgramBlocks(items: TVNewsItem[]): Promise<ScheduleProgram[]> {
  if (items.length === 0) return [];
  const resolved = await mapWithConcurrency(items, METADATA_CONCURRENCY, async (item) => {
    const resolvedFile = await resolveBestFileUrl(item.identifier);
    if (!resolvedFile.url) {
      console.warn(`[channels] skipping unavailable Archive media: ${item.identifier}`);
      return "";
    }
    return toProxyPath(getSafeArchiveUrl(resolvedFile.url));
  });

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
        rows: NEWS_TARGET_ITEMS,
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

  const coreChannelsReady = channels
    .filter((channel) => channel.id !== 'ntd-news')
    .every((channel) => channel.programs.length > 0);
  if (coreChannelsReady) {
    _cache = {
      data: channels,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
  } else {
    console.warn('[channels] schedule contains an unavailable core news channel; not caching partial/empty schedule');
    _cache = null;
  }

  return channels;
}
