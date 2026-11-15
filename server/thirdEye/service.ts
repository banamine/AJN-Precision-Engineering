// Third Eye headline service. Fetches the Internet Archive Third Eye TSV, keeps parsed rows only in memory (no disk, no database),
// and serves merged stories at /api/tv-chyrons. Failures are explicit: a failed refresh never makes old data look new
// (`generatedAt` is the last SUCCESSFUL fetch), and an empty or non-table response is a failure, never cached as success.
import type { Express, Request, Response } from 'express';
import { archiveApiFetch } from '../archiveLimiter.js';
import { readTextCapped } from '../safeFetch.js';
import { buildStories, parseThirdEyeTsv, type Story, type ThirdEyeRow } from './core.js';

export const FRESH_REFRESH_MS = 10 * 60_000;        // yesterday + today (UTC days)
export const BACKFILL_REFRESH_MS = 6 * 3_600_000;   // the 5 days before that
export const BACKFILL_DAYS = 7;                     // Third Eye caps one request at 7 days
const MAX_TSV_BYTES = 16 * 1024 * 1024;
const DAY_MS = 86_400_000;

export type ChyronStatus = 'ok' | 'stale' | 'unavailable';
export interface ChyronResponse {
  status: ChyronStatus; generatedAt: string | null; newestRowUtc: string | null; coverageFromUtc: string | null;
  staleReason?: string; error?: string; total: number; items: Story[];
}
export interface ChyronService { get(opts: { hours: number; q: string; channel: string; limit: number }): Promise<ChyronResponse> }

const mdy = (ms: number): string => { const d = new Date(ms); return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`; };
const startOfUtcDay = (ms: number): number => Math.floor(ms / DAY_MS) * DAY_MS;

export function createThirdEyeService(deps: { fetchImpl?: typeof fetch; now?: () => number } = {}): ChyronService {
  const doFetch = deps.fetchImpl ?? archiveApiFetch;
  const now = deps.now ?? Date.now;
  let freshRows: ThirdEyeRow[] = []; let backRows: ThirdEyeRow[] = [];
  let freshAt = 0; let backAt = 0; let lastError: string | null = null;
  let stories: Story[] = []; let dirty = false;
  let inflightFresh: Promise<void> | null = null; let inflightBack: Promise<void> | null = null;

  async function load(dayL: number, dayR: number): Promise<ThirdEyeRow[]> {
    const url = `https://archive.org/services/third-eye.php?dayL=${mdy(dayL)}&dayR=${mdy(dayR)}`;
    const res = await doFetch(url, { signal: AbortSignal.timeout(25_000), headers: { 'User-Agent': 'AJN-Precision-Engineering/1.0' } });
    if (!res.ok) throw new Error(`Third Eye HTTP ${res.status}`);
    const rows = parseThirdEyeTsv(await readTextCapped(res, MAX_TSV_BYTES));
    if (!rows) throw new Error('Third Eye did not return a table');
    if (!rows.length) throw new Error('Third Eye returned no rows');
    return rows;
  }

  const refreshFresh = (): Promise<void> => (inflightFresh ??= (async () => {
    const t = now(); const today = startOfUtcDay(t);
    try { freshRows = await load(today - DAY_MS, today); freshAt = t; lastError = null; dirty = true; }
    catch (e) { lastError = String((e as Error)?.message ?? e).slice(0, 160); }
  })().finally(() => { inflightFresh = null; }));

  const refreshBack = (): Promise<void> => (inflightBack ??= (async () => {
    const t = now(); const today = startOfUtcDay(t);
    try { backRows = await load(today - (BACKFILL_DAYS - 1) * DAY_MS, today - 2 * DAY_MS); backAt = t; dirty = true; }
    catch (e) { lastError = lastError ?? String((e as Error)?.message ?? e).slice(0, 160); }
  })().finally(() => { inflightBack = null; }));

  return {
    async get({ hours, q, channel, limit }) {
      const t = now();
      if (!freshAt || t - freshAt >= FRESH_REFRESH_MS) await refreshFresh();
      if (!backAt || t - backAt >= BACKFILL_REFRESH_MS) void refreshBack();   // never blocks the response
      if (dirty) { stories = buildStories([...backRows, ...freshRows]); dirty = false; }
      if (!freshAt) return { status: 'unavailable', generatedAt: null, newestRowUtc: null, coverageFromUtc: null, error: lastError ?? 'Third Eye unavailable', total: 0, items: [] };
      const cutoff = t - hours * 3_600_000;
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = stories.filter((s) => s.tsMs >= cutoff
        && (!channel || s.channels.includes(channel))
        && words.every((w) => s.variants.some((v) => v.text.toLowerCase().includes(w) || v.program.toLowerCase().includes(w))));
      const all = [...backRows, ...freshRows];
      return {
        status: lastError && t - freshAt >= FRESH_REFRESH_MS ? 'stale' : 'ok',
        generatedAt: new Date(freshAt).toISOString(),
        newestRowUtc: freshRows.length ? new Date(Math.max(...freshRows.map((r) => r.tsMs))).toISOString() : null,
        coverageFromUtc: all.length ? new Date(Math.min(...all.map((r) => r.tsMs))).toISOString() : null,
        ...(lastError && t - freshAt >= FRESH_REFRESH_MS ? { staleReason: lastError } : {}),
        total: hits.length, items: hits.slice(0, limit),
      };
    },
  };
}

const CHANNELS = new Set(['CNN', 'FOX', 'MS NOW', 'BBC']);
export function registerTvChyronsRoute(app: Express, service: ChyronService = createThirdEyeService()): void {
  app.get('/api/tv-chyrons', async (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    const num = (v: unknown, d: number, lo: number, hi: number) => { const n = Number.parseInt(String(v ?? ''), 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
    const channel = String(req.query.channel ?? '');
    try {
      const out = await service.get({ hours: num(req.query.hours, 24, 1, 168), q: String(req.query.q ?? '').slice(0, 80), channel: CHANNELS.has(channel) ? channel : '', limit: num(req.query.limit, 60, 1, 200) });
      res.status(out.status === 'unavailable' ? 502 : 200).json(out);
    } catch (e) {
      res.status(502).json({ status: 'unavailable', error: String((e as Error)?.message ?? e).slice(0, 160), total: 0, items: [] });
    }
  });
}
