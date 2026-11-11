/* Schedule controller for the Spectrum & 24-Hour Schedule Deck. Separate from showQueue and MinimalPlayer (neither is edited):
 * it drives playback only through the existing PlayProgramCallback (incl. startAtSeconds) and reads/seeks the persistent element through
 * usePersistentMedia. Real durations only; failures are shown, never hidden.
 * Why it moves to the next track itself: PlayerView.advance() starts its own "continue elsewhere" a moment after a track ends. We therefore
 * start the next slot ~0.4 s before the end (and again on 'ended' as a backup), so our play call is the latest one and PlayerView's pending advance goes stale. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlayProgramCallback } from '../types';
import { findPersistentMedia, usePersistentMedia } from './usePersistentMedia';
import { clockEligible, orderTracks, shuffleWindow, slotAt, slotsAfter, type SchedPool, type SchedTrack, type Slot } from '../utils/roundRobinSchedule';

export type ScheduleMode = 'clock24h' | 'shuffle' | 'off-schedule';
export type SeekStatus = 'none' | 'pending' | 'synced' | 'fallback-zero';
export interface AiredEntry { programId: string; title: string; subtitle: string; bank: string; poolId: string; airedAtUtcMs: number }
export interface DeckRow { track: SchedTrack; startUtcMs: number | null; failed: boolean }
type Cursor = { kind: 'clock'; slot: Slot; startedMs: number } | { kind: 'shuffle'; order: SchedTrack[]; index: number; startedMs: number };

const PREF_KEY = 'ajn.schedule.mode.v1';
const readPref = (): 'clock24h' | 'shuffle' => { try { return localStorage.getItem(PREF_KEY) === 'shuffle' ? 'shuffle' : 'clock24h'; } catch { return 'clock24h'; } };
const savePref = (m: 'clock24h' | 'shuffle'): void => { try { localStorage.setItem(PREF_KEY, m); } catch { /* storage unavailable */ } };
const LOG_MAX = 50;
const SEEK_TIMEOUT_MS = 3000;

export interface ScheduleController {
  mode: ScheduleMode; pref: 'clock24h' | 'shuffle'; clockEligible: boolean; tuned: boolean;
  now: { track: SchedTrack; startUtcMs: number | null; endUtcMs: number | null; cycle: number } | null;
  upcoming: DeckRow[]; elapsedSec: number; seekStatus: SeekStatus; note: string | null; aired: AiredEntry[];
  setMode: (m: 'clock24h' | 'shuffle') => void; tune: () => void; returnToLive: () => void; pickUpcoming: (i: number) => void;
}

export function useScheduleController(pool: SchedPool | null, onPlayProgram: PlayProgramCallback, nowPlayingProgramId: string | undefined, enabled = true): ScheduleController {
  const [pref, setPref] = useState<'clock24h' | 'shuffle'>(readPref);
  const [tuned, setTuned] = useState(false);
  const [offSchedule, setOffSchedule] = useState(false);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [shuffleSeed, setShuffleSeed] = useState(() => (Date.now() >>> 0));
  const [seekStatus, setSeekStatus] = useState<SeekStatus>('none');
  const [note, setNote] = useState<string | null>(null);
  const [aired, setAired] = useState<AiredEntry[]>([]);
  const [failedVersion, setFailedVersion] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [previewSlot, setPreviewSlot] = useState<Slot | null>(null);
  const failedIds = useRef<Set<string>>(new Set());
  const previewPool = useRef<string | null>(null);
  const lastCommandAt = useRef(0);
  const advancingFor = useRef<string | null>(null);
  const failureHandledFor = useRef<string | null>(null);
  const loggedFor = useRef<string | null>(null);
  const pending = useRef<{ programId: string; slotStartMs: number; since: number; sentAt: number | null } | null>(null);

  const eligible = clockEligible(pool);
  const mode: ScheduleMode = !eligible ? 'shuffle' : tuned && offSchedule ? 'off-schedule' : pref;
  const order = useMemo(() => (pool ? orderTracks(pool, shuffleSeed) : []), [pool, shuffleSeed]);

  // 1-second tick: only progress/clock text depends on it.
  useEffect(() => { if (!enabled) return; const id = window.setInterval(() => setNowMs(Date.now()), 1000); return () => window.clearInterval(id); }, [enabled]);
  // The previewed clock slot is recomputed only when its window has ended or the pool changed (not every tick).
  useEffect(() => {
    if (!pool || !eligible) { setPreviewSlot(null); return; }
    setPreviewSlot((prev) => (prev && previewPool.current === pool.id && nowMs >= prev.startUtcMs && nowMs < prev.endUtcMs ? prev : (previewPool.current = pool.id, slotAt(pool, nowMs))));
  }, [pool, eligible, nowMs]);

  const media = usePersistentMedia('audio', cursorKey(cursor), enabled && tuned);
  const live = useRef({ media, programId: nowPlayingProgramId });
  live.current = { media, programId: nowPlayingProgramId };

  const isFailed = (t: SchedTrack): boolean => failedIds.current.has(t.programId);

  const play = useCallback((c: Cursor, offsetSec: number, track: SchedTrack) => {
    lastCommandAt.current = Date.now(); advancingFor.current = null; failureHandledFor.current = null;
    setCursor(c); setTuned(true);
    const target = offsetSec > 2 ? Math.floor(offsetSec) : 0;
    if (target > 0) { pending.current = { programId: track.programId, slotStartMs: c.startedMs, since: Date.now(), sentAt: null }; setSeekStatus('pending'); }
    else { pending.current = null; setSeekStatus('none'); }
    onPlayProgram(track.src, track.title, track.subtitle, 'audio', track.channelId, track.guideId, track.programId, undefined, undefined, target > 0 ? target : undefined);
  }, [onPlayProgram]);

  /** First playable clock slot at/after `slot` (skipping tracks that already failed this session). */
  const firstPlayable = useCallback((slot: Slot | null): Slot | null => {
    let s = slot;
    for (let i = 0; s && i < 12; i++) { if (!isFailed(s.track)) return s; s = slotsAfter(pool as SchedPool, s, 1)[0] ?? null; }
    return null;
  }, [pool]);

  const tuneLive = useCallback(() => {
    if (!pool || !eligible) return;
    const t = Date.now(); const s = firstPlayable(slotAt(pool, t));
    if (!s) { setNote('No playable track in this pool'); return; }
    const skipped = s.startUtcMs > t;
    setOffSchedule(skipped); setNote(skipped ? 'Failed to load — skipped' : null);
    play({ kind: 'clock', slot: s, startedMs: skipped ? t : s.startUtcMs }, skipped ? 0 : (t - s.startUtcMs) / 1000, s.track);
  }, [pool, eligible, firstPlayable, play]);

  const startShuffle = useCallback((fresh: boolean) => {
    if (!pool) return;
    const seed = fresh ? (Date.now() >>> 0) : shuffleSeed; if (fresh) setShuffleSeed(seed);
    const o = fresh ? orderTracks(pool, seed) : order;
    const index = o.findIndex((t) => !isFailed(t)); if (index < 0) { setNote('No playable track in this pool'); return; }
    setOffSchedule(false); setNote(null);
    play({ kind: 'shuffle', order: o, index, startedMs: Date.now() }, 0, o[index]);
  }, [pool, order, shuffleSeed, play]);

  const advance = useCallback((reason: 'ended' | 'failed') => {
    if (!pool || !cursor) return;
    if (cursor.kind === 'shuffle') {
      for (let i = 1; i <= cursor.order.length; i++) {
        const index = (cursor.index + i) % cursor.order.length; const t = cursor.order[index];
        if (!isFailed(t)) { if (reason === 'failed') setNote('Failed to load — skipped'); else setNote(null); play({ kind: 'shuffle', order: cursor.order, index, startedMs: Date.now() }, 0, t); return; }
      }
      setNote('No playable track in this pool'); return;
    }
    const now = Date.now();
    if (offSchedule || reason === 'failed') {                      // not following the wall clock: take the next scheduled track from 0:00
      const next = firstPlayable(slotsAfter(pool, cursor.slot, 1)[0] ?? null);
      if (!next) { setNote('No playable track in this pool'); return; }
      if (reason === 'failed') setNote('Failed to load — skipped');
      setOffSchedule(true); play({ kind: 'clock', slot: next, startedMs: now }, 0, next.track); return;
    }
    let s = slotAt(pool, now + 500);                                 // 500 ms look-ahead covers the early hand-off
    if (s && s.startUtcMs === cursor.slot.startUtcMs) s = slotsAfter(pool, cursor.slot, 1)[0] ?? null;
    const next = firstPlayable(s);
    if (!next) { setNote('No playable track in this pool'); return; }
    const skipped = next.startUtcMs > now + 500; setOffSchedule(skipped); setNote(skipped ? 'Failed to load — skipped' : null);
    const offset = skipped ? 0 : Math.max(0, (now - next.startUtcMs) / 1000);
    play({ kind: 'clock', slot: next, startedMs: skipped ? now : next.startUtcMs }, offset, next.track);
  }, [pool, cursor, offSchedule, firstPlayable, play]);
  const advanceRef = useRef(advance); advanceRef.current = advance;

  // Hand-off: ~0.4 s before the end (or on 'ended') start the next slot ourselves.
  useEffect(() => {
    if (!tuned || !cursor || !enabled) return;
    const key = cursorKey(cursor)!; let el: HTMLMediaElement | null = null;
    const trigger = () => {
      if (advancingFor.current === key || live.current.programId !== cursorProgramId(cursor)) return;
      advancingFor.current = key; advanceRef.current('ended');
    };
    const onTime = () => { if (el && Number.isFinite(el.duration) && el.duration > 1 && el.currentTime > 1 && el.duration - el.currentTime <= 0.4) trigger(); };
    const bind = () => {
      const next = findPersistentMedia('audio'); if (next === el) return;
      if (el) { el.removeEventListener('timeupdate', onTime); el.removeEventListener('ended', trigger); }
      el = next; if (el) { el.addEventListener('timeupdate', onTime); el.addEventListener('ended', trigger); }
    };
    bind(); const id = window.setInterval(bind, 250);
    return () => { window.clearInterval(id); if (el) { el.removeEventListener('timeupdate', onTime); el.removeEventListener('ended', trigger); } };
  }, [tuned, enabled, cursor]);

  // Failed load (404 / proxy error / decode error): remember it, say so, move on.
  useEffect(() => {
    if (!tuned || !cursor || !media.failed || live.current.programId !== cursorProgramId(cursor)) return;
    const key = cursorKey(cursor)!; if (failureHandledFor.current === key) return;
    failureHandledFor.current = key; failedIds.current.add(cursorProgramId(cursor)); setFailedVersion((v) => v + 1);
    advanceRef.current('failed');
  }, [tuned, cursor, media.failed]);

  // Mid-track tune-in: startAtSeconds is passed to the player; we verify the position and seek once if needed, with a 3 s settle window.
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      const p = pending.current; if (!p) return;
      const { media: m, programId } = live.current; const now = Date.now(); const expected = (now - p.slotStartMs) / 1000;
      if (programId === p.programId && m.attached && m.duration > 0) {
        if (Math.abs(m.currentTime - expected) <= 3 && (now - p.since > 600 || p.sentAt)) { pending.current = null; setSeekStatus('synced'); return; }
        if (!p.sentAt && now - p.since > 600) { m.seek(Math.min(expected, Math.max(0, m.duration - 1))); p.sentAt = now; return; }
        if (p.sentAt && now - p.sentAt > SEEK_TIMEOUT_MS) { m.seek(0); pending.current = null; setSeekStatus('fallback-zero'); setCursor((c) => (c ? { ...c, startedMs: now } : c)); }
      } else if (now - p.since > 10_000) { pending.current = null; setSeekStatus('fallback-zero'); }
    }, 200);
    return () => window.clearInterval(id);
  }, [enabled]);

  // Something else started playing (the listener picked another item): stop steering so we never fight the listener.
  useEffect(() => {
    if (!tuned || !cursor || !nowPlayingProgramId) return;
    if (nowPlayingProgramId !== cursorProgramId(cursor) && Date.now() - lastCommandAt.current > 4000) { setTuned(false); setOffSchedule(false); setSeekStatus('none'); pending.current = null; }
  }, [tuned, cursor, nowPlayingProgramId]);

  // Aired ledger: a track counts as aired once it is really playing.
  useEffect(() => {
    if (!tuned || !cursor || !media.attached || media.paused || live.current.programId !== cursorProgramId(cursor)) return;
    const key = cursorKey(cursor)!; if (loggedFor.current === key) return;
    loggedFor.current = key; const t = cursorTrack(cursor);
    setAired((a) => [{ programId: t.programId, title: t.title, subtitle: t.subtitle, bank: t.bank, poolId: t.poolId, airedAtUtcMs: Date.now() }, ...a].slice(0, LOG_MAX));
  }, [tuned, cursor, media.attached, media.paused, nowPlayingProgramId]);

  // A different pool: stop steering, forget the cursor.
  const poolId = pool?.id;
  useEffect(() => { setTuned(false); setOffSchedule(false); setCursor(null); setNote(null); setSeekStatus('none'); pending.current = null; }, [poolId]);

  const active: Cursor | null = tuned && cursor ? cursor
    : !pool ? null : pref === 'clock24h' && eligible ? (previewSlot ? { kind: 'clock', slot: previewSlot, startedMs: previewSlot.startUtcMs } : null)
    : order.length ? { kind: 'shuffle', order, index: 0, startedMs: eligible ? Math.floor(nowMs / 60_000) * 60_000 : 0 } : null; // preview times update once a minute

  const nowRow = active ? (active.kind === 'clock'
    ? { track: active.slot.track, startUtcMs: active.startedMs, endUtcMs: active.startedMs + (active.slot.endUtcMs - active.slot.startUtcMs), cycle: active.slot.cycle }
    : { track: active.order[active.index], startUtcMs: eligible ? active.startedMs : null, endUtcMs: eligible && active.order[active.index].durationSeconds ? active.startedMs + (active.order[active.index].durationSeconds as number) * 1000 : null, cycle: 1 }) : null;

  const upcoming: DeckRow[] = useMemo(() => {
    if (!active || !pool) return [];
    if (active.kind === 'shuffle') return shuffleWindow(active.order, active.index, active.startedMs || null, 3).map((r) => ({ ...r, failed: failedIds.current.has(r.track.programId) }));
    let at = active.startedMs + (active.slot.endUtcMs - active.slot.startUtcMs);
    return slotsAfter(pool, active.slot, 3).map((s) => { const row = { track: s.track, startUtcMs: at, failed: failedIds.current.has(s.track.programId) }; at += s.endUtcMs - s.startUtcMs; return row; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active && cursorKey(active), pool, failedVersion]);

  const playing = tuned && cursor && live.current.programId === cursorProgramId(cursor) && media.attached;
  const elapsedSec = !nowRow ? 0 : playing ? media.currentTime
    : nowRow.startUtcMs !== null ? Math.max(0, (nowMs - nowRow.startUtcMs) / 1000) : 0;

  const setMode = useCallback((m: 'clock24h' | 'shuffle') => {
    if (m === 'clock24h' && !eligible) return;
    setPref(m); savePref(m);
    if (tuned) { if (m === 'clock24h') tuneLive(); else startShuffle(true); } else if (m === 'shuffle') setShuffleSeed(Date.now() >>> 0);
  }, [eligible, tuned, tuneLive, startShuffle]);
  const tune = useCallback(() => { if (pref === 'clock24h' && eligible) tuneLive(); else startShuffle(false); }, [pref, eligible, tuneLive, startShuffle]);
  const pickUpcoming = useCallback((i: number) => {
    if (!pool || !active) return;
    if (active.kind === 'shuffle') { const index = (active.index + 1 + i) % active.order.length; play({ kind: 'shuffle', order: active.order, index, startedMs: Date.now() }, 0, active.order[index]); return; }
    const s = slotsAfter(pool, active.slot, 3)[i]; if (!s) return;
    setOffSchedule(true); setNote(null); play({ kind: 'clock', slot: s, startedMs: Date.now() }, 0, s.track);
  }, [pool, active, play]);

  return { mode, pref, clockEligible: eligible, tuned, now: nowRow, upcoming, elapsedSec, seekStatus, note, aired, setMode, tune, returnToLive: tuneLive, pickUpcoming };
}

const cursorTrack = (c: Cursor): SchedTrack => (c.kind === 'clock' ? c.slot.track : c.order[c.index]);
const cursorProgramId = (c: Cursor): string => cursorTrack(c).programId;
const cursorKey = (c: Cursor | null): string | undefined => (c ? `${cursorProgramId(c)}@${c.kind === 'clock' ? c.slot.startUtcMs : c.startedMs}${c.kind === 'shuffle' ? `#${c.index}` : ''}` : undefined);
