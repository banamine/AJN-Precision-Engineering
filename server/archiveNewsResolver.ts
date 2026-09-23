export const ARCHIVE_NEWS_SOURCES = [
  { id: "fox", name: "FOX News", collection: "TV-FOXNEWSW", callsign: "FOXNEWSW" },
  { id: "cnn", name: "CNN", collection: "TV-CNNW", callsign: "CNNW" },
  { id: "msnbc", name: "MSNBC", collection: "TV-MSNBCW", callsign: "MSNBCW" },
  { id: "bbc", name: "BBC News", collection: "TV-BBCNEWS", callsign: "BBCNEWS" },
] as const;

export type ArchiveNewsSourceId = typeof ARCHIVE_NEWS_SOURCES[number]["id"];

const SEARCH_TIMEOUT_MS = 12_000;
const METADATA_TIMEOUT_MS = 12_000;
const METADATA_CONCURRENCY = 4;

function encodePathPart(value: string): string {
  return encodeURIComponent(value);
}

function pickMp4(files: any[]): any | null {
  const eligible = files.filter((file) => {
    const name = String(file?.name || "");
    const format = String(file?.format || "").toLowerCase();
    const source = String(file?.source || "").toLowerCase();
    return /\.mp4$/i.test(name) &&
      source !== "metadata" &&
      !/metadata|itemimage|thumb|\.torrent$|\.ia\.|\.low\.|_meta\.xml$|_files\.xml$/i.test(name) &&
      (format.includes("video") || format.includes("mp4") || !format);
  });
  const derivatives = eligible.filter((file) => String(file?.source || "").toLowerCase() === "derivative");
  const candidates = derivatives.length ? derivatives : eligible;
  candidates.sort((a, b) => {
    const sizeA = Number(a?.size || 0);
    const sizeB = Number(b?.size || 0);
    return sizeB - sizeA;
  });
  return candidates[0] || null;
}

export interface ArchivePlayableItem {
  sourceId: ArchiveNewsSourceId;
  provider: "archive.org";
  identifier: string;
  title: string;
  timestamp?: string;
  filename: string;
  size?: number;
  contentType: "video/mp4";
  mediaPath: string;
  proxyUrl: string;
  state: "PLAYABLE";
}

export async function resolveArchiveItem(identifier: string, sourceId: ArchiveNewsSourceId): Promise<ArchivePlayableItem | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), METADATA_TIMEOUT_MS);
  try {
    const response = await fetch(`https://archive.org/metadata/${encodeURIComponent(identifier)}`, {
      signal: controller.signal,
      headers: { "User-Agent": "AJN-Media-Console/ArchiveResolver", Accept: "application/json" },
    });
    if (!response.ok) {
      console.warn(`[ArchiveResolver] ${identifier}: HTTP ${response.status}`);
      return null;
    }
    const data: any = await response.json();
    const file = pickMp4(Array.isArray(data?.files) ? data.files : []);
    if (!file) {
      console.warn(`[ArchiveResolver] ${identifier}: no MP4 derivative`);
      return null;
    }
    const filename = String(file.name);
    const mediaPath = `/download/${encodePathPart(identifier)}/${filename.split("/").map(encodePathPart).join("/")}`;
    const base = typeof window === "undefined" ? "" : window.location.origin;
    const proxyUrl = `${base}/api/archive/proxy?path=${encodeURIComponent(mediaPath)}`;
    return {
      sourceId,
      provider: "archive.org",
      identifier,
      title: String(data?.metadata?.title || identifier.replace(/_/g, " ")),
      timestamp: data?.metadata?.date || undefined,
      filename,
      size: Number(file.size || 0) || undefined,
      contentType: "video/mp4",
      mediaPath,
      proxyUrl,
      state: "PLAYABLE",
    };
  } catch (error: any) {
    if (error?.name === "AbortError") console.warn(`[ArchiveResolver] ${identifier}: metadata timeout`);
    else console.warn(`[ArchiveResolver] ${identifier}: ${error?.message || error}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonWithTimeout(url: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "AJN-Media-Console/ArchiveResolver", Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Archive search HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function resolveBatch(docs: any[], sourceId: ArchiveNewsSourceId): Promise<ArchivePlayableItem[]> {
  const playable: ArchivePlayableItem[] = [];
  for (let index = 0; index < docs.length; index += METADATA_CONCURRENCY) {
    const batch = docs.slice(index, index + METADATA_CONCURRENCY);
    const resolved = await Promise.all(batch.map((doc) => resolveArchiveItem(String(doc.identifier), sourceId)));
    for (const item of resolved) if (item) playable.push(item);
  }
  return playable;
}

export async function searchArchiveNews(sourceId: ArchiveNewsSourceId, options: { page?: number; rows?: number } = {}) {
  const source = ARCHIVE_NEWS_SOURCES.find((item) => item.id === sourceId)!;
  const page = Math.max(1, options.page || 1);
  const rows = Math.min(100, Math.max(1, options.rows || 20));
  const queries = [
    `collection:${source.collection} AND mediatype:movies`,
    `${source.callsign} AND mediatype:movies`,
  ];

  let lastError: unknown = null;
  for (const query of queries) {
    const url = new URL("https://archive.org/advancedsearch.php");
    url.searchParams.set("q", query);
    url.searchParams.set("fl[]", "identifier,title,date");
    url.searchParams.set("sort[]", "date desc");
    url.searchParams.set("rows", String(rows));
    url.searchParams.set("page", String(page));
    url.searchParams.set("output", "json");
    try {
      const data: any = await fetchJsonWithTimeout(url.toString());
      const docs = Array.isArray(data?.response?.docs) ? data.response.docs : [];
      if (docs.length === 0 && query !== queries[queries.length - 1]) continue;
      return {
        source,
        found: Number(data?.response?.numFound || 0),
        playable: await resolveBatch(docs, sourceId),
      };
    } catch (error: any) {
      lastError = error;
      console.warn(`[ArchiveResolver] ${source.id}: query failed; trying fallback`, error?.name || error?.message || error);
    }
  }

  const error = lastError instanceof Error ? lastError : new Error(String(lastError || "Archive search failed"));
  console.warn(`[ArchiveResolver] ${source.id}: all search queries failed: ${error.message}`);
  return { source, found: 0, playable: [] as ArchivePlayableItem[] };
}
