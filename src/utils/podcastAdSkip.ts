/* Podcast ad-break skipping: pure logic (no React, no DOM), shared by the full player and the bottom dock.
 *
 * Two sources of "where is the ad break":
 *  1. THE MAP  (iHeart/Triton shows): the server reads the break layout of the clean episode from the download link
 *     (server/podcastAdMap.ts). Served-file positions are then estimated from how many ad seconds the file really contains.
 *  2. WHAT THE LISTENER DID (every show): skips of >= 45 s are remembered per show; a spot skipped in 2+ different
 *     episodes becomes a "watch window" that raises the same prompt.
 * Stage A/B only ASKS ("Skip ad break?"); nothing here skips by itself. */

export type PodKind = 'pre' | 'mid' | 'post';
export interface AdMapPod { kind: PodKind; ads: number; cleanAt: number | null }
export interface AdMap { provider: string; cleanSeconds: number | null; pods: AdMapPod[] }

/* ---------- ad budget: how many ad seconds are inside this file ---------- */
export const MIN_AD_SECONDS = 20;
export type Budget =
  | { state: 'ads'; seconds: number; fileSeconds: number; cleanSeconds: number }
  | { state: 'none'; fileSeconds: number; cleanSeconds: number }
  | { state: 'unknown'; why: 'feed-length-missing' | 'feed-length-mismatch' | 'not-loaded' };

/** file length (from the audio element) minus the clean length (the feed's / the map's). Never guessed: a missing feed length says so. */
export function adBudget(fileSeconds: number, cleanSeconds: number | null | undefined): Budget {
  if (!Number.isFinite(fileSeconds) || fileSeconds <= 1) return { state: 'unknown', why: 'not-loaded' };
  if (cleanSeconds === null || cleanSeconds === undefined || !Number.isFinite(cleanSeconds) || cleanSeconds < 60) return { state: 'unknown', why: 'feed-length-missing' };
  const d = fileSeconds - cleanSeconds;
  if (d > fileSeconds * 0.6) return { state: 'unknown', why: 'feed-length-mismatch' }; // the feed length is plainly not this file
  if (d < MIN_AD_SECONDS) return { state: 'none', fileSeconds, cleanSeconds };
  return { state: 'ads', seconds: d, fileSeconds, cleanSeconds };
}

/* ---------- format ---------- */
export function fmtMS(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.round(sec); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}
export function budgetLine(b: Budget): string | null {
  if (b.state === 'ads') return `Ads stitched into this file: about ${fmtMS(b.seconds)} (file ${fmtMS(b.fileSeconds)}, show ${fmtMS(b.cleanSeconds)})`;
  if (b.state === 'none') return 'No stitched-in ads: file length matches the feed';
  if (b.why === 'feed-length-missing') return 'Feed length unavailable: ad time cannot be measured';
  if (b.why === 'feed-length-mismatch') return 'Feed length does not match this file: ad time cannot be measured';
  return null; // not loaded yet: nothing to say
}

/* ---------- THE MAP: estimate where each break sits in the served file ---------- */
/** One ad is about 30 s; a full break of n ads is capped at n * 30.4 s (measured: 5 ads = 152-155 s). */
export const AD_SECONDS_EACH = 30.4;
export interface PodEstimate { index: number; kind: PodKind; ads: number; cleanAt: number; startServed: number; length: number; endServed: number; /** set by captionSync.applyLocks: both edges measured, not estimated */ exact?: boolean; startExact?: boolean }

/** Spread `budget` ad seconds over the breaks in order, each up to its cap; whatever is left goes on the last break (inventory
 *  that was not filled tends to be at the end). Start of break k in the file = its clean position + the ads before it.
 *  Checked against the real "Stocking Up!" file: estimates landed within 6 s of the true edges. Stage C will snap to real audio edges. */
export function estimatePods(pods: AdMapPod[], budget: number, cleanSeconds: number): PodEstimate[] {
  if (!(budget > 0) || !pods.length || !Number.isFinite(cleanSeconds)) return [];
  let left = budget; let before = 0; const out: PodEstimate[] = [];
  pods.forEach((p, i) => {
    const cap = p.ads * AD_SECONDS_EACH;
    const last = i === pods.length - 1;
    const len = Math.max(0, last ? left : Math.min(cap, left));
    left -= len;
    if (len < 10) return;
    const cleanAt = p.cleanAt ?? cleanSeconds;
    out.push({ index: i, kind: p.kind, ads: p.ads, cleanAt, startServed: cleanAt + before, length: len, endServed: cleanAt + before + len });
    before += len;
  });
  return out;
}

/* ---------- the prompt ---------- */
/** The button only works this close to (or inside) the estimated break, so pressing early can never cut more than a few seconds of the show. */
export const ACCEPT_WITHIN_SECONDS = 15;
export const canAccept = (c: { inside: boolean; startsIn: number }) => c.inside || c.startsIn <= ACCEPT_WITHIN_SECONDS;
export const CHIP_LEAD_SECONDS = 45; // prompt appears this long before the estimated start (the estimate can be early by up to ~30 s)
export interface ChipState { key: string; kind: PodKind; startsIn: number; inside: boolean; skipTo: number; skipSeconds: number; source: 'map' | 'learned'; estimated: boolean }

export function chipFromPods(est: PodEstimate[], playhead: number, fileSeconds: number, handled: ReadonlySet<string>): ChipState | null {
  for (const e of est) {
    const key = `map:${e.index}`;
    if (handled.has(key)) continue;
    if (playhead >= e.startServed - CHIP_LEAD_SECONDS && playhead < e.endServed - 8) {
      const target = Math.min(e.endServed, fileSeconds - 0.5);
      if (target - playhead < 8) continue;
      return { key, kind: e.kind, startsIn: e.startServed - playhead, inside: playhead >= e.startServed, skipTo: target, skipSeconds: target - playhead, source: 'map', estimated: !e.exact };
    }
  }
  return null;
}

/* ---------- WHAT THE LISTENER DID ---------- */
export const MIN_BURST_SECONDS = 45;   // a skip shorter than this is impatience with a caller, not an ad break
export const CONTINUE_SECONDS = 3;    // a tap that starts further than this from the last landing is a different skip
export const SETTLE_MS = 8000;         // taps closer together than this belong to one skip; a tap back inside it adjusts the landing
export interface Burst { at: number; len: number }

/** Folds a run of seeks into one skip. +30,+30 within 8 s = 60 s. +3:00 then -0:15 within 8 s = 2:45 (the exact boundary the
 *  listener chose). Time is passed in so tests need no clock. */
export class BurstTracker {
  private cur: { from: number; to: number; last: number } | null = null;
  private done: Burst[] = [];
  seek(from: number, to: number, now: number): void {
    if (!Number.isFinite(from) || !Number.isFinite(to)) return;
    // Same skip only if it continues from where the last tap landed (or, for taps closer than the seek can settle, from where the run began).
    if (this.cur && now - this.cur.last <= SETTLE_MS && (Math.abs(from - this.cur.to) <= CONTINUE_SECONDS || Math.abs(from - this.cur.from) <= CONTINUE_SECONDS)) { this.cur.to = to; this.cur.last = now; return; }
    this.close(); this.cur = { from, to, last: now };
  }
  private close(): void {
    if (this.cur) { const len = this.cur.to - this.cur.from; if (len >= MIN_BURST_SECONDS) this.done.push({ at: this.cur.from, len }); this.cur = null; }
  }
  /** Finished skips (a burst closes once SETTLE_MS passes with no more taps; `force` closes it now). */
  take(now: number, force = false): Burst[] {
    if (this.cur && (force || now - this.cur.last > SETTLE_MS)) this.close();
    const out = this.done; this.done = []; return out;
  }
  get open(): boolean { return this.cur !== null; }
}

export interface SkipEvent { at: number; len: number; remaining: number; ep: string; when: number }
export interface ShowMemory { v: 1; mode: 'ask' | 'off'; events: SkipEvent[]; seen: string[]; accepted: number; dismissed: number }
export const MAX_EVENTS = 60; export const MAX_SEEN = 30;
export const emptyMemory = (): ShowMemory => ({ v: 1, mode: 'ask', events: [], seen: [], accepted: 0, dismissed: 0 });

export function normalizeMemory(raw: unknown): ShowMemory {
  const m = emptyMemory();
  if (!raw || typeof raw !== 'object') return m;
  const r = raw as Record<string, unknown>;
  if (r.mode === 'off') m.mode = 'off';
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  if (Array.isArray(r.events)) for (const e of r.events.slice(-MAX_EVENTS)) {
    const o = e as Record<string, unknown>; const at = num(o?.at), len = num(o?.len), remaining = num(o?.remaining), when = num(o?.when);
    if (at !== null && len !== null && remaining !== null && when !== null && len > 0 && typeof o.ep === 'string') m.events.push({ at, len, remaining, ep: o.ep, when });
  }
  if (Array.isArray(r.seen)) m.seen = r.seen.filter((s): s is string => typeof s === 'string').slice(-MAX_SEEN);
  m.accepted = Math.max(0, num(r.accepted) ?? 0); m.dismissed = Math.max(0, num(r.dismissed) ?? 0);
  return m;
}
export function addEvent(mem: ShowMemory, e: SkipEvent): ShowMemory {
  return { ...mem, events: [...mem.events, e].slice(-MAX_EVENTS) };
}
export function markSeen(mem: ShowMemory, ep: string): ShowMemory {
  return mem.seen.includes(ep) ? mem : { ...mem, seen: [...mem.seen, ep].slice(-MAX_SEEN) };
}

export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void }
const KEY = (show: string) => `ajn-adskip.v1:${show}`;
export function loadMemory(show: string, st: StorageLike | null): ShowMemory {
  try { const raw = st?.getItem(KEY(show)); return raw ? normalizeMemory(JSON.parse(raw)) : emptyMemory(); } catch { return emptyMemory(); }
}
export function saveMemory(show: string, mem: ShowMemory, st: StorageLike | null): void {
  try { st?.setItem(KEY(show), JSON.stringify(mem)); } catch { /* private mode / quota: learning just does not persist */ }
}

/* ---------- learned watch windows (shows without a map) ---------- */
export interface LearnedWindow { kind: PodKind; /** elapsed seconds (pre/mid) or seconds before the end (post) */ anchor: number; len: number; episodes: number }
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
export const CLUSTER_RADIUS = 90;

export function kindOf(e: SkipEvent): PodKind {
  if (e.at < 20) return 'pre';
  if (e.remaining - e.len < 20) return 'post'; // the skip ran to the end of the episode
  return 'mid';
}
/** A spot skipped in 2+ DIFFERENT episodes. Mid-show spots cluster by elapsed time within 90 s. */
export function learnedWindows(mem: ShowMemory): LearnedWindow[] {
  const out: LearnedWindow[] = [];
  for (const kind of ['pre', 'post', 'mid'] as const) {
    const evs = mem.events.filter((e) => kindOf(e) === kind);
    const val = (e: SkipEvent) => (kind === 'post' ? e.remaining : e.at);
    const sorted = [...evs].sort((a, b) => val(a) - val(b));
    let group: SkipEvent[] = [];
    const flush = () => {
      if (group.length) {
        const eps = new Set(group.map((g) => g.ep));
        if (eps.size >= 2) out.push({ kind, anchor: median(group.map(val)), len: median(group.map((g) => g.len)), episodes: eps.size });
      }
      group = [];
    };
    for (const e of sorted) {
      if (group.length && val(e) - val(group[group.length - 1]) > (kind === 'mid' ? CLUSTER_RADIUS : 40)) flush();
      group.push(e);
    }
    flush();
  }
  return out;
}
export function chipFromLearned(wins: LearnedWindow[], playhead: number, fileSeconds: number, handled: ReadonlySet<string>): ChipState | null {
  for (let i = 0; i < wins.length; i++) {
    const w = wins[i]; const key = `learned:${i}`;
    if (handled.has(key)) continue;
    const start = w.kind === 'post' ? fileSeconds - w.anchor : w.anchor;
    const end = Math.min(start + w.len, fileSeconds - 0.5);
    const lead = w.kind === 'pre' ? 20 : 60;
    if (playhead >= start - lead && playhead < end - 8) {
      return { key, kind: w.kind, startsIn: start - playhead, inside: playhead >= start, skipTo: end, skipSeconds: end - playhead, source: 'learned', estimated: true };
    }
  }
  return null;
}

/** Which breaks did a finished skip already cover? (so the prompt does not nag after the listener handled it) */
export function coveredKeys(b: Burst, est: PodEstimate[], wins: LearnedWindow[], fileSeconds: number): string[] {
  const keys: string[] = []; const s = b.at, e = b.at + b.len;
  const overlap = (a0: number, a1: number) => Math.max(0, Math.min(e, a1) - Math.max(s, a0));
  for (const p of est) if (overlap(p.startServed - CHIP_LEAD_SECONDS, p.endServed) >= Math.min(45, p.length * 0.5)) keys.push(`map:${p.index}`);
  wins.forEach((w, i) => { const st = w.kind === 'post' ? fileSeconds - w.anchor : w.anchor; if (overlap(st - 60, st + w.len) >= 30) keys.push(`learned:${i}`); });
  return keys;
}
