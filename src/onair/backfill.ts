/* On Air backfill planner. Pure: no React, no network, no wall clock, no Math.random (a seeded generator, fixed per Denver date).
 * Input: today's FRESH podcast slots (the edition loop only: older episodes never play) and the real filler pool (/api/onair/filler).
 * Output: an ordered plan of spoken blocks. The run-of-show puts a music block after every block with musicAfter=true.
 * Rules (user, 2026-11-22): news = two ~5 min clips of one channel then music; long Infowars-family channels get ~35% of filler;
 * The Quash is a labelled "Break"; music sits between any two different spoken blocks; every block has a time cap; no repeats back to back. */
import type { EditionSlot } from '../utils/dailyEdition';
import type { FillClip, FillerPool } from '../../server/onairFiller';
import { fnv1a } from '../utils/roundRobinSchedule';

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
}
export const DEFAULT_BACKFILL: BackfillCfg = {
  longShare: 0.35, newsClipsPerBlock: 2, longCapSec: 720, long76CapSec: 900, quashCapSec: 900, podcastCapSec: 1500,
  useOffsets: true, longMinOffsetSec: 120, longTailMarginSec: 900, enoughFreshSec: 4 * 3600, excludeNews: ['CTV News'], musicSec: 420,
};

export type PlanRole = 'podcast' | 'news' | 'long' | 'quash';
export interface PlanItem {
  role: PlanRole;
  slot?: EditionSlot; clip?: FillClip;
  durationSec: number; startOffsetSec: number;
  musicAfter: boolean; filler: boolean;
  tag: string; why: string; clipDate: string | null; channel: string;
}

/** Small seeded generator (mulberry32). Same seed, same day plan, on every reload and every viewer. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

type Pattern = { id: 'A' | 'B' | 'C'; roles: PlanRole[] };
const PATTERNS: Record<'A' | 'B' | 'C', Pattern> = {
  A: { id: 'A', roles: ['news', 'quash', 'news', 'long'] },
  B: { id: 'B', roles: ['long', 'news', 'long', 'news'] },
  C: { id: 'C', roles: ['news', 'long', 'quash', 'news'] },
};

export interface PlanArgs { fresh: readonly EditionSlot[]; pool: FillerPool | null; dateKey: string; cfg: BackfillCfg; targetSec: number; seedExtra?: string }

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

  let lastNewsChannel = '', lastLongChannel = '', lastPattern = '';
  let total = 0, freshIdx = 0, cycle = 0;
  const freshCapped = (s: EditionSlot): number => (cfg.podcastCapSec > 0 ? Math.min(s.durationSeconds, cfg.podcastCapSec) : s.durationSeconds);
  const freshSecLeft = (): number => fresh.slice(freshIdx).reduce((a, s) => a + freshCapped(s) + cfg.musicSec, 0);
  const add = (it: PlanItem): void => { items.push(it); total += it.durationSec + (it.musicAfter ? cfg.musicSec : 0); };

  const offsetFor = (durSec: number, capSec: number): number => {
    if (!cfg.useOffsets) return 0;
    const lo = cfg.longMinOffsetSec, hi = durSec - capSec - cfg.longTailMarginSec;
    return hi > lo ? Math.floor(lo + rng() * (hi - lo)) : 0;
  };

  const makeNews = (why: string): PlanItem[] => {
    if (!newsChannels.length) return [];
    const ch = pick(newsChannels, (c) => c !== lastNewsChannel) as string; lastNewsChannel = ch;
    const clips = news.filter((c) => c.channel === ch);
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
    // No fresh podcast left: rotate patterns, never the same one twice in a row.
    const r = rng();
    const wB = cfg.longShare, wRest = (1 - cfg.longShare) / 2;
    let id: 'A' | 'B' | 'C' = r < wB ? 'B' : r < wB + wRest ? 'A' : 'C';
    if (id === lastPattern) id = id === 'B' ? 'A' : id === 'A' ? 'C' : 'A';
    lastPattern = id;
    let any = false;
    for (const role of PATTERNS[id].roles) for (const it of make(role, `pattern ${id}`)) { add(it); any = true; }
    if (!any) break; // nothing in the pool: stop instead of looping
  }
  return items;
}

/** Plain-words summary of a plan, for the debug strip and the tests. */
export function summarizePlan(items: readonly PlanItem[]): { spokenSec: number; byRole: Record<PlanRole, number>; longShareOfFiller: number } {
  const byRole: Record<PlanRole, number> = { podcast: 0, news: 0, long: 0, quash: 0 };
  for (const it of items) byRole[it.role] += it.durationSec;
  const filler = byRole.news + byRole.long + byRole.quash;
  return { spokenSec: filler + byRole.podcast, byRole, longShareOfFiller: filler ? byRole.long / filler : 0 };
}
