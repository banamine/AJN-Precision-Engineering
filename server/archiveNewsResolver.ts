export const ARCHIVE_NEWS_SOURCES = [
  { id: "fox", name: "FOX News", collection: "TV-FOXNEWSW", callsign: "FOXNEWSW" },
  { id: "cnn", name: "CNN", collection: "TV-CNNW", callsign: "CNNW" },
  { id: "msnbc", name: "MSNBC", collection: "TV-MSNBCW", callsign: "MSNBCW" },
  { id: "bbc", name: "BBC News", collection: "TV-BBCNEWS", callsign: "BBCNEWS" },
] as const;

export type ArchiveNewsSourceId = typeof ARCHIVE_NEWS_SOURCES[number]["id"];

const METADATA_TIMEOUT_MS = 15000;

function encodePathPart(value: string): string {
  return encodeURIComponent(value);
}

function pickMp4(files: any[]): any | null {
  const candidates = files.filter((file) => {
    const name = String(file?.name || "");
    const format = String(file?.format || "").toLowerCase();
    return /\.mp4$/i.test(name) &&
      !/metadata|itemimage|thumb/i.test(name) &&
      (format.includes("video") || format.includes("mp4") || !format);
  });

  candidates.sort((a, b) => {
    const aSize = Number(a?.size || 0);
    const bSize = Number(b?.size || 0);
    return bSize - aSize;
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

export async function resolveArchiveItem(
  identifier: string,
  sourceId: ArchiveNewsSourceId
): Promise<ArchivePlayableItem | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), METADATA_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://archive.org/metadata/${encodeURIComponent(identifier)}`,
      {
        signal: controller.signal,
        headers: {
          "User-Agent": "AJN-Media-Console/ArchiveResolver",
          "Accept": "application/json",
        },
      }
    );

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
    const mediaPath = `/download/${encodePathPart(identifier)}/${filename
      .split("/")
      .map(encodePathPart)
      .join("/")}`;

    const base = typeof window === "undefined" ? "" : window.location.origin;
    const proxyUrl = `${base}/api/archive/proxy?path=${encodeURIComponent(mediaPath)}`;

    return {
      sourceId,
      provider: "archive.org",
      identifier,
      title: String(
        data?.metadata?.title ||
        identifier.replace(/_/g, " ")
      ),
      timestamp: data?.metadata?.date || undefined,
      filename,
      size: Number(file.size || 0) || undefined,
      contentType: "video/mp4",
      mediaPath,
      proxyUrl,
      state: "PLAYABLE",
    };
  } catch (error: any) {
    if (error?.name === "AbortError") {
      console.warn(`[ArchiveResolver] ${identifier}: metadata timeout`);
    } else {
      console.warn(`[ArchiveResolver] ${identifier}: ${error?.message || error}`);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function searchArchiveNews(
  sourceId: ArchiveNewsSourceId,
  options: { page?: number; rows?: number } = {}
) {
  const source = ARCHIVE_NEWS_SOURCES.find((item) => item.id === sourceId)!;
  const page = Math.max(1, options.page || 1);
  const rows = Math.min(100, Math.max(1, options.rows || 20));

  const query =
    `collection:${source.collection} AND mediatype:movies`;

  const url = new URL("https://archive.org/advancedsearch.php");
  url.searchParams.set("q", query);
  url.searchParams.set("fl[]", "identifier,title,date");
  url.searchParams.set("sort[]", "date desc");
  url.searchParams.set("rows", String(rows));
  url.searchParams.set("page", String(page));
  url.searchParams.set("output", "json");

  const response = await fetch(url, {
    headers: { "User-Agent": "AJN-Media-Console/ArchiveResolver" },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) throw new Error(`Archive search HTTP ${response.status}`);

  const data: any = await response.json();
  const docs = Array.isArray(data?.response?.docs) ? data.response.docs : [];

  // Metadata is authoritative. Discovery alone never creates a playable URL.
  const playable: ArchivePlayableItem[] = [];
  for (const doc of docs) {
    const item = await resolveArchiveItem(String(doc.identifier), sourceId);
    if (item) playable.push(item);
  }

  return {
    source: source,
    found: Number(data?.response?.numFound || 0),
    playable,
  };
}
