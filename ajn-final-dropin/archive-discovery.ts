import { MediaAsset, PlayoutChannel } from "./src/archive-types.js";
import { setChannelSources, addChannel } from "./guideRegistry.js";
import { ChannelSource } from "./src/types.js";

const metadataCache = new Map<string, any>();
const ARCHIVE_BASE = "https://archive.org";
const USER_AGENT = "AJN-Precision-Engineering/1.0";
const REQUEST_TIMEOUT_MS = 12000;
const MAX_ATTEMPTS = 3;
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchJson(url: string): Promise<any> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) return await res.json();
      if (!RETRYABLE.has(res.status) || attempt === MAX_ATTEMPTS) return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/abort|timeout/i.test(message)) {
        console.warn(`[Resolver] Archive request aborted/timeout (attempt ${attempt}/${MAX_ATTEMPTS}): ${url}`);
      } else {
        console.warn(`[Resolver] Archive request failed (attempt ${attempt}/${MAX_ATTEMPTS}): ${url} — ${message}`);
      }
      if (attempt === MAX_ATTEMPTS) return null;
    }
    await sleep(500 * 2 ** (attempt - 1));
  }
  return null;
}

export async function searchArchiveGeneral(query: string, rows = 25) {
  const url = `${ARCHIVE_BASE}/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier,title,mediatype,description,date&rows=${Math.min(rows, 50)}&output=json`;
  const data = await fetchJson(url);
  return data?.response?.docs || [];
}

async function fetchMetadata(identifier: string): Promise<any | null> {
  if (metadataCache.has(identifier)) return metadataCache.get(identifier);
  const meta = await fetchJson(`${ARCHIVE_BASE}/metadata/${encodeURIComponent(identifier)}`);
  if (meta) {
    metadataCache.set(identifier, meta);
    const mp4Count = Array.isArray(meta.files)
      ? meta.files.filter((file: any) => String(file?.name || '').toLowerCase().endsWith('.mp4')).length
      : 0;
    console.log(`[Resolver] Metadata resolved ${identifier}: ${mp4Count} MP4 derivative(s)`);
  } else {
    console.warn(`[Resolver] Metadata unavailable for identifier "${identifier}"; no speculative media URL will be created`);
  }
  return meta;
}

function classify(name: string): MediaAsset["category"] {
  const n = name.toLowerCase();
  if (n.includes("trailer")) return "trailer";
  if (n.includes("colorized") || n.includes("colorised")) return "colorized";
  if (n.includes("alternate") || n.includes("alternate")) return "alternate";
  if (n.includes("clip") || n.includes("promo")) return "compilation";
  if (n.includes("short")) return "short";
  if (n.includes("restored")) return "restored";
  if (n.includes("b&w") || n.includes("bw") || n.includes("black and white")) return "b&w";
  return "feature";
}

function quality(name: string, file: any): string {
  const n = name.toLowerCase();
  const width = Number(file.width || 0);
  if (n.includes("4k") || width >= 3840) return "4K";
  if (n.includes("1080") || width >= 1920) return "HD";
  if (n.includes("720") || width >= 1280) return "HD";
  if (n.includes("512kb")) return "LowRes";
  return "SD";
}

function durationSeconds(file: any): number {
  const raw = Number(file.length || file.duration || 0);
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 3600;
}

export async function buildChannelFromSearch(
  query: string,
  channelId: string,
  channelName: string,
  maxAssets = 50
): Promise<PlayoutChannel> {
  const docs = await searchArchiveGeneral(query, 25);
  const assets: (MediaAsset & { _fileIdentity: string })[] = [];
  const seen = new Set<string>();

  // Intentionally bounded: Archive.org is queried with at most 4 concurrent metadata requests.
  let cursor = 0;
  const workers = Array.from({ length: Math.min(4, docs.length) }, async () => {
    while (cursor < docs.length) {
      const doc = docs[cursor++];
      if (!doc?.identifier) continue;
      const meta = await fetchMetadata(doc.identifier);
      if (!meta) continue;

      for (const file of meta.files || []) {
        const name = String(file.name || "");
        const lower = name.toLowerCase();
        if (!(lower.endsWith(".mp4") || lower.endsWith(".m4v"))) continue;

        const category = classify(name);
        const q = quality(name, file);
        // Collapse duplicate .ia.mp4/.mp4 representations, but preserve presentation/quality variants.
        const identity = `${doc.identifier}|${category}|${q}`;
        if (seen.has(identity)) continue;
        seen.add(identity);

        assets.push({
          id: `asset-${doc.identifier}-${name}`,
          title: doc.title || doc.identifier,
          source: "archive.org",
          archiveIdentifier: doc.identifier,
          mediaUrl: `/download/${doc.identifier}/${encodeURIComponent(name).replace(/%2F/g, "/")}`,
          mediaType: "mp4",
          category,
          quality: { label: q },
          durationSeconds: durationSeconds(file),
          playable: true,
          _fileIdentity: identity,
        });
      }
    }
  });

  await Promise.all(workers);
  const playlistAssets = assets.slice(0, Math.max(1, maxAssets));
  const playlist: any = playlistAssets.map((asset, index) => ({
    id: `${channelId}-${index + 1}`,
    title: asset.title,
    archivePath: asset.mediaUrl,
    durationSeconds: asset.durationSeconds,
    mediaType: "video",
    assetId: asset.id,
    category: asset.category,
  }));

  const channel: PlayoutChannel = {
    id: channelId,
    name: channelName,
    playlist: playlistAssets,
    loop: true,
    shuffle: false,
    maxAssets,
    programs: playlist,
  } as PlayoutChannel;

  const sources: ChannelSource[] = playlistAssets.map(asset => ({
    id: `src-${asset.id}`,
    channelId,
    type: "direct_archive",
    url: asset.mediaUrl,
    title: asset.title,
  } as ChannelSource));

  setChannelSources(channelId, sources);
  addChannel({
    id: channelId,
    name: channelName,
    sources,
  } as any);

  return channel;
}
