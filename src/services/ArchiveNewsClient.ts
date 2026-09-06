export interface ArchiveNewsSource {
  id: "fox" | "cnn" | "msnbc" | "bbc";
  name: string;
  collection: string;
  callsign: string;
}

export interface ArchivePlayableItem {
  sourceId: string;
  provider: "archive.org";
  identifier: string;
  title: string;
  filename: string;
  size?: number;
  mediaPath: string;
  proxyUrl: string;
  state: "PLAYABLE";
}

export async function getArchiveNewsSources(): Promise<ArchiveNewsSource[]> {
  const response = await fetch("/api/news/archive/sources");
  if (!response.ok) throw new Error(`News source API HTTP ${response.status}`);
  const data = await response.json();
  return data.sources || [];
}

export async function getArchiveNews(
  source: ArchiveNewsSource["id"],
  page = 1,
  rows = 20
): Promise<{ found: number; playable: ArchivePlayableItem[] }> {
  const response = await fetch(
    `/api/news/archive/${encodeURIComponent(source)}?page=${page}&rows=${rows}`
  );

  if (!response.ok) {
    throw new Error(`Archive news HTTP ${response.status}`);
  }

  const data = await response.json();
  return {
    found: Number(data.found || 0),
    playable: Array.isArray(data.playable) ? data.playable : [],
  };
}

export function playUrl(item: ArchivePlayableItem): string {
  if (!item.proxyUrl) throw new Error("Refusing empty media URL");
  return item.proxyUrl;
}
