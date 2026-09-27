/* Bounded server-side fetch for untrusted upstreams (playlists, proxied media).
 * - Redirects are followed by hand, and EVERY hop must pass the same host
 *   check (https, no custom port, allowed host). fetch's own redirect:'follow'
 *   only let us check the final URL, after the request had already been made.
 * - A timeout bounds the whole exchange; readTextCapped bounds the body size.
 * No Node APIs at import time: the browser bundle may evaluate this module. */

export type HostCheck = (host: string) => boolean;
export const MAX_REDIRECTS = 5;

export class SafeFetchError extends Error {
  constructor(message: string, readonly reason: 'blocked' | 'redirect_blocked' | 'too_many_redirects' | 'too_large' | 'timeout' | 'network') { super(message); }
}

/** Hosts that must never be fetched even when a list would allow them. */
function privateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h === 'metadata.google.internal') return true;
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (h.includes(':')) return h === '::1' || h === '::' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith('::ffff:');
  return false;
}

/** https, default port, not a private/loopback literal, and allowed by `allow`. */
export function urlAllowed(u: URL, allow: HostCheck): boolean {
  return u.protocol === 'https:' && !u.port && !u.username && !u.password && !privateHost(u.hostname) && allow(u.hostname);
}
export const anyPublicHost: HostCheck = () => true;

export interface SafeFetchOptions {
  allow: HostCheck;
  timeoutMs?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

/** Fetch `url`, following up to MAX_REDIRECTS redirects, each hop checked. */
export async function safeFetch(url: string | URL, opts: SafeFetchOptions): Promise<{ res: Response; finalUrl: URL }> {
  const f = opts.fetchImpl ?? fetch;
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 10_000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  let current = new URL(String(url));
  if (!urlAllowed(current, opts.allow)) throw new SafeFetchError(`host not allowed: ${current.hostname}`, 'blocked');
  for (let hop = 0; ; hop++) {
    let res: Response;
    try { res = await f(current, { headers: opts.headers, redirect: 'manual', signal }); }
    catch (e: any) {
      if (timeout.aborted) throw new SafeFetchError(`timed out after ${opts.timeoutMs ?? 10_000} ms`, 'timeout');
      throw e?.name === 'AbortError' ? e : new SafeFetchError(String(e?.message ?? e), 'network');
    }
    const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!loc) return { res, finalUrl: current };
    await res.body?.cancel().catch(() => {});
    if (hop >= MAX_REDIRECTS) throw new SafeFetchError(`more than ${MAX_REDIRECTS} redirects`, 'too_many_redirects');
    const next = new URL(loc, current);
    if (!urlAllowed(next, opts.allow)) throw new SafeFetchError(`redirect to ${next.protocol}//${next.host} not allowed`, 'redirect_blocked');
    current = next;
  }
}

/** Read a text body, aborting once it exceeds maxBytes. */
export async function readTextCapped(res: Response, maxBytes: number): Promise<string> {
  const len = Number(res.headers.get('content-length'));
  if (len > maxBytes) { await res.body?.cancel().catch(() => {}); throw new SafeFetchError(`body ${len} bytes exceeds ${maxBytes}`, 'too_large'); }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel().catch(() => {}); throw new SafeFetchError(`body exceeds ${maxBytes} bytes`, 'too_large'); }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.byteLength; }
  return new TextDecoder().decode(all);
}

export const PLAYLIST_MAX_BYTES = 1024 * 1024;       // an HLS playlist: a few KB in practice
export const SOURCE_LIST_MAX_BYTES = 5 * 1024 * 1024; // an M3U channel list: < 1 MB in practice
