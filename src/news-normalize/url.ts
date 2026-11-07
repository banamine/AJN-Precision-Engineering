export type ParseUrlErrorReason = 'malformed' | 'unsupported-scheme' | 'credentials' | 'too-long' | 'missing';

const MAX_URL_CHARS = 4096;

/** Article/source navigation URL: http: or https:, no credentials. Never rewrites http to https. */
export function parseArticleUrl(
  v: unknown
): { ok: true; url: string } | { ok: false; reason: ParseUrlErrorReason } {
  if (v === undefined || v === null || v === '') return { ok: false, reason: 'missing' };
  if (typeof v !== 'string') return { ok: false, reason: 'malformed' };
  if (v.length > MAX_URL_CHARS) return { ok: false, reason: 'too-long' };
  try {
    const parsed = new URL(v);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false, reason: 'unsupported-scheme' };
    if (parsed.username || parsed.password) return { ok: false, reason: 'credentials' };
    if (!parsed.hostname) return { ok: false, reason: 'missing' };
    return { ok: true, url: parsed.toString() };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
}

/** Embedded image URL: https: only, no credentials. */
export function parseImageUrl(v: unknown): string | null {
  if (typeof v !== 'string' || !v || v.length > MAX_URL_CHARS) return null;
  try {
    const parsed = new URL(v);
    if (parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password) return null;
    if (!parsed.hostname) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/** Comparison key: lowercase host, no fragment, default port dropped, ONLY the listed tracking params removed. */
export function urlKey(urlStr: string, trackingParams: readonly string[]): string {
  try {
    const parsed = new URL(urlStr);
    parsed.hash = '';
    const drop = new Set(trackingParams.map((p) => p.toLowerCase()));
    for (const key of [...new Set(parsed.searchParams.keys())]) {
      if (drop.has(key.toLowerCase())) parsed.searchParams.delete(key);
    }
    return parsed.toString();
  } catch {
    return urlStr;
  }
}
