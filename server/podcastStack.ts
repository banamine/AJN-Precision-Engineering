/* "Fresh-first reverse-chronological stack" for the 24/7 podcast channel.
 *
 * Why it is a pure function and not a stateful "played" set:
 *   A broadcast is shared by every listener and runs on several Cloud Run instances that restart. A server-side
 *   played-set would differ between instances and vanish on restart. Instead the whole schedule is a deterministic
 *   replay: starting HISTORY_DAYS before today's UTC midnight with nothing aired, the engine picks one episode per
 *   slot using only what had been PUBLISHED by that slot's start. Same feed pool in -> same schedule out, on every
 *   instance, with no stored state. Only today's window is returned.
 *
 * Pick rule at each slot start t (episodes are eligible only once publishedAt <= t):
 *   Tier 1/2  unplayed dated episodes, youngest age first: today, then yesterday, then T-2 ... (age in UTC days).
 *             Inside one age day the shows take turns (the show aired longest ago goes first), newest episode of that show first.
 *   Tier 3    nothing dated left unplayed -> unplayed Archive back-catalog (no air date), shows taking turns.
 *   Cycle     everything has aired -> least recently aired first (keeps the previous order, no early repeats).
 * A new episode never cuts audio: it becomes eligible at its pubDate and is picked at the NEXT slot boundary.
 *
 * Honest limit: with no stored history, an episode our poller only discovers late (published 10:00, read 10:30) can
 * rewrite the last half hour of the replay. Past slots are stable otherwise. */
import type { Program } from '../src/types';

const DAY = 86_400_000;
export const STACK_HISTORY_DAYS = 7;
const MIN_SLOT_MS = 60_000;
const MAX_SIM_SLOTS = 4000;

interface Cand { p: Program; idx: number; show: string; pub: number | null; ms: number }

export function layoutFreshFirstStack(programs: Program[], now: Date, opts: { defaultMinutes?: number; historyDays?: number } = {}): Program[] {
  if (programs.length === 0) return [];
  const defaultMs = (opts.defaultMinutes ?? 45) * 60_000;
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dayEnd = dayStart + DAY;
  const cands: Cand[] = programs.map((p, idx) => {
    const md = (p.metadata ?? {}) as Record<string, unknown>;
    const dur = Number(md.durationSeconds);
    const dated = !md.backCatalog;
    const pub = dated ? Date.parse(String(md.airedUtc ?? p.startTimeUtc ?? '')) : NaN;
    return { p, idx, show: String(md.feedId ?? p.channelId ?? ''), pub: dated && Number.isFinite(pub) ? pub : null,
      ms: Math.max(MIN_SLOT_MS, dur > 0 ? dur * 1000 : defaultMs) };
  });
  const lastAired = new Map<number, number>();      // candidate idx -> slot start
  const showLast = new Map<string, number>();       // show -> last slot start
  const showLastAt = (s: string): number => showLast.get(s) ?? -Infinity;
  const utcDay = (ms: number): number => Math.floor(ms / DAY) * DAY;

  const choose = (t: number): Cand => {
    const eligible = cands.filter((c) => c.pub === null || c.pub <= t);
    const pool = eligible.length ? eligible : cands;   // nothing published yet (tiny feeds): fall back to the whole list, in order
    const unplayedDated = pool.filter((c) => c.pub !== null && !lastAired.has(c.idx));
    if (unplayedDated.length) {
      const today = utcDay(t);
      const age = (c: Cand): number => Math.max(0, Math.round((today - utcDay(c.pub as number)) / DAY));
      const best = Math.min(...unplayedDated.map(age));
      const bucket = unplayedDated.filter((c) => age(c) === best);
      return pickShowTurn(bucket, (a, b) => (b.pub as number) - (a.pub as number) || a.idx - b.idx);
    }
    const unplayedArchive = pool.filter((c) => c.pub === null && !lastAired.has(c.idx));
    if (unplayedArchive.length) return pickShowTurn(unplayedArchive, (a, b) => a.idx - b.idx);
    // everything has aired: start the next cycle with whatever aired longest ago
    return pool.reduce((a, b) => ((lastAired.get(b.idx) ?? -Infinity) < (lastAired.get(a.idx) ?? -Infinity) ? b : a));
  };
  /** Shows take turns: the show aired longest ago goes first; ties go to the show with the newest candidate, then by name. */
  const pickShowTurn = (bucket: Cand[], within: (a: Cand, b: Cand) => number): Cand => {
    const byShow = new Map<string, Cand[]>();
    for (const c of bucket) (byShow.get(c.show) ?? byShow.set(c.show, []).get(c.show)!).push(c);
    const heads = [...byShow.entries()].map(([show, list]) => ({ show, head: [...list].sort(within)[0] }));
    heads.sort((a, b) => showLastAt(a.show) - showLastAt(b.show)
      || ((b.head.pub ?? -Infinity) - (a.head.pub ?? -Infinity)) || a.head.idx - b.head.idx);
    return heads[0].head;
  };

  const out: Program[] = [];
  let t = dayStart - (opts.historyDays ?? STACK_HISTORY_DAYS) * DAY;
  for (let n = 0; t < dayEnd && n < MAX_SIM_SLOTS; n++) {
    const c = choose(t);
    const stop = t + c.ms;
    lastAired.set(c.idx, t); showLast.set(c.show, t);
    if (stop > dayStart) {
      const s = Math.max(t, dayStart), e = Math.min(stop, dayEnd);
      const h = (ms: number): number => (ms - dayStart) / 3_600_000;
      out.push({
        ...c.p,
        metadata: { ...(c.p.metadata ?? {}), airedUtc: (c.p.metadata as any)?.airedUtc ?? c.p.startTimeUtc, stackTier: c.pub === null ? 'archive' : 'fresh-first' },
        id: `${c.p.id}:s${t}`,
        startTimeUtc: new Date(s).toISOString(), endTimeUtc: new Date(e).toISOString(),
        startTime: h(s), endTime: h(e), startHour: h(s), endHour: h(e),
      } as Program);
    }
    t = stop;
  }
  return out;
}
