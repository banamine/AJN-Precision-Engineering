/**
 * AJN RSS service contract.
 *
 * The RSS transport may be served by the backend, but any AJN media URL
 * promoted as playable must use HTTPS and archive.alexjoneslive.com.
 * Invalid media references are rejected rather than silently rewritten.
 */

export const AJN_MEDIA_HOST = "archive.alexjoneslive.com";
export const AJN_MEDIA_PROTOCOL = "https:";

export interface AjnRssItem {
  id: string;
  source: string;
  sourceName: string;
  title: string;
  link: string;
  publishedAt: string | null;
  description: string;
  imageUrl: string | null;
  feedUrl: string;
  fetchedAt: string;
  guid: string | null;
  category: string | null;
  status: string;
  freshness: string;
  mediaUrl?: string | null;
  mediaUrls?: string[];
}

export interface AjnRssSourceState {
  id: string;
  displayName: string;
  feedUrl: string;
  enabled: boolean;
  status: string;
  itemCount: number;
  error: string | null;
}

export interface AjnRssSnapshot {
  items: AjnRssItem[];
  sources: AjnRssSourceState[];
  fetchedAt: string | null;
  errors: Array<{
    source: string;
    sourceName: string;
    kind: string;
    message: string;
    httpStatus: number | null;
  }>;
}

export interface AjnMediaContractResult {
  valid: boolean;
  url: string | null;
  reason?: string;
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Strict AJN media contract: HTTPS + exact archive delivery hostname. */
export function validateAjnMediaUrl(rawUrl: unknown): AjnMediaContractResult {
  const value = asTrimmedString(rawUrl);
  if (!value) return { valid: false, url: null, reason: "Media URL is empty." };

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { valid: false, url: value, reason: "Media URL is not a valid absolute URL." };
  }

  if (parsed.protocol !== AJN_MEDIA_PROTOCOL) {
    return { valid: false, url: value, reason: "AJN media requires HTTPS." };
  }

  if (parsed.hostname !== AJN_MEDIA_HOST) {
    return {
      valid: false,
      url: value,
      reason: `AJN media requires host ${AJN_MEDIA_HOST}.`,
    };
  }

  return { valid: true, url: parsed.toString() };
}

function normalizeItem(raw: unknown): AjnRssItem | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const title = asTrimmedString(value.title);
  if (!title) return null;

  const mediaUrls = Array.isArray(value.mediaUrls)
    ? value.mediaUrls.filter((entry): entry is string => typeof entry === "string")
    : [];

  return {
    id: asTrimmedString(value.id) || `${asTrimmedString(value.source)}:${title}`,
    source: asTrimmedString(value.source),
    sourceName: asTrimmedString(value.sourceName) || asTrimmedString(value.source),
    title,
    link: asTrimmedString(value.link),
    publishedAt: value.publishedAt ? asTrimmedString(value.publishedAt) : null,
    description: asTrimmedString(value.description),
    imageUrl: value.imageUrl ? asTrimmedString(value.imageUrl) : null,
    feedUrl: asTrimmedString(value.feedUrl),
    fetchedAt: asTrimmedString(value.fetchedAt),
    guid: value.guid ? asTrimmedString(value.guid) : null,
    category: value.category ? asTrimmedString(value.category) : null,
    status: asTrimmedString(value.status) || "active",
    freshness: asTrimmedString(value.freshness) || "UNKNOWN",
    mediaUrl: value.mediaUrl ? asTrimmedString(value.mediaUrl) : null,
    mediaUrls,
  };
}

export function normalizeAjnRssSnapshot(raw: unknown): AjnRssSnapshot {
  if (!raw || typeof raw !== "object") {
    return { items: [], sources: [], fetchedAt: null, errors: [] };
  }

  const value = raw as Record<string, unknown>;
  const items = Array.isArray(value.items)
    ? value.items.map(normalizeItem).filter((item): item is AjnRssItem => Boolean(item))
    : [];

  const sources = Array.isArray(value.sources)
    ? value.sources.map((entry) => {
        const source = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
        return {
          id: asTrimmedString(source.id),
          displayName: asTrimmedString(source.displayName) || asTrimmedString(source.id),
          feedUrl: asTrimmedString(source.feedUrl),
          enabled: source.enabled !== false,
          status: asTrimmedString(source.status) || "idle",
          itemCount: Number(source.itemCount) || 0,
          error: source.error ? asTrimmedString(source.error) : null,
        };
      })
    : [];

  const errors = Array.isArray(value.errors)
    ? value.errors.map((entry) => {
        const error = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
        return {
          source: asTrimmedString(error.source),
          sourceName: asTrimmedString(error.sourceName),
          kind: asTrimmedString(error.kind),
          message: asTrimmedString(error.message),
          httpStatus: Number.isFinite(Number(error.httpStatus)) ? Number(error.httpStatus) : null,
        };
      })
    : [];

  return {
    items,
    sources,
    fetchedAt: value.fetchedAt ? asTrimmedString(value.fetchedAt) : null,
    errors,
  };
}

export function validateAjnRssItemMedia(item: AjnRssItem): AjnMediaContractResult[] {
  const candidates = [
    item.mediaUrl,
    ...(item.mediaUrls || []),
  ].filter(Boolean);

  return candidates.map(validateAjnMediaUrl);
}

/**
 * Poll the normalized backend RSS/news endpoint.
 * The browser never fetches third-party RSS origins directly, avoiding CORS
 * and keeping feed retrieval behind the authoritative server boundary.
 */
export async function fetchAjnRssNews(options: {
  fresh?: boolean;
  limit?: number;
  signal?: AbortSignal;
} = {}): Promise<AjnRssSnapshot> {
  const params = new URLSearchParams();
  params.set("limit", String(Math.max(1, Math.min(15, Math.floor(options.limit ?? 15)))));
  if (options.fresh) params.set("fresh", "true");

  const response = await fetch(`/api/v1/news?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(`AJN RSS news HTTP ${response.status}`);
  }

  return normalizeAjnRssSnapshot(await response.json());
}
