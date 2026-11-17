import type { Express } from 'express';

/* Airport weather (METAR / TAF) from AviationWeather.gov for the Weather page.
 * Why a route: that service refuses browser (CORS) calls and asks for a User-Agent, so the browser asks us and we ask it.
 * Only two fixed upstream URLs are ever built, from validated numbers or airport codes (no SSRF surface).
 * Upstream limit is 100 requests/min: answers are cached 60 s and we never send more than 60 upstream calls/min in total. */
export const AVIATION_BASE = 'https://aviationweather.gov/api/data';
const USER_AGENT = 'AJN-Precision-Engineering/1.0 (weather page; open-source use)';
const FRESH_MS = 60_000;
const STALE_MS = 10 * 60_000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_UPSTREAM_PER_MIN = 60;
const MAX_CACHE = 300;

export interface AviationDeps { fetchImpl: typeof fetch; now: () => number; timeoutMs: number; cache: Map<string, { at: number; data: unknown[] }>; calls: number[] }
export const defaultAviationDeps = (): AviationDeps => ({ fetchImpl: fetch, now: Date.now, timeoutMs: 8000, cache: new Map(), calls: [] });
export interface AviationResult { status: number; body: Record<string, unknown> }

const oneNumber = (v: unknown): number | null => { if (typeof v !== 'string' || !/^-?\d{1,3}(\.\d{1,6})?$/.test(v)) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
/** Search box of about 50 miles around a place; the centre is rounded to 0.1 degree so nearby requests share one cached answer. */
export function metarUrl(query: Record<string, unknown>): string | null {
  const lat = oneNumber(query.lat); const lon = oneNumber(query.lon);
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const cLat = Math.round(lat * 10) / 10; const cLon = Math.round(lon * 10) / 10;
  const dLon = Math.min(8, 0.75 / Math.max(0.2, Math.cos((cLat * Math.PI) / 180)));
  const f = (n: number) => n.toFixed(2);
  return `${AVIATION_BASE}/metar?bbox=${f(Math.max(-90, cLat - 0.75))},${f(Math.max(-180, cLon - dLon))},${f(Math.min(90, cLat + 0.75))},${f(Math.min(180, cLon + dLon))}&format=json`;
}
export function tafUrl(query: Record<string, unknown>): string | null {
  const raw = typeof query.ids === 'string' ? query.ids.toUpperCase().split(',') : [];
  if (raw.length < 1 || raw.length > 3 || !raw.every((i) => /^[A-Z0-9]{3,4}$/.test(i))) return null;
  return `${AVIATION_BASE}/taf?ids=${raw.join(',')}&format=json`;
}

async function upstream(url: string, d: AviationDeps): Promise<unknown[]> {
  const t = d.now(); d.calls = d.calls.filter((c) => t - c < 60_000);
  if (d.calls.length >= MAX_UPSTREAM_PER_MIN) throw Object.assign(new Error('Our own upstream limit was reached; try again in a minute'), { status: 429 });
  d.calls.push(t);
  const res = await d.fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(d.timeoutMs) });
  if (res.status === 204) return [];
  if (!res.ok) throw Object.assign(new Error(`AviationWeather.gov answered HTTP ${res.status}`), { status: res.status });
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error('AviationWeather.gov answer was too large');
  const json: unknown = text.trim() ? JSON.parse(text) : [];
  if (!Array.isArray(json)) throw new Error('AviationWeather.gov sent an unexpected answer');
  return json;
}

export async function handleAviation(kind: 'metar' | 'taf', query: Record<string, unknown>, d: AviationDeps): Promise<AviationResult> {
  const url = kind === 'metar' ? metarUrl(query) : tafUrl(query);
  if (!url) return { status: 400, body: { ok: false, error: kind === 'metar' ? 'lat and lon must be numbers' : 'ids must be 1 to 3 airport codes' } };
  const hit = d.cache.get(url); const now = d.now();
  if (hit && now - hit.at < FRESH_MS) return { status: 200, body: { ok: true, source: 'aviationweather.gov', fetchedAt: hit.at, stale: false, data: hit.data } };
  try {
    const data = await upstream(url, d);
    if (d.cache.size >= MAX_CACHE) d.cache.delete(d.cache.keys().next().value as string);
    d.cache.set(url, { at: now, data });
    return { status: 200, body: { ok: true, source: 'aviationweather.gov', fetchedAt: now, stale: false, data } };
  } catch (e) {
    /* A recent real answer may be served, flagged stale with its own timestamp; anything older is an honest failure. */
    if (hit && now - hit.at < STALE_MS) return { status: 200, body: { ok: true, source: 'aviationweather.gov', fetchedAt: hit.at, stale: true, data: hit.data } };
    const status = (e as { status?: number }).status === 429 ? 429 : 502;
    return { status, body: { ok: false, error: e instanceof Error ? e.message : 'AviationWeather.gov is unreachable' } };
  }
}

export function registerAviationRoutes(app: Express, deps: AviationDeps = defaultAviationDeps()): void {
  for (const kind of ['metar', 'taf'] as const) {
    app.get(`/api/aviation/${kind}`, async (req, res) => {
      const r = await handleAviation(kind, req.query as Record<string, unknown>, deps);
      res.status(r.status).set('Cache-Control', 'private, max-age=30').json(r.body);
    });
  }
}
