import type { NewsProvider, ResolveResult, ResolvedMedia } from "../../src/news/contract";
import { NEWS_PROVIDERS, parseNewsInput, providerFor } from "../../src/news/registry";

const MAX_BODY_CHARS = 64 * 1024;
const TTL_MS = 10 * 60 * 1000;
const MAX_CACHE = 200;

type FetchLike = typeof fetch;

interface CacheEntry {
  at: number;
  media: ResolvedMedia;
}

const cache = new Map<string, CacheEntry>();

export function clearNewsResolveCache(): void {
  cache.clear();
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 500) : null;
}

function httpsOrNull(value: unknown): string | null {
  const text = str(value);
  if (!text) return null;
  try {
    return new URL(text).protocol === "https:" ? text : null;
  } catch {
    return null;
  }
}

function rumbleAuthorUrlOrNull(value: unknown): string | null {
  const text = str(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:"
      && url.hostname === "rumble.com"
      && !url.username && !url.password && !url.port
      && /^\/(?:c|user)\/[^/]+(?:\/.*)?$/i.test(url.pathname)
      ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a pasted/picked video link to an embed id through the provider's oEmbed endpoint.
 * The server only ever calls a fixed provider host; the user's text is parsed by the provider's
 * strict parser first and is passed as an encoded query value, never as a host or path.
 * Failures are returned as {ok:false}; failures are never cached.
 */
export async function resolveNewsLink(
  rawInput: string,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 5000,
  now: () => number = Date.now,
  providers: readonly NewsProvider[] = NEWS_PROVIDERS,
): Promise<ResolveResult> {
  const parsed = parseNewsInput(rawInput, providers);
  if (!parsed) return { ok: false, reason: "invalid-input" };
  const provider = providerFor(parsed.provider, providers);
  if (!provider) return { ok: false, reason: "unsupported" };

  // Embed ids and embed URLs need no lookup, but the lookup verifies the video still exists.
  const lookupTarget = parsed.kind === "page" && parsed.pageUrl ? parsed.pageUrl : provider.lookupUrlForEmbed(parsed.id);

  const key = `${parsed.provider}:${lookupTarget}`;
  const hit = cache.get(key);
  if (hit && now() - hit.at < TTL_MS) return { ok: true, media: hit.media };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(provider.oembedUrl(lookupTarget), {
      signal: controller.signal,
      redirect: "error",
      headers: { Accept: "application/json" },
    });
    if (response.status === 404) return { ok: false, reason: "not-found" };
    if (!response.ok) return { ok: false, reason: "upstream-error", detail: `HTTP ${response.status}` };

    const text = await response.text();
    if (text.length > MAX_BODY_CHARS) return { ok: false, reason: "bad-response", detail: "too large" };

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { ok: false, reason: "bad-response", detail: "not JSON" };
    }

    const embedId = provider.extractEmbedId(String(body.html ?? ""));
    const title = str(body.title);
    if (!embedId || !title) return { ok: false, reason: "bad-response", detail: "missing embed id or title" };

    const duration = typeof body.duration === "number" && Number.isFinite(body.duration) && body.duration >= 0 ? Math.round(body.duration) : null;
    const media: ResolvedMedia = {
      provider: provider.id,
      embedId,
      embedSrc: provider.embedSrc(embedId),
      title,
      author: str(body.author_name),
      authorUrl: rumbleAuthorUrlOrNull(body.author_url),
      thumbnailUrl: httpsOrNull(body.thumbnail_url),
      durationSec: duration,
      resolvedAt: new Date(now()).toISOString(),
    };

    if (cache.size >= MAX_CACHE) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, { at: now(), media });
    return { ok: true, media };
  } catch (error) {
    const aborted = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
    return aborted ? { ok: false, reason: "timeout" } : { ok: false, reason: "upstream-error", detail: "network" };
  } finally {
    clearTimeout(timer);
  }
}
