// GET /api/live-radio/nowplaying?id=radio:...  Song title/artist/cover for the few live stations whose OWN feed was verified.
// Only ids in NOW_PLAYING_STATIONS are served; the upstream URL is built from the config, never from the request.
// One upstream fetch per station per 20 s (single-flight + short cache) so many listeners cost the station feed nothing extra.
import type { Express } from 'express';
import { fetchNowPlaying, httpTextFetcher, httpIcyReader, type IcyReader, type NowPlaying, type NowPlayingConfig, type TextFetcher } from './radioNowPlaying.js';
import usStationsJson from './data/nowPlayingStations.json';

/** Verified 2026-10-14 from the station's own feed (see claude/AJN_Canada_NowPlaying_Scan_Results_2026-10-14.md). Add a station only after probing its feed. */
/** US stations: feeds found by scan_us_nowplaying.py on 2026-10-14 (SomaFM, Live365, Triton, iHeart inline). See claude/AJN_US_NowPlaying_Scan_Results_2026-10-14.md. */
const US_STATIONS = usStationsJson as unknown as Record<string, NowPlayingConfig>;
export const NOW_PLAYING_STATIONS: Readonly<Record<string, NowPlayingConfig>> = {
  ...US_STATIONS,
  'radio:rb-b8b3601f-6576-4c36-a75e-b70e3082afb3': { kind: 'corus-s3', code: 'CFMIFM' },   // CFMI Rock 101.1 Vancouver
  'radio:rb-96217747-0601-11e8-ae97-52543be04c81': { kind: 'corus-s3', code: 'CFOXFM' },   // CFOX 99.3 Vancouver
  'radio:rb-d8275ce6-a7dd-4d91-9703-55eca0410744': { kind: 'triton', mount: 'CJADAM' },    // CJAD 800 Montreal
  'radio:ca-cjad': { kind: 'triton', mount: 'CJADAM' },                                    // CJAD 800 (curated entry)
  'radio:rb-cff0d32f-9773-4239-8f0c-0e4d44ccb356': { kind: 'triton', mount: 'CFIXFMAAC' }, // CFIX Rouge FM 96.9 Saguenay
  'radio:rb-b2bbacb0-97aa-416d-be38-ebf0ff896b49': { kind: 'triton', mount: 'CKLKFMAAC' }, // CKLK 88.5 The Lake, Grimsby
  // Classic Hits 109 family: the station's own api/metadata.php + api/history.php (verified 2026-10-14).
  'radio:rb-34135e58-c4b4-4aaa-89b3-c42254ba7307': { kind: 'ch109', slug: '70s-80s-90s' },
  'radio:ch109-original': { kind: 'ch109', slug: 'classic-hits' },
  'radio:rb-c1cf4123-bf67-4058-a89a-70008a531976': { kind: 'ch109', slug: 'country-hits' },
  'radio:ch109-classic-rock-109': { kind: 'ch109', slug: 'classic-rock-109' },
  'radio:rb-c4481bd4-0a22-44f5-bec0-1b2556ddbe89': { kind: 'ch109', slug: 'soft-rock' },
  'radio:ch109-warm-109': { kind: 'ch109', slug: 'warm-109' },
  'radio:ch109-summertime-hits': { kind: 'ch109', slug: 'summertime-hits' },
  'radio:ch109-one-hit-wonders': { kind: 'ch109', slug: 'one-hit-wonders' },
  'radio:ch109-christmas': { kind: 'ch109', slug: 'christmas' },
};

export type NowPlayingResponse = NowPlaying | { state: 'unsupported'; reason: string };
export const CACHE_MS = 20_000;
const MAX_ENTRIES = 300;
const MAX_ICY_PARALLEL = 4;

export function createNowPlayingService(fetchText: TextFetcher = httpTextFetcher, now: () => number = Date.now, readIcy: IcyReader = httpIcyReader) {
  // Stream reads (iHeart) are heavier than JSON/XML calls: at most MAX_ICY_PARALLEL at once, the rest wait their turn.
  let icyActive = 0; const icyWait: Array<() => void> = [];
  const limitedIcy: IcyReader = async (url, signal) => {
    if (icyActive >= MAX_ICY_PARALLEL) await new Promise<void>((r) => icyWait.push(r));
    icyActive++;
    try { return await readIcy(url, signal); } finally { icyActive--; icyWait.shift()?.(); }
  };
  const cache = new Map<string, { at: number; value: NowPlaying }>();
  const inflight = new Map<string, Promise<NowPlaying>>();
  return async function get(id: string): Promise<NowPlayingResponse> {
    const cfg = Object.prototype.hasOwnProperty.call(NOW_PLAYING_STATIONS, id) ? NOW_PLAYING_STATIONS[id] : undefined;
    if (!cfg) return { state: 'unsupported', reason: 'this station has no verified song feed' };
    const hit = cache.get(id);
    if (hit && now() - hit.at < CACHE_MS) return hit.value;
    let p = inflight.get(id);
    if (!p) {
      p = fetchNowPlaying(cfg, fetchText, now(), 6000, limitedIcy).then((v) => {
        // Failures are returned to the caller but never cached as success.
        if (v.state === 'ok' || v.state === 'stale') {
          cache.delete(id); cache.set(id, { at: now(), value: v });
          while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
        }
        return v;
      }).finally(() => inflight.delete(id));
      inflight.set(id, p);
    }
    return p;
  };
}

export function registerNowPlayingRoute(app: Express, service = createNowPlayingService()): void {
  app.get('/api/live-radio/nowplaying', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const id = typeof req.query.id === 'string' ? req.query.id.slice(0, 120) : '';
    if (!id) return res.status(400).json({ error: 'invalid_request', message: 'id is required' });
    try { res.json(await service(id)); }
    catch (e) { res.status(502).json({ state: 'error', reason: `now-playing failed: ${(e as Error).message}` }); }
  });
}
