/* Ad-break map for iHeart / Triton podcast downloads (Kuhner Report and every other iHeart show).
 *
 * Why this exists: the enclosure link of an iHeart show redirects through several hosts. The redirect that Triton sends to the
 * listener carries the break layout of the CLEAN episode in its query string:  o = clean length (ms), pt = {"n": ads before the
 * show}, mt = [{"o": ms into the clean show, "n": ads}, ...] (one entry per mid-show break), tt = {"n": ads after the show}.
 * Checked on 7 real Kuhner segments (2026-11-21): mid-break offsets matched the breaks found in the downloaded audio to the second.
 *
 * The browser cannot read an intermediate redirect (fetch hides it), so this server walks the chain by hand, stops at the first
 * hop whose address carries the markers, and never requests the audio itself. Only podcast enclosures the app published are
 * accepted; every hop is checked with the same host rules as server/safeFetch.ts. No marker found = adMap null (said plainly,
 * nothing is invented). */
import type { Express } from 'express';
import { anyPublicHost, urlAllowed } from './safeFetch';
import { findEpisodeByUrl } from './podcasts';

export type PodKind = 'pre' | 'mid' | 'post';
export interface AdMapPod {
  kind: PodKind;
  /** Ad slots Triton asked for in this break (not a promise they were all filled). */
  ads: number;
  /** Seconds into the CLEAN show where the break sits: 0 for the opening, the clean length for the closing break (null if unknown). */
  cleanAt: number | null;
}
export interface AdMap { provider: 'triton'; cleanSeconds: number | null; pods: AdMapPod[] }
export interface AdMapResponse { feedSeconds: number | null; adMap: AdMap | null }

const MAX_CLEAN_SECONDS = 12 * 3600;
const MAX_MIDS = 12;
const MAX_ADS_PER_POD = 20;

function jsonParam(v: string | null): unknown { if (!v || (v[0] !== '{' && v[0] !== '[')) return undefined; try { return JSON.parse(v); } catch { return undefined; } }
function adCount(v: unknown): number {
  const n = Number((v as { n?: unknown } | null | undefined)?.n);
  return Number.isInteger(n) && n > 0 && n <= MAX_ADS_PER_POD ? n : 0;
}

/** Pure: read the break layout out of ONE redirect address. null when the address carries none. */
export function parseAdMap(href: string): AdMap | null {
  let q: URLSearchParams;
  try { q = new URL(href).searchParams; } catch { return null; }
  const mtRaw = q.getAll('mt').map(jsonParam).find((x) => Array.isArray(x)) as Array<{ o?: unknown; n?: unknown }> | undefined;
  const pt = jsonParam(q.get('pt')); const tt = jsonParam(q.get('tt'));
  if (!mtRaw && pt === undefined && tt === undefined) return null;
  const oMs = Number(q.get('o'));
  const cleanSeconds = Number.isFinite(oMs) && oMs >= 60_000 && oMs <= MAX_CLEAN_SECONDS * 1000 ? oMs / 1000 : null;
  const pods: AdMapPod[] = [];
  const pre = adCount(pt); if (pre) pods.push({ kind: 'pre', ads: pre, cleanAt: 0 });
  const mids: AdMapPod[] = [];
  for (const m of (mtRaw ?? []).slice(0, MAX_MIDS)) {
    const at = Number(m?.o) / 1000; const ads = adCount(m);
    if (!ads || !Number.isFinite(at) || at <= 0 || (cleanSeconds !== null && at >= cleanSeconds)) continue;
    mids.push({ kind: 'mid', ads, cleanAt: Math.round(at * 10) / 10 });
  }
  mids.sort((a, b) => (a.cleanAt as number) - (b.cleanAt as number));
  pods.push(...mids);
  const post = adCount(tt); if (post) pods.push({ kind: 'post', ads: post, cleanAt: cleanSeconds });
  return pods.length ? { provider: 'triton', cleanSeconds, pods } : null;
}

/** Walk the redirect chain by hand (each hop host-checked, max 14 hops) and return the layout from the first hop that carries it.
 *  Asks for one byte with Range so a server that ignores HEAD never streams audio, and stops before the marker hop is even requested. */
export async function fetchAdMap(url: string, fetchImpl: typeof fetch = fetch): Promise<AdMap | null> {
  let cur = new URL(url);
  const timeout = AbortSignal.timeout(12_000);
  for (let hop = 0; hop <= 14; hop++) {
    if (!urlAllowed(cur, anyPublicHost)) throw new Error(`host not allowed: ${cur.hostname}`);
    const res = await fetchImpl(cur, { headers: { 'User-Agent': 'AJN-Precision-Engineering/1.0 (podcast ad map)', Range: 'bytes=0-0' }, redirect: 'manual', signal: timeout });
    await res.body?.cancel().catch(() => {});
    const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!loc) return null; // reached the audio without seeing any markers
    cur = new URL(loc, cur);
    const map = parseAdMap(cur.href);
    if (map) return map;
  }
  return null;
}

const TTL_MS = 6 * 3600_000; const FAIL_TTL_MS = 2 * 60_000; const MAX_CACHE = 400;
const cache = new Map<string, { at: number; ok: boolean; value: AdMapResponse | string }>();

async function episodeFeedSeconds(url: string): Promise<{ found: boolean; seconds: number | null }> {
  const hit = await findEpisodeByUrl(url);
  if (!hit) return { found: false, seconds: null };
  const d = hit.episode.durationSeconds;
  return { found: true, seconds: Number.isFinite(d) && (d as number) > 0 ? (d as number) : null };
}

export async function adMapFor(url: string, fetchImpl?: typeof fetch): Promise<{ status: 200; body: AdMapResponse } | { status: 404 | 502; error: string }> {
  const ep = await episodeFeedSeconds(url);
  if (!ep.found) return { status: 404, error: 'Not a known podcast enclosure' };
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < (hit.ok ? TTL_MS : FAIL_TTL_MS)) {
    return hit.ok ? { status: 200, body: hit.value as AdMapResponse } : { status: 502, error: hit.value as string };
  }
  try {
    const adMap = await fetchAdMap(url, fetchImpl);
    const body: AdMapResponse = { feedSeconds: ep.seconds, adMap };
    if (cache.size >= MAX_CACHE) cache.clear();
    cache.set(url, { at: Date.now(), ok: true, value: body });
    return { status: 200, body };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (cache.size >= MAX_CACHE) cache.clear();
    cache.set(url, { at: Date.now(), ok: false, value: msg });
    return { status: 502, error: msg };
  }
}

export function registerPodcastAdMapRoute(app: Express): void {
  app.get('/api/podcast/ad-map', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const r = await adMapFor(String(req.query.url ?? ''));
    if (r.status === 200) return res.json(r.body);
    return res.status(r.status).json({ error: r.error });
  });
}
