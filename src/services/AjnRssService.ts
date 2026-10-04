export const AJN_MEDIA_HOST = "archive.alexjoneslive.com";
export const AJN_MEDIA_PROTOCOL = "https:";

export interface AjnNewsItem {
  id: string;
  source: string;
  sourceName: string;
  title: string;
  link: string;
  description: string;
  publishedAt: string | null;
  mediaUrl: string | null;
}

export interface AjnNewsSnapshot {
  items: AjnNewsItem[];
  sources: Array<{
    id: string;
    displayName: string;
    feedUrl: string;
    status: string;
    itemCount: number;
    error: string | null;
  }>;
  fetchedAt: string | null;
  errors: Array<{
    source: string;
    message: string;
  }>;
}

export function validateAjnMediaUrl(rawUrl: unknown): { valid: boolean; url: string | null; reason?: string } {
  const value = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (!value) return { valid: false, url: null, reason: "Media URL is empty." };

  try {
    const url = new URL(value);
    if (url.protocol !== AJN_MEDIA_PROTOCOL) {
      return { valid: false, url: value, reason: "AJN media requires HTTPS." };
    }
    if (url.hostname !== AJN_MEDIA_HOST) {
      return { valid: false, url: value, reason: `AJN media requires host ${AJN_MEDIA_HOST}.` };
    }
    return { valid: true, url: url.toString() };
  } catch {
    return { valid: false, url: value, reason: "Media URL is not a valid absolute URL." };
  }
}

export function normalizeAjnNewsSnapshot(raw: unknown): AjnNewsSnapshot {
  if (!raw || typeof raw !== "object") return { items: [], sources: [], fetchedAt: null, errors: [] };
  const value = raw as Record<string, unknown>;
  const items = Array.isArray(value.items)
    ? value.items.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")).map((item) => ({
        id: String(item.id ?? `${item.source ?? "news"}:${item.title ?? ""}`),
        source: String(item.source ?? ""),
        sourceName: String(item.sourceName ?? item.source ?? "AJN"),
        title: String(item.title ?? "").trim(),
        link: String(item.link ?? "").trim(),
        description: String(item.description ?? "").trim(),
        publishedAt: item.publishedAt ? String(item.publishedAt) : null,
        mediaUrl: item.mediaUrl ? String(item.mediaUrl) : null,
      })).filter((item) => item.title)
    : [];
  const sources = Array.isArray(value.sources) ? value.sources.map((source) => {
    const s = (source && typeof source === "object" ? source : {}) as Record<string, unknown>;
    return {
      id: String(s.id ?? ""),
      displayName: String(s.displayName ?? s.id ?? "AJN"),
      feedUrl: String(s.feedUrl ?? ""),
      status: String(s.status ?? "unknown"),
      itemCount: Number(s.itemCount ?? 0),
      error: s.error ? String(s.error) : null,
    };
  }) : [];
  const errors = Array.isArray(value.errors) ? value.errors.map((error) => {
    const e = (error && typeof error === "object" ? error : {}) as Record<string, unknown>;
    return { source: String(e.source ?? ""), message: String(e.message ?? "News source error.") };
  }) : [];
  return {
    items,
    sources,
    fetchedAt: value.fetchedAt ? String(value.fetchedAt) : null,
    errors,
  };
}
