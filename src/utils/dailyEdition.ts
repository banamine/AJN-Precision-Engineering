/* "Today's podcasts": the daily edition engine. Pure: no React, no network, no wall clock (callers pass `nowMs`).
 * One edition per Denver calendar day (America/Denver, DST-correct: a Denver day is 23, 24 or 25 hours).
 * Shows play one after another in a fixed order, each in full. Real durations only: an episode whose length is unknown
 * or only estimated can never air; it goes to "Not in today's loop" with a reason code and stays playable on demand.
 * Ported from the approved spec bench (claude/GOOGLE_GEMINI_DAILY_PODCAST_EDITION_*); the bench's tests are mirrored in dailyEdition.test.ts. */
import { fnv1a } from './roundRobinSchedule';

export const EDITION_TZ = 'America/Denver';
export type DailyMode = 'newest' | 'bundle' | 'exclude';
export type BundleOrder = 'part-number' | 'published-asc' | 'published-then-number';
export type EditionLabel = '' | 'Yesterday' | 'Replay';
export type OverflowReason =
  | 'excluded' | 'no-episode-in-window' | 'older-episode' | 'title-excluded' | 'max-episodes'
  | 'duration-estimated' | 'duration-unknown' | 'stale-feed' | 'loading';

export interface ShowRule {
  id: string; name: string; channelId: string; mode: DailyMode;
  maxEpisodes?: number; includeTitle?: string; bundleOrder?: BundleOrder;
}
export interface FeedEpisode {
  guid: string; programId: string; title: string; src: string;
  publishedMs: number | null; durationSeconds?: number; durationSource?: 'rss' | 'probed'; durationEstimated?: boolean;
}
export interface FeedInput {
  rule: ShowRule;
  /** Feed order: newest first (RSS order). Used only as a tie-breaker. */
  episodes: FeedEpisode[];
  /** True while the feed has never been fetched: the show is "Loading", not "empty". */
  loading?: boolean;
  /** True when the feed is inactive (newest episode older than its threshold). */
  stale?: boolean;
  lastPublishedMs?: number | null;
}
export interface EditionSlot {
  showId: string; showName: string; channelId: string; programId: string; guid: string; title: string; src: string;
  publishedMs: number | null; durationSeconds: number; durationSource: 'rss' | 'probed';
  startMs: number; endMs: number; label: EditionLabel;
}
export interface ShelfEpisode {
  showId: string; showName: string; channelId: string; programId: string; guid: string; title: string; src: string;
  publishedMs: number | null; durationSeconds?: number;
}
export interface NotInLoopItem { show: { id: string; name: string }; episode: ShelfEpisode | null; reason: OverflowReason; note: string }
export interface Edition {
  editionId: string; dateKey: string; startMs: number; endMs: number; lengthMs: number; loopEndMs: number;
  loop: EditionSlot[]; tail: EditionSlot[];
  shelves: { new: ShelfEpisode[]; missed: ShelfEpisode[]; notInLoop: NotInLoopItem[] };
  counts: { new: number; candidate: number; missed: number; older: number; total: number };
}

/* ---------------- Denver calendar math (Intl only; no hard-coded UTC offsets) ---------------- */
const PARTS = new Intl.DateTimeFormat('en-US', { timeZone: EDITION_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
interface Wall { year: number; month: number; day: number; hour: number; minute: number; second: number }
export function denverParts(utcMs: number): Wall {
  const out: Wall = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const p of PARTS.formatToParts(new Date(utcMs))) {
    const n = Number(p.value);
    if (p.type === 'year') out.year = n; else if (p.type === 'month') out.month = n; else if (p.type === 'day') out.day = n;
    else if (p.type === 'hour') out.hour = n % 24; else if (p.type === 'minute') out.minute = n; else if (p.type === 'second') out.second = n;
  }
  return out;
}
export function denverWallToUtc(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  const target = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = target;
  for (let i = 0; i < 4; i++) {
    const p = denverParts(guess);
    const diff = target - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    if (diff === 0) break;
    guess += diff;
  }
  return guess;
}
/** Denver midnight of the day containing `utcMs`, shifted by `offsetDays` calendar days. */
export function denverMidnight(utcMs: number, offsetDays = 0): number {
  const p = denverParts(utcMs);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + offsetDays));
  return denverWallToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 0, 0, 0);
}
export const denverDayLengthMs = (utcMs: number): number => denverMidnight(utcMs, 1) - denverMidnight(utcMs, 0);
export function denverDateKey(utcMs: number): string {
  const p = denverParts(utcMs);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}
export function parseDenverDateTime(text: string): number {
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?\s*$/.exec(text);
  return m ? denverWallToUtc(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), m[6] ? Number(m[6]) : 0) : NaN;
}
export function formatDenverClock(utcMs: number | null): string {
  if (utcMs === null || !Number.isFinite(utcMs)) return '--:--';
  const p = denverParts(utcMs);
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${h12}:${String(p.minute).padStart(2, '0')} ${p.hour >= 12 ? 'pm' : 'am'}`;
}
const AIR_DATE = new Intl.DateTimeFormat('en-US', { timeZone: EDITION_TZ, weekday: 'short', day: 'numeric', month: 'short' });
export function formatDenverAirDate(utcMs: number): string {
  const v: Record<string, string> = {};
  for (const p of AIR_DATE.formatToParts(new Date(utcMs))) v[p.type] = p.value;
  return `${v.weekday} ${v.day} ${v.month}`;
}
const PUB_DATE = new Intl.DateTimeFormat('en-US', { timeZone: EDITION_TZ, month: 'short', day: 'numeric', year: 'numeric' });
export const formatDenverPubDate = (ms: number | null | undefined): string => (typeof ms === 'number' && Number.isFinite(ms) ? PUB_DATE.format(new Date(ms)) : 'Undated');

/* ---------------- buckets (half-open intervals) ---------------- */
export type Bucket = 'new' | 'candidate' | 'missed' | 'older' | 'future';
/** [C, now] New; [P1, C) candidates; [P2, P1) Missed; older not listed; after `now` ignored (the server rejects those already). */
export function bucketOf(publishedMs: number | null, nowMs: number): Bucket {
  if (publishedMs === null || !Number.isFinite(publishedMs)) return 'older';
  if (publishedMs > nowMs) return 'future';
  if (publishedMs >= denverMidnight(nowMs, 0)) return 'new';
  if (publishedMs >= denverMidnight(nowMs, -1)) return 'candidate';
  if (publishedMs >= denverMidnight(nowMs, -2)) return 'missed';
  return 'older';
}

/* ---------------- bundle order (not by timestamp for some shows) ---------------- */
const WORD_NUMS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
export function partNumber(title: string): number {
  const m = /\b(?:part|hour)\s*(?:no\.?|#)?\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.exec(title);
  if (!m) return Infinity;
  const tok = m[1].toLowerCase();
  return WORD_NUMS[tok] ?? Number(tok);
}
export function episodeNumber(title: string): number {
  const m = /\b(?:ep(?:isode)?\.?)\s*#?\s*(\d+)\b/i.exec(title) ?? /\b(\d+)\b/.exec(title);
  return m ? Number(m[1]) : Infinity;
}
interface Indexed extends FeedEpisode { feedIndex: number }
const pubOf = (e: Indexed): number => (e.publishedMs ?? 0);
/** Order the episodes of one bundle. Ties by REVERSE feed position (RSS lists newest first, so the older item comes first). */
export function orderBundle(order: BundleOrder, episodes: readonly Indexed[]): Indexed[] {
  const list = episodes.slice();
  if (order === 'part-number') list.sort((a, b) => partNumber(a.title) - partNumber(b.title) || pubOf(a) - pubOf(b) || b.feedIndex - a.feedIndex);
  else if (order === 'published-then-number') list.sort((a, b) => pubOf(a) - pubOf(b) || episodeNumber(a.title) - episodeNumber(b.title) || b.feedIndex - a.feedIndex);
  else list.sort((a, b) => pubOf(a) - pubOf(b) || b.feedIndex - a.feedIndex);
  return list;
}

/* ---------------- selection per show ---------------- */
const hasDuration = (e: FeedEpisode): boolean => typeof e.durationSeconds === 'number' && Number.isFinite(e.durationSeconds) && e.durationSeconds > 0;
const shelfOf = (rule: ShowRule, e: FeedEpisode): ShelfEpisode => ({ showId: rule.id, showName: rule.name, channelId: rule.channelId, programId: e.programId, guid: e.guid, title: e.title, src: e.src, publishedMs: e.publishedMs, durationSeconds: hasDuration(e) ? e.durationSeconds : undefined });
const newestFirst = (a: Indexed, b: Indexed): number => (b.publishedMs ?? -Infinity) - (a.publishedMs ?? -Infinity) || a.feedIndex - b.feedIndex;

function compileFilter(rule: ShowRule): RegExp | null {
  if (rule.mode !== 'bundle' || !rule.includeTitle) return null;
  try { return new RegExp(rule.includeTitle); } catch { return null; }
}
interface Selection { airable: Indexed[]; overflow: { ep: Indexed; reason: OverflowReason }[] }
function select(rule: ShowRule, pool: readonly Indexed[]): Selection {
  const overflow: Selection['overflow'] = [];
  let filtered = pool.slice();
  const re = compileFilter(rule);
  if (re) { filtered = pool.filter((e) => { const ok = re.test(e.title); if (!ok) overflow.push({ ep: e, reason: 'title-excluded' }); return ok; }); }
  let chosen: Indexed[] = [];
  if (rule.mode === 'newest') {
    const sorted = filtered.slice().sort(newestFirst);
    chosen = sorted.slice(0, 1);
    for (const e of sorted.slice(1)) overflow.push({ ep: e, reason: 'older-episode' });
  } else if (rule.mode === 'bundle') {
    let kept = filtered;
    if (typeof rule.maxEpisodes === 'number' && rule.maxEpisodes > 0 && kept.length > rule.maxEpisodes) {
      const sorted = kept.slice().sort(newestFirst);
      kept = sorted.slice(0, rule.maxEpisodes);
      for (const e of sorted.slice(rule.maxEpisodes)) overflow.push({ ep: e, reason: 'max-episodes' });
    }
    chosen = orderBundle(rule.bundleOrder ?? 'published-asc', kept);
  }
  const airable: Indexed[] = [];
  for (const e of chosen) {
    if (hasDuration(e)) airable.push(e);
    else overflow.push({ ep: e, reason: e.durationEstimated ? 'duration-estimated' : 'duration-unknown' });
  }
  return { airable, overflow };
}

const NOTE: Record<OverflowReason, string> = {
  excluded: 'Not part of the daily list', 'no-episode-in-window': 'No new episode', 'older-episode': 'Older episode (newest plays)',
  'title-excluded': 'Not part of this show\'s daily list', 'max-episodes': 'Over this show\'s daily limit', 'duration-estimated': 'Duration estimated',
  'duration-unknown': 'Duration unknown', 'stale-feed': 'Not updated recently', loading: 'Loading',
};

/** Build the edition for the Denver day containing `nowMs`. `feeds` must already be in play order. */
export function buildEdition(feeds: readonly FeedInput[], nowMs: number): Edition {
  const startMs = denverMidnight(nowMs, 0);
  const lengthMs = denverDayLengthMs(nowMs);
  const endMs = startMs + lengthMs;
  const dateKey = denverDateKey(nowMs);
  const loop: EditionSlot[] = []; const tailPool: { rule: ShowRule; ep: Indexed }[] = [];
  const shelves: Edition['shelves'] = { new: [], missed: [], notInLoop: [] };
  const counts = { new: 0, candidate: 0, missed: 0, older: 0, total: 0 };
  let cursor = startMs;
  const slotOf = (rule: ShowRule, e: Indexed, at: number, label: EditionLabel): EditionSlot => ({
    showId: rule.id, showName: rule.name, channelId: rule.channelId, programId: e.programId, guid: e.guid, title: e.title, src: e.src, publishedMs: e.publishedMs,
    durationSeconds: e.durationSeconds as number, durationSource: e.durationSource ?? 'rss', startMs: at, endMs: at + Math.round((e.durationSeconds as number) * 1000), label,
  });

  for (const feed of feeds) {
    const rule = feed.rule;
    const seen = new Set<string>(); const seenUrl = new Set<string>();
    const eps: Indexed[] = [];
    feed.episodes.forEach((e, i) => {
      if (seen.has(e.guid) || (e.src && seenUrl.has(e.src))) return;       // duplicate GUID or media URL: counted once
      seen.add(e.guid); if (e.src) seenUrl.add(e.src); eps.push({ ...e, feedIndex: i });
    });
    const by: Record<Bucket, Indexed[]> = { new: [], candidate: [], missed: [], older: [], future: [] };
    for (const e of eps) { const b = bucketOf(e.publishedMs, nowMs); by[b].push(e); if (b !== 'future') { counts[b] += 1; counts.total += 1; } }
    const latest = eps.length ? eps.slice().sort(newestFirst)[0] : null;

    if (rule.mode === 'exclude') {
      shelves.notInLoop.push({ show: { id: rule.id, name: rule.name }, episode: latest ? shelfOf(rule, latest) : null, reason: 'excluded', note: NOTE.excluded });
      continue;
    }
    if (feed.loading) { shelves.notInLoop.push({ show: { id: rule.id, name: rule.name }, episode: null, reason: 'loading', note: NOTE.loading }); continue; }

    const re = compileFilter(rule);
    for (const e of by.new) if (!re || re.test(e.title)) shelves.new.push(shelfOf(rule, e));

    if (by.candidate.length === 0) {
      const lastPub = latest?.publishedMs ?? feed.lastPublishedMs ?? null;
      shelves.notInLoop.push({ show: { id: rule.id, name: rule.name }, episode: latest ? shelfOf(rule, latest) : null,
        reason: feed.stale ? 'stale-feed' : 'no-episode-in-window',
        note: feed.stale ? `Not updated since ${formatDenverPubDate(lastPub)}` : `No new episode · last published ${formatDenverPubDate(lastPub)}` });
    } else {
      const sel = select(rule, by.candidate);
      for (const e of sel.airable) { const slot = slotOf(rule, e, cursor, ''); loop.push(slot); cursor = slot.endMs; }
      for (const o of sel.overflow) shelves.notInLoop.push({ show: { id: rule.id, name: rule.name }, episode: shelfOf(rule, o.ep), reason: o.reason, note: NOTE[o.reason] });
    }
    if (by.missed.length) for (const e of select(rule, by.missed).airable) { tailPool.push({ rule, ep: e }); shelves.missed.push(shelfOf(rule, e)); }
  }

  const loopEndMs = loop.length ? loop[loop.length - 1].endMs : startMs;
  /* Tail: yesterday's episodes (same order, same per-show rules), then the day's list again as "Replay".
   * An item that starts before the edition ends is never cut, so the last one may run past the end. No rollover of un-aired episodes. */
  const tail: EditionSlot[] = [];
  for (let i = 0; i < tailPool.length && cursor < endMs; i++) { const s = slotOf(tailPool[i].rule, tailPool[i].ep, cursor, 'Yesterday'); tail.push(s); cursor = s.endMs; }
  if (loop.length) {
    for (let guard = 0; cursor < endMs && guard < 400; guard++) {
      const base = loop[guard % loop.length]; const dur = base.endMs - base.startMs;
      tail.push({ ...base, startMs: cursor, endMs: cursor + dur, label: 'Replay' }); cursor += dur;
    }
  }
  const idSource = loop.map((s) => `${s.guid}|${s.durationSeconds}`).join(';');
  return { editionId: `ed-${dateKey}-${fnv1a(idSource).toString(36)}`, dateKey, startMs, endMs, lengthMs, loopEndMs, loop, tail, shelves, counts };
}

/** Content hash of what the shelves are built from (episodes published in [P2, now]): changes when an episode or duration changes; never changes a frozen loop. */
export function feedRevision(feeds: readonly FeedInput[], nowMs: number): string {
  const p2 = denverMidnight(nowMs, -2); const rows: string[] = [];
  for (const f of feeds) for (const e of f.episodes) if (e.publishedMs !== null && e.publishedMs >= p2 && e.publishedMs <= nowMs) rows.push(`${f.rule.id}|${e.guid}|${e.publishedMs}|${e.durationSeconds ?? ''}|${e.durationEstimated ? 1 : 0}|${e.src}`);
  return fnv1a(rows.sort().join('\n')).toString(36);
}

/* ---------------- show configuration (src/data/podcastSources.json) ---------------- */
export interface DailySourceConfig {
  id: string; name: string; enabled?: boolean; dailyMode?: string; dailyPriority?: number; maxEpisodes?: number; includeTitle?: string; bundleOrder?: string;
}
const MODES: readonly string[] = ['newest', 'bundle', 'exclude'];
const ORDERS: readonly string[] = ['part-number', 'published-asc', 'published-then-number'];
/** Problems with the daily fields of the source list (empty = valid). Unknown dailyMode, a bad regex, maxEpisodes < 1 are rejected. */
export function validateDailyConfig(sources: readonly DailySourceConfig[]): string[] {
  const errors: string[] = []; const seen = new Set<number>();
  for (const s of sources) {
    if (s.dailyMode !== undefined && !MODES.includes(s.dailyMode)) errors.push(`${s.id}: unknown dailyMode "${s.dailyMode}"`);
    if (s.bundleOrder !== undefined && !ORDERS.includes(s.bundleOrder)) errors.push(`${s.id}: unknown bundleOrder "${s.bundleOrder}"`);
    if (s.maxEpisodes !== undefined && !(Number.isInteger(s.maxEpisodes) && s.maxEpisodes >= 1)) errors.push(`${s.id}: maxEpisodes must be an integer >= 1`);
    if (s.includeTitle !== undefined) { try { new RegExp(s.includeTitle); } catch { errors.push(`${s.id}: includeTitle is not a valid regex`); } }
    if (s.dailyPriority !== undefined) { if (!Number.isInteger(s.dailyPriority) || s.dailyPriority < 1) errors.push(`${s.id}: dailyPriority must be an integer >= 1`); else if (seen.has(s.dailyPriority)) errors.push(`${s.id}: duplicate dailyPriority ${s.dailyPriority}`); else seen.add(s.dailyPriority); }
  }
  return errors;
}
/** Play order: configured priorities ascending, then unconfigured feeds in list order as `newest`. `exclude` shows keep their place but never air. */
export function showRulesFromSources(sources: readonly DailySourceConfig[]): ShowRule[] {
  const enabled = sources.filter((s) => s.enabled !== false);
  const rule = (s: DailySourceConfig): ShowRule => ({ id: s.id, name: s.name, channelId: `pod-${s.id}`, mode: (s.dailyMode as DailyMode | undefined) ?? 'newest',
    ...(s.maxEpisodes !== undefined ? { maxEpisodes: s.maxEpisodes } : {}), ...(s.includeTitle !== undefined ? { includeTitle: s.includeTitle } : {}),
    ...(s.bundleOrder !== undefined ? { bundleOrder: s.bundleOrder as BundleOrder } : {}) });
  const configured = enabled.filter((s) => s.dailyPriority !== undefined && s.dailyMode !== 'exclude').sort((a, b) => (a.dailyPriority as number) - (b.dailyPriority as number));
  const rest = enabled.filter((s) => s.dailyPriority === undefined && s.dailyMode !== 'exclude');
  const excluded = enabled.filter((s) => s.dailyMode === 'exclude');
  return [...configured, ...rest, ...excluded].map(rule);
}
