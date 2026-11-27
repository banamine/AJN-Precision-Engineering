/* Listen Alerts: the server side. It does three things and nothing else:
 *   1. judges every podcast feed (hygiene gate + "does it publish transcripts?"), recomputed on every build, never a hard-coded list;
 *   2. builds a text index of the newest episodes' PUBLISHER transcripts (the <podcast:transcript> file the feed itself links; SRT/VTT);
 *   3. answers "which of these rules hit?" for rules sent in ONE request body. Rules are never stored or logged here.
 * The index lives in memory and is rebuilt after a deploy (first panel open), then refreshed about every 30 minutes, reusing every
 * episode already indexed. Nothing is invented: a feed or an episode without a transcript is reported as such, never faked. */
import type { Express } from 'express';
import { anyPublicHost, readTextCapped, safeFetch, SafeFetchError } from './safeFetch';
import { PODCAST_SOURCES, EPISODES_PER_SHOW, ensurePodcastFeeds, fnv, podcastStates, smallArtwork, type PodcastState } from './podcasts';
import { parseTranscript, type Cue } from '../src/utils/transcriptParse';
import { indexCues, matchEpisode, sanitizeRules, type AlertHit, type AlertRule, type EpisodeRef, type NormIndex } from '../src/utils/alertMatch';

export const WINDOW_DAYS = 14;                 // new episodes: published within this many days
export const EPISODES_CAP = 20;                // and at most this many per show (the newest)
export const ELIGIBLE_SHARE = 0.8;             // a show is "covered" when this share of its newest episodes link a transcript
export const MIN_EPISODES = 5;                 // ...and the sample is at least this big
export const ARCHIVE_AFTER_DAYS = 30;          // newest episode older than this = archive status (searchable, never a "new" alert)
export const NONAUDIO_WARN_SHARE = 0.25;       // feed-level warning when this share of its items were dropped as non-audio
export const REFRESH_MS = 30 * 60_000;
export const TRANSCRIPT_TIMEOUT_MS = 15_000;
export const TRANSCRIPT_MAX_BYTES = 1_500_000; // same cap as the caption route (real files are 25-290 KB)
export const BUILD_CONCURRENCY = 4;
export const MAX_HITS = 300;
const DAY = 86_400_000;

export type FeedStatus = 'covered' | 'archive' | 'uncovered' | 'quarantined';
export interface FeedVerdict {
  showId: string; name: string; channelId: string; status: FeedStatus; reason: string;
  sampled: number; withTranscript: number; share: number; newestDays: number | null; warnings: string[];
}

/** Hygiene gate + eligibility for one feed. Deterministic checks only. `owners` maps an enclosure URL to the first show that listed it. */
export function judgeFeed(state: PodcastState, now: Date, owners: ReadonlyMap<string, string>): FeedVerdict {
  const src = state.source; const eps = state.episodes;
  const withTranscript = eps.filter((e) => e.transcriptUrl).length;
  const share = eps.length ? withTranscript / eps.length : 0;
  const newest = eps.reduce((m, e) => Math.max(m, e.publishedAt), 0);
  const newestDays = newest ? Math.floor((now.getTime() - newest) / DAY) : null;
  const dropped = state.rejected.filter((r) => /^enclosure is not audio/.test(r.reason)).length;
  const warnings: string[] = [];
  if (eps.length + dropped > 0 && dropped / (eps.length + dropped) > NONAUDIO_WARN_SHARE) warnings.push(`${dropped} of ${eps.length + dropped} recent items are not audio and are skipped`);
  const seenTitle = new Map<string, number>();
  for (const e of eps) { const k = e.title.trim().toLowerCase(); const at = seenTitle.get(k); if (at !== undefined && Math.abs(at - e.publishedAt) < 3600_000) { warnings.push(`two episodes titled "${e.title.slice(0, 60)}" within an hour (possible duplicate)`); break; } seenTitle.set(k, e.publishedAt); }
  if (state.status === 'degraded' && state.error) warnings.push(state.error);
  const base = { showId: src.id, name: src.name, channelId: `pod-${src.id}`, sampled: eps.length, withTranscript, share, newestDays, warnings };
  const quarantine = (reason: string): FeedVerdict => ({ ...base, status: 'quarantined', reason });

  if (!eps.length) return quarantine(state.error ? `feed unreadable: ${state.error}` : 'feed has no playable episodes');
  if (/\b(test|sample|demo|placeholder)\b/i.test(`${src.name} ${state.feedTitle ?? ''}`)) return quarantine('looks like a test feed');
  const cloned = eps.filter((e) => { const o = owners.get(e.url); return o !== undefined && o !== src.id; });
  if (cloned.length >= Math.ceil(eps.length / 2)) return quarantine(`audio files duplicate another feed (${owners.get(cloned[0].url)})`);
  if (eps.length < MIN_EPISODES) return { ...base, status: 'uncovered', reason: `only ${eps.length} episodes listed` };
  if (share < ELIGIBLE_SHARE) return { ...base, status: 'uncovered', reason: withTranscript ? `transcripts on ${withTranscript} of ${eps.length} recent episodes` : 'the feed publishes no transcripts' };
  if (newestDays !== null && newestDays > ARCHIVE_AFTER_DAYS) return { ...base, status: 'archive', reason: `newest episode is ${newestDays} days old` };
  return { ...base, status: 'covered', reason: `transcripts on ${withTranscript} of ${eps.length} recent episodes` };
}

export function judgeAll(states: readonly PodcastState[], now: Date): FeedVerdict[] {
  const order = new Map(PODCAST_SOURCES.map((s, i) => [s.id, i]));
  const sorted = [...states].sort((a, b) => (order.get(a.source.id) ?? 1e6) - (order.get(b.source.id) ?? 1e6));
  const owners = new Map<string, string>();
  for (const st of sorted) for (const e of st.episodes) if (!owners.has(e.url)) owners.set(e.url, st.source.id);
  return sorted.map((st) => judgeFeed(st, now, owners));
}

/* ---------- the index ---------- */
export interface IndexedEpisode { ref: EpisodeRef; cues: Cue[]; norm: NormIndex }
export interface BuildStats {
  startedAt: string; builtAt: string; durationMs: number;
  shows: Record<FeedStatus, number>;
  episodes: { candidates: number; indexed: number; reused: number; noCues: number; failed: number; oversized: number };
  http: { r429: number; r5xx: number; otherErrors: number }; retries: number; cues: number; chars: number; rssMB: number; heapMB: number;
}
export interface AlertsIndex { builtAt: string; verdicts: FeedVerdict[]; episodes: Map<string, IndexedEpisode>; stats: BuildStats }

/** ok = the file text; otherwise `reason` says why not. (A flat shape: this project's tsconfig is non-strict, which cannot narrow a union on `ok`.) */
export interface TranscriptFetch { ok: boolean; text?: string; reason?: 'http' | 'network' | 'timeout' | 'too_large'; status?: number; message?: string }
export interface BuildDeps {
  states: () => PodcastState[];
  fetchTranscript: (url: string) => Promise<TranscriptFetch>;
  now: () => Date;
  wait?: (ms: number) => Promise<void>;
  memory?: () => { rssMB: number; heapMB: number };
  concurrency?: number;
}

export async function fetchTranscriptText(url: string, fetchImpl?: typeof fetch): Promise<TranscriptFetch> {
  try {
    const { res } = await safeFetch(url, { allow: anyPublicHost, timeoutMs: TRANSCRIPT_TIMEOUT_MS, maxRedirects: 5, fetchImpl, headers: { 'User-Agent': 'AJN-Precision-Engineering/1.0 (listen alerts index)', Accept: 'application/x-subrip, text/vtt, text/plain, */*' } });
    if (!res.ok) { await res.body?.cancel().catch(() => {}); return { ok: false, reason: 'http', status: res.status, message: `HTTP ${res.status}` }; }
    return { ok: true, text: await readTextCapped(res, TRANSCRIPT_MAX_BYTES) };
  } catch (e: any) {
    if (e instanceof SafeFetchError) return { ok: false, reason: e.reason === 'too_large' ? 'too_large' : e.reason === 'timeout' ? 'timeout' : 'network', message: e.message };
    return { ok: false, reason: 'network', message: String(e?.message ?? e) };
  }
}

const keyOf = (showId: string, guid: string) => `${showId}:${guid}`;
const defaultMemory = () => { const m = process.memoryUsage(); return { rssMB: Math.round(m.rss / 1048576), heapMB: Math.round(m.heapUsed / 1048576) }; };

export async function buildAlertsIndex(deps: BuildDeps, prev?: AlertsIndex | null): Promise<AlertsIndex> {
  const t0 = Date.now(); const now = deps.now();
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const states = deps.states();
  const verdicts = judgeAll(states, now);
  const stateOf = new Map(states.map((s) => [s.source.id, s]));
  const stats: BuildStats = {
    startedAt: new Date(t0).toISOString(), builtAt: '', durationMs: 0,
    shows: { covered: 0, archive: 0, uncovered: 0, quarantined: 0 },
    episodes: { candidates: 0, indexed: 0, reused: 0, noCues: 0, failed: 0, oversized: 0 },
    http: { r429: 0, r5xx: 0, otherErrors: 0 }, retries: 0, cues: 0, chars: 0, rssMB: 0, heapMB: 0,
  };
  const jobs: { ref: EpisodeRef; transcriptUrl: string }[] = [];
  for (const v of verdicts) {
    stats.shows[v.status]++;
    if (v.status !== 'covered' && v.status !== 'archive') continue;
    const st = stateOf.get(v.showId)!; const archive = v.status === 'archive';
    const eps = st.episodes.filter((e) => e.transcriptUrl && (archive || now.getTime() - e.publishedAt <= WINDOW_DAYS * DAY)).slice(0, Math.min(EPISODES_CAP, EPISODES_PER_SHOW));
    for (const e of eps) jobs.push({ ref: { showId: v.showId, showName: v.name, channelId: v.channelId, programId: `${v.channelId}-${fnv(e.guid)}`, guid: e.guid, title: e.title, publishedAt: e.publishedAt, url: e.url, archive, ...(st.imageUrl ? { logo: smallArtwork(st.imageUrl) } : {}) }, transcriptUrl: e.transcriptUrl! });
  }
  stats.episodes.candidates = jobs.length;
  const out = new Map<string, IndexedEpisode>();
  let next = 0;
  const count = (r: TranscriptFetch): void => { if (r.ok) return; if (r.status === 429) stats.http.r429++; else if ((r.status ?? 0) >= 500) stats.http.r5xx++; };
  const retryable = (r: TranscriptFetch): boolean => { if (r.ok) return false; return r.reason === 'network' || r.reason === 'timeout' || (r.reason === 'http' && (r.status === 429 || (r.status ?? 0) >= 500)); };
  const attempt = async (url: string): Promise<TranscriptFetch> => {
    let r = await deps.fetchTranscript(url); count(r);
    if (retryable(r)) { stats.retries++; await wait(600); r = await deps.fetchTranscript(url); count(r); }
    return r;
  };
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++]; const k = keyOf(job.ref.showId, job.ref.guid);
      const had = prev?.episodes.get(k);
      if (had) { out.set(k, { ...had, ref: job.ref }); stats.episodes.reused++; continue; }
      const r = await attempt(job.transcriptUrl);
      if (!r.ok) { if (r.reason === 'too_large') stats.episodes.oversized++; else { stats.episodes.failed++; if (r.reason !== 'http') stats.http.otherErrors++; } continue; }
      const cues = parseTranscript(r.text ?? '').cues;
      if (!cues.length) { stats.episodes.noCues++; continue; }
      const norm = indexCues(cues);
      out.set(k, { ref: job.ref, cues, norm }); stats.episodes.indexed++; stats.cues += cues.length; stats.chars += norm.full.length;
    }
  };
  await Promise.all(Array.from({ length: Math.min(deps.concurrency ?? BUILD_CONCURRENCY, Math.max(1, jobs.length)) }, worker));
  const mem = (deps.memory ?? defaultMemory)();
  stats.rssMB = mem.rssMB; stats.heapMB = mem.heapMB; stats.durationMs = Date.now() - t0; stats.builtAt = new Date().toISOString();
  return { builtAt: stats.builtAt, verdicts, episodes: out, stats };
}

export interface MatchResult { hits: AlertHit[]; scanned: number; truncated: boolean }
export function matchIndex(index: AlertsIndex, rules: readonly AlertRule[]): MatchResult {
  const active = rules.filter((r) => r.enabled);
  const hits: AlertHit[] = []; let scanned = 0;
  if (active.length) for (const ep of index.episodes.values()) { scanned++; hits.push(...matchEpisode(active, ep.ref, ep.cues, ep.norm)); }
  hits.sort((a, b) => (Number(a.archive) - Number(b.archive)) || (b.publishedAt - a.publishedAt) || (a.cueStart - b.cueStart));
  return { hits: hits.slice(0, MAX_HITS), scanned, truncated: hits.length > MAX_HITS };
}

/* ---------- state + routes ---------- */
export interface AlertsRuntime { deps: BuildDeps; ensureFeeds: () => Promise<void> }
type Phase = 'idle' | 'building' | 'ready' | 'error';
let index: AlertsIndex | null = null; let phase: Phase = 'idle'; let lastError: string | null = null; let lastFailAt = 0; let building: Promise<void> | null = null; let startedAt = 0;

export function resetAlertsForTests(): void { index = null; phase = 'idle'; lastError = null; lastFailAt = 0; building = null; startedAt = 0; }

function realRuntime(): AlertsRuntime {
  return { deps: { states: podcastStates, fetchTranscript: (u) => fetchTranscriptText(u), now: () => new Date() }, ensureFeeds: () => ensurePodcastFeeds() };
}

/** Starts a (re)build if there is none, the index is older than REFRESH_MS, or the last attempt failed more than 2 minutes ago. Never blocks the caller. */
export function kickBuild(rt: AlertsRuntime, nowMs: number = Date.now()): void {
  if (building) return;
  const stale = !index || nowMs - Date.parse(index.builtAt) > REFRESH_MS;
  const retryOk = phase !== 'error' || nowMs - lastFailAt > 120_000;
  if (!stale || !retryOk) return;
  phase = index ? 'ready' : 'building'; startedAt = nowMs; if (!index) lastError = null;
  building = (async () => {
    try {
      await Promise.race([rt.ensureFeeds(), new Promise((r) => setTimeout(r, 20_000))]);
      index = await buildAlertsIndex(rt.deps, index); phase = 'ready'; lastError = null;
    } catch (e: any) { lastError = String(e?.message ?? e); lastFailAt = nowMs; if (!index) phase = 'error'; }
    finally { building = null; }
  })();
}
export async function whenBuilt(): Promise<void> { await building; }

export function statusBody() {
  const v = index?.verdicts ?? [];
  const pick = (s: FeedStatus) => v.filter((x) => x.status === s).map((x) => ({ showId: x.showId, name: x.name, reason: x.reason, warnings: x.warnings }));
  return {
    state: phase === 'ready' && index ? (building ? 'refreshing' : 'ready') : phase, error: lastError,
    builtAt: index?.builtAt ?? null, window: { days: WINDOW_DAYS, episodesPerShow: EPISODES_CAP, archiveAfterDays: ARCHIVE_AFTER_DAYS, eligibleShare: ELIGIBLE_SHARE },
    source: 'publisher transcript', covered: pick('covered'), archive: pick('archive'), uncovered: pick('uncovered'), quarantined: pick('quarantined'),
    warnings: v.filter((x) => x.warnings.length && (x.status === 'covered' || x.status === 'archive')).map((x) => ({ showId: x.showId, name: x.name, warnings: x.warnings })),
    stats: index?.stats ?? null, indexedEpisodes: index?.episodes.size ?? 0,
  };
}

export function registerAlertsRoutes(app: Express, rt: AlertsRuntime = realRuntime()): void {
  app.get('/api/alerts/status', (_req, res) => {
    res.set('Cache-Control', 'no-store'); kickBuild(rt);
    res.json(statusBody());
  });
  /** Rules arrive in the body, are matched against the in-memory index and forgotten. Nothing is stored or logged. */
  app.post('/api/alerts/match', (req, res) => {
    res.set('Cache-Control', 'no-store'); kickBuild(rt);
    const rules = sanitizeRules((req.body as { rules?: unknown } | undefined)?.rules);
    if (!index) return res.status(202).json({ state: phase === 'error' ? 'error' : 'building', error: lastError, builtAt: null, hits: [], scanned: 0, truncated: false, rules: rules.length });
    const m = matchIndex(index, rules);
    return res.json({ state: building ? 'refreshing' : 'ready', builtAt: index.builtAt, ...m, rules: rules.length });
  });
}
