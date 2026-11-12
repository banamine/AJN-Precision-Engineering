// Round-robin refresher that feeds the 24 h StoryLedger from Archive TV News details pages.
// Polite by design: ONE network per tick, a few programs per tick, >= GAP between requests (the shared archiveLimiter
// enforces the global 1.5 s floor on top), cooldown after 429/403/503, idle unless a client asked recently.
// Nothing is written to disk. Failures become explicit per-network statuses, never silent fallbacks.
import { archiveApiFetch } from '../archiveLimiter.js';
import { readTextCapped } from '../safeFetch.js';
import { parseMinuteColumns } from '../tvHeadlines.js';
import { isNewsProgramTitle } from './programFilter.js';
import { pickTopWindows } from './excerptWindows.js';
import { StoryLedger, type SourceKind } from './storyLedger.js';

export interface TvStoryNetwork { code: string; network: string; prefixes: readonly string[]; sourceKind: SourceKind }
/** First four are verified against live Archive pages (2026-11-09 probe). The rest are NOT VERIFIED and are labelled page-text. */
export const TV_STORY_NETWORKS: readonly TvStoryNetwork[] = Object.freeze([
  { code: 'FOXNEWSW', network: 'Fox News', prefixes: ['FOXNEWSW'], sourceKind: 'broadcast-captions' },
  { code: 'CNNW', network: 'CNN', prefixes: ['CNNW'], sourceKind: 'broadcast-captions' },
  { code: 'MSNOW', network: 'MS NOW', prefixes: ['MSNOW', 'MSNOWW', 'MSNBCW'], sourceKind: 'broadcast-captions' },
  { code: 'BBCNEWS', network: 'BBC News', prefixes: ['BBCNEWS'], sourceKind: 'broadcast-captions' },
  { code: 'RT', network: 'RT', prefixes: ['RT'], sourceKind: 'page-text' },
  { code: 'KPIX', network: 'KPIX CBS', prefixes: ['KPIX'], sourceKind: 'page-text' },
  { code: 'CBCNEWS', network: 'CBC News', prefixes: ['CBCNEWS'], sourceKind: 'page-text' },
  { code: 'CTV', network: 'CTV News', prefixes: ['CTV'], sourceKind: 'page-text' },
  { code: 'ALJAZ', network: 'Al Jazeera English', prefixes: ['ALJAZ'], sourceKind: 'page-text' },
  { code: 'FRANCE24', network: 'France 24', prefixes: ['FRANCE24'], sourceKind: 'page-text' },
  { code: 'TRTWORLD', network: 'TRT World', prefixes: ['TRTWORLD'], sourceKind: 'page-text' },
  { code: 'DW', network: 'DW News', prefixes: ['DW'], sourceKind: 'page-text' },
]);

export const TICK_MS = 100_000;
export const ACTIVE_WINDOW_MS = 30 * 60_000;
export const REQUEST_GAP_MS = 1_800;
export const MATURITY_MS = 35 * 60_000;
export const NO_TEXT_BACKOFF_MS = 3 * 60 * 60_000;
export const COOLDOWN_MS = 10 * 60_000;
export const YOUNG_RETRY_MS = 10 * 60_000;
export const ERROR_RETRY_MS = 15 * 60_000;
export const YOUNG_PROGRAM_MS = 6 * 60 * 60_000;
export const MAX_DETAILS_PER_TICK = 3;
export const SEARCH_ROWS = 40;
const RETENTION_MS = 24 * 60 * 60_000;

export type NetworkStatus = 'waiting' | 'ok' | 'no-text' | 'cooldown' | 'error';
export interface FetchResult { status: number; text: string }
export type FetchText = (url: string, timeoutMs: number, maxBytes: number) => Promise<FetchResult>;

export interface RefresherDeps {
  ledger: StoryLedger;
  fetchText?: FetchText;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  networks?: readonly TvStoryNetwork[];
}

const defaultFetchText: FetchText = async (url, timeoutMs, maxBytes) => {
  const res = await archiveApiFetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) { await res.body?.cancel().catch(() => {}); return { status: res.status, text: '' }; }
  return { status: res.status, text: await readTextCapped(res, maxBytes) };
};

/** Prefix may contain digits (FRANCE24). */
export function parseArchiveIdentifier(id: string): { prefix: string; airedMs: number; programTitle: string } | null {
  const m = /^([A-Z0-9]+)_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_(.+)$/.exec(id);
  if (!m) return null;
  const ms = Date.parse(`${m[2]}-${m[3]}-${m[4]}T${m[5]}:${m[6]}:${m[7]}Z`);
  return Number.isFinite(ms) ? { prefix: m[1], airedMs: ms, programTitle: m[8].replace(/_/g, ' ') } : null;
}

interface NetState {
  cooldownUntil: number;
  noTextUntil: number;
  retryAt: Map<string, number>;
  done: Set<string>;
  status: NetworkStatus;
  reason: string;
  lastCheckMs: number;
}

export class StoryRefresher {
  private readonly ledger: StoryLedger;
  private readonly fetchText: FetchText;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly networks: readonly TvStoryNetwork[];
  private readonly state = new Map<string, NetState>();
  private cursor = 0;
  private lastTouch = -Infinity;
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: RefresherDeps) {
    this.ledger = deps.ledger;
    this.fetchText = deps.fetchText ?? defaultFetchText;
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.networks = deps.networks ?? TV_STORY_NETWORKS;
    for (const n of this.networks) {
      this.state.set(n.code, { cooldownUntil: 0, noTextUntil: 0, retryAt: new Map(), done: new Set(), status: 'waiting', reason: '', lastCheckMs: 0 });
    }
  }

  /** Called by the route on every client request. The first request after idle starts the timer and triggers one tick now. */
  touch(): void {
    const t = this.now();
    const wasIdle = t - this.lastTouch > ACTIVE_WINDOW_MS;
    this.lastTouch = t;
    if (!this.timer) {
      this.timer = setInterval(() => { void this.tick(); }, TICK_MS);
      this.timer.unref?.();
    }
    if (wasIdle) void this.tick();
  }

  stop(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  private isIdle(): boolean { return this.now() - this.lastTouch > ACTIVE_WINDOW_MS; }

  /** One network per call. Returns the network code worked on, or null when idle/busy/nothing eligible. */
  async tick(): Promise<string | null> {
    if (this.running || this.isIdle()) return null;
    const t = this.now();
    let picked: TvStoryNetwork | null = null;
    for (let i = 0; i < this.networks.length; i++) {
      const n = this.networks[(this.cursor + i) % this.networks.length];
      const st = this.state.get(n.code)!;
      if (st.cooldownUntil > t || st.noTextUntil > t) continue;
      picked = n;
      this.cursor = (this.cursor + i + 1) % this.networks.length;
      break;
    }
    if (!picked) return null;
    this.running = true;
    try { await this.refreshNetwork(picked); } catch (e) {
      const st = this.state.get(picked.code)!;
      st.status = 'error'; st.reason = String((e as Error)?.message ?? e).slice(0, 120);
    } finally { this.running = false; }
    return picked.code;
  }

  private buildSearchUrl(n: TvStoryNetwork, nowMs: number): string {
    const days = [0, 1].map((d) => new Date(nowMs - d * 86_400_000).toISOString().slice(0, 10).replace(/-/g, ''));
    const parts = n.prefixes.map((p) => `(collection:TV-${p} AND (${days.map((d) => `identifier:${p}_${d}_*`).join(' OR ')}))`);
    const q = parts.join(' OR ');
    return `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier&sort[]=${encodeURIComponent('identifier desc')}&rows=${SEARCH_ROWS}&output=json`;
  }

  private async refreshNetwork(n: TvStoryNetwork): Promise<void> {
    const st = this.state.get(n.code)!;
    const t0 = this.now();
    st.lastCheckMs = t0;
    const limited = (s: number) => s === 429 || s === 403 || s === 503;

    const search = await this.fetchText(this.buildSearchUrl(n, t0), 12_000, 256 * 1024);
    if (limited(search.status)) { st.cooldownUntil = this.now() + COOLDOWN_MS; st.status = 'cooldown'; st.reason = `search HTTP ${search.status}`; return; }
    if (search.status !== 200) { st.status = 'error'; st.reason = `search HTTP ${search.status}`; return; }
    let ids: string[];
    try {
      const j = JSON.parse(search.text);
      ids = (j?.response?.docs ?? []).map((d: { identifier?: unknown }) => String(d?.identifier ?? ''));
    } catch { st.status = 'error'; st.reason = 'search returned invalid JSON'; return; }

    // forget bookkeeping for programs older than the window so the sets stay tiny
    for (const id of [...st.done]) { const p = parseArchiveIdentifier(id); if (!p || p.airedMs < t0 - RETENTION_MS - 3_600_000) st.done.delete(id); }
    for (const [id] of st.retryAt) { const p = parseArchiveIdentifier(id); if (!p || p.airedMs < t0 - RETENTION_MS) st.retryAt.delete(id); }

    const todo = ids
      .map((id) => ({ id, p: parseArchiveIdentifier(id) }))
      .filter((x): x is { id: string; p: NonNullable<ReturnType<typeof parseArchiveIdentifier>> } => x.p !== null)
      .filter(({ id, p }) => n.prefixes.includes(p.prefix) && t0 - p.airedMs > MATURITY_MS && p.airedMs > t0 - RETENTION_MS &&
        isNewsProgramTitle(p.programTitle) && !st.done.has(id) && (st.retryAt.get(id) ?? 0) <= t0)
      .slice(0, MAX_DETAILS_PER_TICK);

    if (todo.length === 0) {
      // nothing new to fetch: that is healthy only if we already hold cards for this network
      const have = this.ledger.countByNetwork(t0).get(n.code) ?? 0;
      st.status = have > 0 ? 'ok' : (ids.length === 0 ? 'no-text' : 'waiting');
      st.reason = have > 0 ? '' : (ids.length === 0 ? 'no programs found in the last 2 days' : 'no eligible program yet');
      if (have === 0 && ids.length === 0) st.noTextUntil = t0 + NO_TEXT_BACKOFF_MS;
      return;
    }

    let checked = 0; let zeroOld = 0; let parsedAny = false;
    for (const { id, p } of todo) {
      await this.sleep(REQUEST_GAP_MS);
      const r = await this.fetchText(`https://archive.org/details/${encodeURIComponent(id)}`, 15_000, 3 * 1024 * 1024);
      const now = this.now();
      if (limited(r.status)) { st.cooldownUntil = now + COOLDOWN_MS; st.status = 'cooldown'; st.reason = `details HTTP ${r.status}`; return; }
      if (r.status !== 200) { st.retryAt.set(id, now + ERROR_RETRY_MS); st.status = 'error'; st.reason = `details HTTP ${r.status}`; continue; }
      checked++;
      const cols = parseMinuteColumns(r.text);
      if (cols.length > 0) {
        parsedAny = true;
        for (const w of pickTopWindows(cols)) {
          this.ledger.ingest({
            networkCode: n.code, network: n.network, sourceKind: n.sourceKind, programId: id, programTitle: p.programTitle,
            programStartMs: p.airedMs, windowStartMs: p.airedMs + w.minutes[0].startSec * 1000, startSec: w.minutes[0].startSec,
            clock: w.minutes[0].clock, minutes: w.minutes, score: w.score,
          }, now);
        }
        st.done.add(id); // fully processed, never refetched
      } else if (now - p.airedMs < YOUNG_PROGRAM_MS) {
        st.retryAt.set(id, now + YOUNG_RETRY_MS); // captions probably not indexed yet
      } else {
        st.done.add(id); zeroOld++;
      }
    }
    if (parsedAny) { st.status = 'ok'; st.reason = ''; }
    else if (checked > 0 && zeroOld === checked && (this.ledger.countByNetwork(this.now()).get(n.code) ?? 0) === 0) {
      st.status = 'no-text'; st.reason = 'programs found but no caption text'; st.noTextUntil = this.now() + NO_TEXT_BACKOFF_MS;
    } else if (st.status !== 'error') { st.status = 'waiting'; st.reason = 'captions not indexed yet'; }
  }

  networkStatuses(nowMs: number): Array<{ code: string; network: string; sourceKind: SourceKind; status: NetworkStatus; reason: string; cards: number }> {
    const counts = this.ledger.countByNetwork(nowMs);
    return this.networks.map((n) => {
      const st = this.state.get(n.code)!;
      let status = st.status;
      if (st.cooldownUntil > nowMs) status = 'cooldown';
      else if (st.noTextUntil > nowMs) status = 'no-text';
      return { code: n.code, network: n.network, sourceKind: n.sourceKind, status, reason: st.reason, cards: counts.get(n.code) ?? 0 };
    });
  }

  get isRunning(): boolean { return this.running; }
}

import { createStoryLedger } from './storyLedger.js';
export const tvStoryLedger = createStoryLedger();
export const tvStoryRefresher = new StoryRefresher({ ledger: tvStoryLedger });
