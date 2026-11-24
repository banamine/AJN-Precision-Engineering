/* On Air backfill planner. Pure: no React, no network, no wall clock, no Math.random (a seeded generator, fixed per Denver date).
 * Input: today's FRESH podcast slots (the edition loop only: older episodes never play) and the real filler pool (/api/onair/filler).
 * Output: an ordered plan of spoken blocks. The run-of-show puts a music block after every block with musicAfter=true.
 * Rules (user, 2026-11-22): news = two ~5 min clips of one channel then music; long Infowars-family channels get ~35% of filler;
 * The Quash is a labelled "Break"; music sits between any two different spoken blocks; every block has a time cap; no repeats back to back. */
import type { EditionSlot } from '../utils/dailyEdition';
import type { FillClip, FillerPool } from '../../server/onairFiller';
import { fnv1a } from '../utils/roundRobinSchedule';
import { isEveningHour } from './dayparts';


export interface BackfillCfg {
  /** Share of filler patterns that are the long-channel pattern (B). */
  longShare: number;
  newsClipsPerBlock: number;
  longCapSec: number; long76CapSec: number; quashCapSec: number;
  /** Demo cap for a fresh podcast; 0 = play it in full. */
  podcastCapSec: number;
  /** Seek into long files (random start). Off = always from the beginning. */
  useOffsets: boolean;
  longMinOffsetSec: number; longTailMarginSec: number;
  /** Fresh podcast time (seconds, after caps) at which filler stops being interleaved. */
  enoughFreshSec: number;
  /** News channels left out of the pool (labels as in the pool). */
  excludeNews: string[];
  /** Spacing used only to size the plan; the real music block length comes from the run-of-show. */
  musicSec: number;
  /** Music block length inside a clock hour (news / short-show hours). */
  hourMusicSec: number;
}
export const DEFAULT_BACKFILL: BackfillCfg = {
  longShare: 0.35, newsClipsPerBlock: 2, longCapSec: 720, long76CapSec: 900, quashCapSec: 900, podcastCapSec: 1500,
  useOffsets: true, longMinOffsetSec: 120, longTailMarginSec: 900, enoughFreshSec: 4 * 3600, excludeNews: ['CTV News'], musicSec: 420, hourMusicSec: 300,
};

export type PlanRole = 'podcast' | 'news' | 'long' | 'quash' | 'talk' | 'rush' | 'harvey';
export interface PlanItem {
  role: PlanRole;
  slot?: EditionSlot; clip?: FillClip;
  durationSec: number; startOffsetSec: number;
  musicAfter: boolean; filler: boolean;
  /** Length of the music block after this item, when it is not the default (clock breaks, hour-end pad). */
  musicSec?: number;
  tag: string; why: string; clipDate: string | null; channel: string;
}

/** Small seeded generator (mulberry32). Same seed, same day plan, on every reload and every viewer. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** The programming clock of a long talk show (affiliate format), without the 1-minute breaks:
 *  talk to :29, 4-min break, talk :33 to :57:50, ~2-min top-of-hour break (with the station ID). */
export const CLOCK = { talk1Sec: 29 * 60, break1Sec: 4 * 60, talk2Sec: 24 * 60 + 50, break2Sec: 2 * 60 + 10 } as const;
/** Denver hours at which a Rush Limbaugh "on this day" hour starts: early morning, mid-morning, mid-afternoon, early evening, late evening. */
export const RUSH_HOURS: readonly number[] = [5, 9, 14, 18, 21];
const HOUR_SEC = 3600;
const A_WEIGHTS: Record<string, number> = { 'Coast to Coast AM': 25, 'Long John Nebel': 10, 'New World Order Exposed (1969)': 10 };
const AJ_WEIGHT = 55;

export function denverHourOf(ms: number): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hour: '2-digit', hourCycle: 'h23' }).format(new Date(ms)));
}

interface Reel { clips: FillClip[]; idx: number; off: number; wrap: boolean; role: PlanRole; tag: string; label: string }

export interface PlanArgs { fresh: readonly EditionSlot[]; pool: FillerPool | null; dateKey: string; cfg: BackfillCfg; targetSec: number; seedExtra?: string;
  /** Wall-clock start of the plan (ms). Denver offsets are whole hours, so hour boundaries are the same as UTC hour boundaries. Default 0 = on the hour. */
  startMs?: number }

export function planDay(args: PlanArgs): PlanItem[] {
  const { fresh, pool, cfg } = args;
  const rng = seededRng(fnv1a(`${args.dateKey}|${args.seedExtra ?? ''}`));
  const items: PlanItem[] = [];
  const news = (pool?.news ?? []).filter((c) => !cfg.excludeNews.includes(c.channel));
  const long = pool?.long ?? [], quash = pool?.quash ?? [];
  const newsChannels = [...new Set(news.map((c) => c.channel))];
  const recent: string[] = [];            // last used clip keys
  const used = (c: FillClip): string => `${c.src}#${c.startSec}`;
  const remember = (k: string): void => { recent.push(k); if (recent.length > 60) recent.shift(); };
  const pick = <T,>(list: readonly T[], ok: (t: T) => boolean): T | null => {
    if (!list.length) return null;
    const start = Math.floor(rng() * list.length);
    for (let i = 0; i < list.length; i++) { const t = list[(start + i) % list.length]; if (ok(t)) return t; }
    return list[start];
  };

  let lastNewsChannel = '', lastLongChannel = '';
  let total = 0, freshIdx = 0, cycle = 0;
  const freshCapped = (s: EditionSlot): number => (cfg.podcastCapSec > 0 ? Math.min(s.durationSeconds, cfg.podcastCapSec) : s.durationSeconds);
  const freshSecLeft = (): number => fresh.slice(freshIdx).reduce((a, s) => a + freshCapped(s) + cfg.musicSec, 0);
  const add = (it: PlanItem): void => { items.push(it); total += it.durationSec + (it.musicAfter ? (it.musicSec ?? cfg.musicSec) : 0); };

  const offsetFor = (durSec: number, capSec: number): number => {
    if (!cfg.useOffsets) return 0;
    const lo = cfg.longMinOffsetSec, hi = durSec - capSec - cfg.longTailMarginSec;
    return hi > lo ? Math.floor(lo + rng() * (hi - lo)) : 0;
  };

  const makeNews = (why: string): PlanItem[] => {
    if (!newsChannels.length) return [];
    const ch = pick(newsChannels, (c) => c !== lastNewsChannel) as string; lastNewsChannel = ch;
    const all = news.filter((c) => c.channel === ch);
    // Newest recordings first: use the clips from the newest day of this channel and the day before; older ones only when that is too few.
    const newest = all.reduce((m, c) => ((c.clipDate ?? '') > m ? (c.clipDate as string) : m), '');
    const cutoff = newest ? new Date(Date.parse(newest) - 86_400_000).toISOString().slice(0, 10) : '';
    const recentClips = all.filter((c) => (c.clipDate ?? '') >= cutoff);
    const clips = recentClips.length >= cfg.newsClipsPerBlock * 2 ? recentClips : all;
    const out: PlanItem[] = [];
    const chosen: FillClip[] = [];
    for (let k = 0; k < cfg.newsClipsPerBlock; k++) {
      const c = pick(clips, (x) => !recent.includes(used(x)) && !chosen.includes(x));
      if (c) { chosen.push(c); remember(used(c)); }
    }
    chosen.forEach((c, k) => out.push({ role: 'news', clip: c, durationSec: c.durSec, startOffsetSec: c.startSec, musicAfter: k === chosen.length - 1, filler: true, tag: 'FILLER', channel: ch, clipDate: c.clipDate, why: `${why} · news clip ${k + 1}/${chosen.length} · ${ch}` }));
    return out;
  };
  const makeLong = (why: string): PlanItem[] => {
    if (!long.length) return [];
    const channels = [...new Set(long.map((c) => c.channel))];
    const ch = pick(channels, (c) => c !== lastLongChannel) as string; lastLongChannel = ch;
    const c = pick(long.filter((x) => x.channel === ch), (x) => !recent.includes(used(x))) as FillClip; remember(used(c));
    const cap = ch === 'NEW WORLD TYRANNY' ? cfg.long76CapSec : cfg.longCapSec;
    const dur = Math.min(cap, c.durSec);
    const off = offsetFor(c.durSec, dur);
    return [{ role: 'long', clip: c, durationSec: dur, startOffsetSec: off, musicAfter: true, filler: true, tag: 'FILLER', channel: ch, clipDate: c.clipDate, why: `${why} · long piece ${dur}s from ${off}s · ${ch}` }];
  };
  const makeQuash = (why: string): PlanItem[] => {
    if (!quash.length) return [];
    const c = pick(quash, (x) => !recent.includes(used(x))) as FillClip; remember(used(c));
    const dur = Math.min(cfg.quashCapSec, c.durSec);
    const off = cfg.useOffsets ? offsetFor(c.durSec, dur) : 0;
    return [{ role: 'quash', clip: c, durationSec: dur, startOffsetSec: off, musicAfter: true, filler: true, tag: 'BREAK', channel: 'The Quash', clipDate: null, why: `${why} · Quash break ${dur}s from ${off}s` }];
  };
  const make = (role: PlanRole, why: string): PlanItem[] => (role === 'news' ? makeNews(why) : role === 'long' ? makeLong(why) : role === 'quash' ? makeQuash(why) : []);

  const musicOf = (it: PlanItem): number => (it.musicAfter ? (it.musicSec ?? cfg.musicSec) : 0);
  const lenOf = (its: readonly PlanItem[]): number => its.reduce((a, it) => a + it.durationSec + musicOf(it), 0);
  const startSec = (args.startMs ?? 0) / 1000;
  const harvey = pool?.harvey ?? [], rushAll = pool?.rush ?? [], talkAll = pool?.talk ?? [], ajFresh = pool?.ajfresh ?? [];

  // ---- reels: a long show keeps its place through the day, so it resumes where it stopped ----
  const reels = new Map<string, Reel>();
  const reelStart = (c: FillClip): number => (c.durSec > 7200 ? offsetFor(c.durSec, HOUR_SEC) : 0);
  const reelFor = (key: string, clips: FillClip[], role: PlanRole, tag: string, label: string, wrap: boolean, fromStart = false): Reel => {
    let r = reels.get(key);
    if (!r) { r = { clips, idx: 0, off: clips.length && !fromStart ? reelStart(clips[0]) : 0, wrap, role, tag, label }; reels.set(key, r); }
    return r;
  };
  const take = (r: Reel, sec: number, why: string): PlanItem[] => {
    const out: PlanItem[] = []; let need = sec, g = 0;
    while (need > 0.5 && g++ < 24 && r.clips.length) {
      if (r.idx >= r.clips.length) { if (!r.wrap) break; r.idx = 0; r.off = 0; }
      const c = r.clips[r.idx];
      const avail = c.durSec - r.off;
      if (avail < 20) { r.idx += 1; r.off = 0; continue; }
      const d = Math.min(need, avail);
      out.push({ role: r.role, clip: c, durationSec: Math.round(d), startOffsetSec: Math.round(r.off), musicAfter: false, filler: true, tag: r.tag, channel: r.label, clipDate: c.clipDate, why: `${why} · ${r.label} from ${Math.round(r.off)}s` });
      r.off += d; need -= d; remar(r, c);
    }
    return out;
  };
  function remar(r: Reel, c: FillClip): void { if (r.off >= c.durSec - 20) { r.idx += 1; r.off = 0; } }
  const clockHour = (r: Reel, why: string): PlanItem[] => {
    const t1 = take(r, CLOCK.talk1Sec, why), t2 = take(r, CLOCK.talk2Sec, why);
    if (t1.length) { t1[t1.length - 1].musicAfter = true; t1[t1.length - 1].musicSec = CLOCK.break1Sec; }
    if (t2.length) { t2[t2.length - 1].musicAfter = true; t2[t2.length - 1].musicSec = CLOCK.break2Sec; }
    return [...t1, ...t2];
  };

  // ---- hour blocks ----
  const shortMusic = (blk: PlanItem[]): PlanItem[] => { const l = blk[blk.length - 1]; if (l && l.musicAfter && l.musicSec === undefined) l.musicSec = cfg.hourMusicSec; return blk; };
  const makeHarvey = (n: number, why: string): PlanItem[] => {
    if (!harvey.length) return [];
    const out: PlanItem[] = [];
    for (let k = 0; k < n; k++) {
      const c = pick(harvey, (x) => !recent.includes(used(x))) as FillClip; remember(used(c));
      out.push({ role: 'harvey', clip: c, durationSec: c.durSec, startOffsetSec: 0, musicAfter: k === n - 1, filler: true, tag: 'ARCHIVE', channel: c.channel, clipDate: null, why: `${why} · Paul Harvey short` });
    }
    return out;
  };
  const padHour = (items: PlanItem[], target: number): PlanItem[] => {
    if (!items.length) return items;
    const last = items[items.length - 1]; last.musicAfter = true;
    const pad = Math.min(1500, target - lenOf(items));
    if (pad > 0) last.musicSec = (last.musicSec ?? cfg.musicSec) + pad;
    return items;
  };
  const composeHour = (makers: Array<() => PlanItem[]>, target: number): PlanItem[] => {
    const items: PlanItem[] = []; let len = 0, empty = 0, i = 0, g = 0;
    while (len < target - 300 && g++ < 16 && empty < makers.length) {
      const blk = shortMusic(makers[i++ % makers.length]());
      if (!blk.length) { empty += 1; continue; }
      empty = 0;
      const bl = lenOf(blk);
      if (len + bl > target - 60) break;
      items.push(...blk); len += bl;
    }
    return padHour(items, target);
  };
  const newsHour = (target: number): PlanItem[] => composeHour([() => makeNews('news hour'), () => makeHarvey(3, 'news hour'), () => makeNews('news hour'), () => makeHarvey(3, 'news hour'), () => makeNews('news hour')], target);
  const breakHour = (target: number): PlanItem[] => composeHour([() => makeHarvey(3, 'break hour'), () => makeQuash('break hour'), () => makeNews('break hour'), () => makeHarvey(3, 'break hour'), () => makeNews('break hour')], target);

  const longChannels = [...new Set(long.map((c) => c.channel))];
  const talkLabels = [...new Set(talkAll.map((c) => c.channel))];
  let lastLongShow = '';
  const longHour = (hour: number): PlanItem[] => {
    const evening = isEveningHour(hour);
    const cands: { key: string; w: number }[] = [];
    // Evening: the current Alex Jones shows lead (today first, then yesterday and earlier), the archive still takes a share. Before 6 pm only the archive plays.
    if (evening && ajFresh.length) cands.push({ key: '@fresh', w: 60 });
    if (longChannels.length) cands.push({ key: '@aj', w: evening && ajFresh.length ? 15 : AJ_WEIGHT });
    for (const l of talkLabels) cands.push({ key: l, w: A_WEIGHTS[l] ?? 10 });
    const live = cands.filter((c) => c.key !== lastLongShow);
    const list = live.length ? live : cands;
    if (!list.length) return [];
    let r = rng() * list.reduce((a, c) => a + c.w, 0), chosen = list[0];
    for (const c of list) { r -= c.w; if (r <= 0) { chosen = c; break; } }
    lastLongShow = chosen.key;
    if (chosen.key === '@fresh') return clockHour(reelFor('ajfresh', ajFresh, 'long', 'LATEST', 'The Alex Jones Show', true, true), 'current Alex Jones show');
    if (chosen.key === '@aj') {
      const ch = pick(longChannels, (c) => c !== lastLongChannel) as string; lastLongChannel = ch;
      return clockHour(reelFor(`aj|${ch}`, long.filter((c) => c.channel === ch), 'long', 'FILLER', ch, true), 'long show hour');
    }
    return clockHour(reelFor(`talk|${chosen.key}`, talkAll.filter((c) => c.channel === chosen.key), 'talk', 'ARCHIVE TALK', chosen.key, true), 'archive talk hour');
  };
  // Rush: the file years with today's date, spread from the earliest to the latest across the five slots.
  const rushYears = ((): string[] => {
    const ds = [...new Set(rushAll.map((c) => c.clipDate).filter((d): d is string => !!d))].sort();
    const k = RUSH_HOURS.length;
    // Earliest and latest year are both used; the rest are spread evenly between them.
    return ds.length > k ? Array.from({ length: k }, (_, i) => ds[Math.round((i * (ds.length - 1)) / (k - 1))]) : ds;
  })();
  const rushHour = (hour: number): PlanItem[] => {
    const slot = RUSH_HOURS.indexOf(hour);
    if (slot < 0 || !rushYears.length) return [];
    const date = rushYears[slot % rushYears.length];
    const files = rushAll.filter((c) => c.clipDate === date);
    if (!files.length) return [];
    const r: Reel = { clips: files, idx: 0, off: 0, wrap: false, role: 'rush', tag: 'ON THIS DAY', label: 'Rush Limbaugh' };
    return clockHour(r, `Rush on this day ${date}`);
  };

  const canLong = longChannels.length > 0 || talkLabels.length > 0 || ajFresh.length > 0;
  let lastKind = '';
  const chooseKind = (hour: number, aligned: boolean): 'A' | 'B' | 'C' => {
    const afternoon = hour >= 12;
    const w: Record<'A' | 'B' | 'C', number> = afternoon ? { A: 40, B: 25, C: 35 } : { A: 45, B: 40, C: 15 };
    if (isEveningHour(hour) && ajFresh.length) w.A += 15;
    if (!aligned || !canLong) w.A = 0;
    if (!news.length) w.B = 0;
    if (!harvey.length && !quash.length && !news.length) w.C = 0;
    if (lastKind && w[lastKind as 'A' | 'B' | 'C'] !== undefined && Object.values(w).filter((x) => x > 0).length > 1) w[lastKind as 'A' | 'B' | 'C'] = 0;
    const tot = w.A + w.B + w.C;
    if (tot <= 0) return 'B';
    let r = rng() * tot;
    for (const k of ['A', 'B', 'C'] as const) { r -= w[k]; if (r <= 0 && w[k] > 0) return k; }
    return 'B';
  };

  let guard = 0;
  while (total < args.targetSec && guard++ < 2000) {
    const freshLeft = fresh.length - freshIdx;
    if (freshLeft > 0) {
      // Fresh podcasts first. With enough of them for a day there is no filler; with fewer, one filler block between podcasts.
      const s = fresh[freshIdx++];
      const dur = freshCapped(s);
      add({ role: 'podcast', slot: s, durationSec: dur, startOffsetSec: 0, musicAfter: true, filler: false, tag: s.label ? s.label.toUpperCase() : 'TODAY', channel: s.showName, clipDate: null,
        why: `fresh podcast ${freshIdx}/${fresh.length}${cfg.podcastCapSec > 0 && s.durationSeconds > cfg.podcastCapSec ? ` · demo cap ${cfg.podcastCapSec}s` : ''}` });
      if (freshSecLeft() < cfg.enoughFreshSec && freshIdx < fresh.length) {
        const role: PlanRole = (['news', 'quash', 'long'] as PlanRole[])[cycle++ % 3];
        for (const it of make(role, `filler between fresh podcasts (${role})`)) add(it);
      }
      continue;
    }
    // No fresh podcast left: plan whole clock hours. Off the hour (after fresh podcasts), first run short blocks to the next hour line.
    const nowSec = startSec + total;
    const pos = ((nowSec % HOUR_SEC) + HOUR_SEC) % HOUR_SEC;
    const aligned = pos < 5;
    const gap = aligned ? HOUR_SEC : HOUR_SEC - pos;
    const hour = denverHourOf(nowSec * 1000);
    let blk: PlanItem[] = [];
    if (aligned && rushHour(hour).length) blk = rushHour(hour);
    if (!blk.length) {
      const kind = chooseKind(hour, aligned);
      lastKind = kind;
      blk = kind === 'A' ? longHour(hour) : kind === 'B' ? newsHour(gap) : breakHour(gap);
      if (!blk.length) blk = newsHour(gap);
      if (!blk.length) blk = breakHour(gap);
    }
    if (!blk.length) break; // nothing in the pool: stop instead of looping
    for (const it of blk) add(it);
  }
  return items;
}

/** Plain-words summary of a plan, for the debug strip and the tests. */
export function summarizePlan(items: readonly PlanItem[]): { spokenSec: number; byRole: Record<PlanRole, number>; longShareOfFiller: number } {
  const byRole: Record<PlanRole, number> = { podcast: 0, news: 0, long: 0, quash: 0, talk: 0, rush: 0, harvey: 0 };
  for (const it of items) byRole[it.role] += it.durationSec;
  const filler = byRole.news + byRole.long + byRole.quash + byRole.talk + byRole.rush + byRole.harvey;
  return { spokenSec: filler + byRole.podcast, byRole, longShareOfFiller: filler ? byRole.long / filler : 0 };
}
