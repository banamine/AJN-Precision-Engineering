/* Drives the On Air state machine (engine.js) with REAL audio: two <audio> decks, real load/ended/error events, real clock.
 * The engine decides (what plays, when to blend, what the deck volumes are); this hook only does what the engine says and reports what
 * the audio elements really did. Readiness of the standby deck is the element's real readyState, never the engine's simulated load timer. */
import { DEFAULT_LEVEL_DB, LevelEstimator, MIN_TRIM, MUSIC_CREEP_DB_PER_SEC, MUSIC_SLEW_DB_PER_SEC, MUSIC_START_BELOW_DB, isMusicKey, musicCreepNext, musicTrimNext, levelKey, outputDb, relativeTrim, rmsDb, slewTrim, trimFor } from './loudness';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AJN_PLAYOUT as E } from './engine.js';
import { DEFAULT_PARAMS, LIVE_STATIONS, segmentIndexAt, type MusicSource, type OnAirParams, type Segment } from './runOfShow';
import { bridgeSrc } from '../utils/mediaRoute';
import { toPlayableSrc } from '../utils/playableSrc';
import type { LibTrack } from './libraryTracks';
import { pickBlockTracks } from './libraryTracks';
import type { LibAlbum } from './libraryTracks';
import type { MeterState } from './OnAirSpectrum';

export type DeckId = 'A' | 'B';
export interface DeckState { id: DeckId; role: string; source: string; volume: number; ceiling: number; readyState: number; readyAtMs: number | null; playing: boolean; loadedItem: string | null; unlocked: boolean }
export interface Machine {
  state: 'IDLE' | 'PLAYING' | 'PREBUFFERING' | 'CROSSFADING' | 'FAILOVER' | 'RETRYING';
  segmentId: string; transitions: number; gateUnlocked: boolean; activeDeck: DeckId; decks: Record<DeckId, DeckState>;
  musicSource: MusicSource; blockSourceOverride: MusicSource | null; fadeKind: string | null;
  activeSegment: Segment | null; nextSegment: Segment | null; afterNextSegment: Segment | null; pendingSegment: Segment | null; pendingSegmentId: string | null;
  skipLoadStarted: boolean; standbyNotReadyBanner: boolean; musicUnavailableBanner: boolean; musicUnavailableUntilMs: number | null;
  slateOverlayUntilMs: number | null; musicExitMs: number | null; musicExitReason: string | null; lastMeasuredGapMs: number;
  libraryUnreachable: boolean; feedStale: boolean; volumeMode: 'crossfade' | 'hard-cut'; trackLengthsMs: number[] | null;
  retryCount: number; songChangeTimesMs: number[]; params: OnAirParams | null; metadataReady: boolean; pendingSeekSec: number | null; podcastSkipWaiting: boolean;
}
interface EngineAction { type: string; deck?: DeckId; ops?: string[]; targetId?: string | null; nextSegmentId?: string | null; seekToSec?: number; message?: string; eventType?: string; attempt?: number; max?: number }
interface TickOut { machine: Machine; runOfShow: Segment[]; actions: EngineAction[] }
interface LogEntry { at: string; nowMs: number; state: string; segmentId: string; msg: string; detail: string | null }

type CaptureEl = HTMLMediaElement & { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream };
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAABErAAABAAgAZGF0YQAAAAA=';
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const LEVELS_KEY = 'ajn-onair-levels-v1';
const loadLevels = (): Record<string, number> => { try { const o = JSON.parse(localStorage.getItem(LEVELS_KEY) ?? '{}') as Record<string, unknown>; const out: Record<string, number> = {}; for (const [k, v] of Object.entries(o)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = v; return out; } catch { return {}; } };
const saveLevels = (o: Record<string, number>): void => { try { localStorage.setItem(LEVELS_KEY, JSON.stringify(o)); } catch { /* storage blocked: levels are simply relearned */ } };
interface LevelState { key: string | null; seg: string | null; settled: boolean; measured: boolean; applied: number; target: number | null; est: LevelEstimator; at: number }
const newLevel = (): LevelState => ({ key: null, seg: null, settled: false, measured: false, applied: 1, target: null, est: new LevelEstimator(), at: 0 });

interface DeckMeta { segmentId: string | null; kind: 'podcast' | 'live' | 'library' | null; tracks: LibTrack[]; trackIdx: number; mutedUntilAudible: boolean; pendingSeek: number | null; loadedAtMs: number }
const emptyMeta = (): DeckMeta => ({ segmentId: null, kind: null, tracks: [], trackIdx: 0, mutedUntilAudible: false, pendingSeek: null, loadedAtMs: 0 });

export interface NowTrack { title: string; artist: string }
export interface OnAirPlayout {
  machine: Machine; ros: Segment[]; nowMs: number; logRing: LogEntry[]; started: boolean; blockTrack: NowTrack | null; blockTracks: LibTrack[];
  startError: string | null; activeVideo: () => HTMLMediaElement | null; analyser: AnalyserNode | null; meterState: MeterState; start: () => void; stop: () => void; notifySongChange: () => void; notifyFeedStale: () => void; replaceFromNextBlock: (build: (afterMs: number) => Segment[]) => boolean;
}

export function useOnAirPlayout(opts: { ros: Segment[]; albums: LibAlbum[] | null; albumsFailed: boolean; params?: OnAirParams; onStart?: () => void }): OnAirPlayout {
  const params = opts.params ?? DEFAULT_PARAMS;
  const rosRef = useRef<Segment[]>(opts.ros);
  const albumsRef = useRef<LibAlbum[] | null>(opts.albums);
  const machineRef = useRef<Machine | null>(null);
  const logRef = useRef<LogEntry[]>([]);
  const eventsRef = useRef<Array<Record<string, unknown>>>([]);
  const decksRef = useRef<{ A: HTMLMediaElement; B: HTMLMediaElement } | null>(null);
  const metaRef = useRef<Record<DeckId, DeckMeta>>({ A: emptyMeta(), B: emptyMeta() });
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const tapRef = useRef<{ deck: DeckId; node: MediaStreamAudioSourceNode; src: string } | null>(null);
  const levelRef = useRef<Record<DeckId, LevelState>>({ A: newLevel(), B: newLevel() });
  const levelMemRef = useRef<Record<string, number>>(loadLevels());
  /** What the last podcast sounded like to the listener (dBFS RMS after trim). The next music block is matched to it. */
  const podcastOutDbRef = useRef<number | null>(null);
  const levelSavedAtRef = useRef(0);
  const levelBufRef = useRef<Float32Array | null>(null);
  const levelMeasuredAtRef = useRef(0);
  const corsRetriedRef = useRef<Record<DeckId, boolean>>({ A: false, B: false });
  const attemptRef = useRef<{ deck: DeckId; src: string; at: number } | null>(null);
  const [meterState, setMeterState] = useState<MeterState>('idle');
  const stallRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const [, setFrame] = useState(0);
  const [started, setStarted] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  albumsRef.current = opts.albums;

  const blockTracksFor = useCallback((seg: Segment): LibTrack[] => (albumsRef.current ? pickBlockTracks(albumsRef.current, seg.id, params) : []), [params]);

  const pushLog = useCallback((nowMs: number, msg: string, detail?: string | null) => {
    const m = machineRef.current;
    logRef.current = E.ringPush(logRef.current, { at: E.formatDenverHMS(nowMs), nowMs, state: m ? m.state : 'IDLE', segmentId: m ? m.segmentId : '', msg, detail: detail ?? null }, 500);
  }, []);

  const makeMachine = useCallback((ros: Segment[], idx: number, unlocked: boolean, libraryUnreachable: boolean, volumeMode: 'crossfade' | 'hard-cut'): Machine => {
    const seg = ros[idx], nxt = ros[idx + 1] ?? ros[0], aft = ros[idx + 2] ?? ros[0];
    const srcOf = (s: Segment): string => (s.type === 'music' ? params.musicSource : 'podcast');
    const ceilA = E.ceilingFor(srcOf(seg), params), ceilB = E.ceilingFor(srcOf(nxt), params);
    const m = {
      state: unlocked ? 'PLAYING' : 'IDLE', segmentId: seg.id, transitions: 0, gateUnlocked: unlocked, activeDeck: 'A',
      decks: {
        A: { id: 'A', role: 'on-air', source: srcOf(seg), volume: unlocked ? ceilA : 0, ceiling: ceilA, readyState: unlocked ? 4 : 0, readyAtMs: null, playing: unlocked, loadedItem: seg.name, unlocked },
        B: { id: 'B', role: 'standby', source: srcOf(nxt), volume: 0, ceiling: ceilB, readyState: 0, readyAtMs: null, playing: false, loadedItem: nxt.name, unlocked },
      },
      musicSource: params.musicSource, blockSourceOverride: null, fadeStartMs: null, fadeDurMs: 0, fadeStartInFrac: 0, fadeKind: null,
      activeSegment: seg, nextSegment: nxt, afterNextSegment: aft, params, feedStale: false, libraryUnreachable, volumeMode, metadataReady: true,
      standbyNotReadyBanner: false, musicUnavailableBanner: false, musicUnavailableUntilMs: null, slateOverlayUntilMs: null, musicExitMs: null, musicExitReason: null,
      songChangeTimesMs: [], trackLengthsMs: null, retryCount: 0, nextRetryAtMs: null,
    } as unknown as Machine;
    return m;
  }, [params]);

  // One analyser per page. Created on the Start click; also created later if a hot-swapped build or a lost context left it missing (the page has had a click by then, so the browser lets it run).
  const ensureMeter = useCallback((): boolean => {
    if (ctxRef.current && analyserRef.current) return true;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) { setMeterState('unavailable'); pushLog(Date.now(), 'meter: this browser has no Web Audio'); return false; }
      const ctx = new Ctor(); const an = ctx.createAnalyser(); an.fftSize = 256; an.smoothingTimeConstant = 0.78;
      ctxRef.current = ctx; analyserRef.current = an; return true;
    } catch (e) { setMeterState('unavailable'); pushLog(Date.now(), `meter: could not start (${e instanceof Error ? e.message : String(e)})`); return false; }
  }, [pushLog]);

  // Meter tap: captureStream() reads the deck's output without re-routing playback, so a source the browser cannot read stays audible and the meter simply says so.
  const attachMeter = useCallback((id: DeckId): void => {
    const ctx = ctxRef.current, an = analyserRef.current, el = decksRef.current?.[id] as CaptureEl | undefined;
    if (!ctx || !an || !el) return;
    if (tapRef.current) { try { tapRef.current.node.disconnect(); } catch { /* already gone */ } tapRef.current = null; }
    const cap = el.captureStream ?? el.mozCaptureStream;
    attemptRef.current = { deck: id, src: el.currentSrc, at: Date.now() };
    if (!cap) { setMeterState('unavailable'); pushLog(Date.now(), `meter: deck ${id} cannot be read by this browser (no captureStream)`); return; }
    try {
      const st = cap.call(el);
      if (!st.getAudioTracks().length) { setMeterState('unavailable'); pushLog(Date.now(), `meter: deck ${id} gave no audio track to read`); return; }
      const node = ctx.createMediaStreamSource(st); node.connect(an);
      tapRef.current = { deck: id, node, src: el.currentSrc };
      setMeterState('reading'); pushLog(Date.now(), `meter: reading deck ${id}`); void ctx.resume().catch(() => undefined);
    } catch (e) { setMeterState('unavailable'); pushLog(Date.now(), `meter: deck ${id} could not be read (${e instanceof Error ? e.message : String(e)})`); }
  }, [pushLog]);

  const ensureDecks = useCallback((): { A: HTMLMediaElement; B: HTMLMediaElement } => {
    if (decksRef.current) return decksRef.current;
    const mk = (id: DeckId): HTMLMediaElement => {
      const el = document.createElement('video'); // a <video> plays audio-only files identically; the picture is mirrored to the page by DeckPicture (the element itself is never attached or moved)
      el.playsInline = true; el.setAttribute('playsinline', '');
      el.preload = 'auto';
      el.addEventListener('error', () => {
        const m = machineRef.current;
        if (!m || m.state === 'IDLE' || !el.getAttribute('src')) return;
        if (el.src === SILENT_WAV) return;
        // A music source that refuses CORS reading is retried once without it: it must still play, only the meter goes off.
        if (el.crossOrigin && el.readyState === 0 && !corsRetriedRef.current[id] && metaRef.current[id].kind !== 'podcast') {
          corsRetriedRef.current[id] = true; const src = el.getAttribute('src') ?? '';
          el.removeAttribute('crossorigin'); el.src = src; el.load(); void el.play().catch(() => undefined);
          pushLog(Date.now(), 'meter off for this source (it does not allow reading); playing without the meter');
          if (m.activeDeck === id) setMeterState('unavailable');
          return;
        }
        eventsRef.current.push({ type: 'ERROR', deck: m.activeDeck === id ? 'active' : 'standby' });
      });
      el.addEventListener('ended', () => {
        const m = machineRef.current;
        if (!m || m.state === 'IDLE' || m.activeDeck !== id) return;
        const meta = metaRef.current[id];
        // A library music block plays several tracks back to back on the same deck.
        if (meta.kind === 'library' && meta.trackIdx + 1 < meta.tracks.length && m.activeSegment?.type === 'music' && m.musicExitMs !== null && Date.now() < m.musicExitMs - 3000) {
          meta.trackIdx += 1; el.src = toPlayableSrc(meta.tracks[meta.trackIdx].src); el.load(); void el.play().catch(() => undefined);
          return;
        }
        eventsRef.current.push({ type: 'ENDED' });
      });
      const clearStall = (): void => { stallRef.current = null; };
      el.addEventListener('playing', clearStall);
      el.addEventListener('playing', () => { const m = machineRef.current; if (m && m.state !== 'IDLE' && m.activeDeck === id) attachMeter(id); });
      el.addEventListener('timeupdate', clearStall);
      el.addEventListener('waiting', () => { const m = machineRef.current; if (m && m.activeDeck === id && stallRef.current === null) stallRef.current = Date.now(); });
      el.addEventListener('loadedmetadata', () => {
        const meta = metaRef.current[id];
        if (meta.pendingSeek !== null) { try { el.currentTime = meta.pendingSeek; } catch { /* not seekable yet */ } meta.pendingSeek = null; }
      });
      return el;
    };
    decksRef.current = { A: mk('A'), B: mk('B') };
    return decksRef.current;
  }, [attachMeter, pushLog]);

  const loadSegmentOn = useCallback((deckId: DeckId, seg: Segment, source: MusicSource, ops: string[] | null): void => {
    const decks = ensureDecks(), el = decks[deckId], meta = metaRef.current[deckId];
    const m = machineRef.current;
    el.pause(); el.removeAttribute('src');
    corsRetriedRef.current[deckId] = false;
    if (seg.type === 'podcast') el.removeAttribute('crossorigin'); else el.crossOrigin = 'anonymous';
    meta.segmentId = seg.id; meta.tracks = []; meta.trackIdx = 0; meta.pendingSeek = null; meta.loadedAtMs = Date.now(); meta.mutedUntilAudible = false;
    if (seg.type === 'podcast') {
      meta.kind = 'podcast';
      el.src = bridgeSrc(seg.src, seg.programId) ?? seg.src ?? '';
      if (seg.startOffsetSec && seg.startOffsetSec > 0) meta.pendingSeek = seg.startOffsetSec; // a news clip window or a seeded start in a long file
    } else if (source === 'Library') {
      const tracks = blockTracksFor(seg);
      meta.kind = 'library'; meta.tracks = tracks;
      if (!tracks.length) { if (m) { m.libraryUnreachable = true; } pushLog(Date.now(), 'library: no playable tracks for this block'); return; }
      if (m && seg.id === m.activeSegment?.id) m.trackLengthsMs = tracks.map((t) => t.durationMs);
      el.src = toPlayableSrc(tracks[0].src);
    } else {
      meta.kind = 'live';
      const st = LIVE_STATIONS[seg.musicStation ?? ''] ?? LIVE_STATIONS['Classic Rock 109'];
      el.src = st.url;
    }
    el.preload = 'auto';
    const list = ops ?? [];
    if (list.indexOf('playMutedAtVolume0') !== -1) { el.volume = 0; el.muted = true; meta.mutedUntilAudible = true; void el.play().catch(() => undefined); }
    el.load();
  }, [blockTracksFor, ensureDecks, pushLog]);

  const teardown = useCallback((deckId: DeckId): void => {
    const el = ensureDecks()[deckId];
    for (const op of E.teardownOps(deckId) as string[]) {
      if (op === 'pause') el.pause();
      else if (op === 'removeAttribute:src') el.removeAttribute('src');
      else if (op === 'load') el.load();
    }
    metaRef.current[deckId] = emptyMeta();
  }, [ensureDecks]);

  const applyActions = useCallback((actions: EngineAction[], m: Machine, ros: Segment[], nowMs: number): void => {
    const decks = ensureDecks();
    const sbId: DeckId = m.activeDeck === 'A' ? 'B' : 'A';
    const find = (id: string | null | undefined): Segment | null => (id ? ros.find((s) => s.id === id) ?? null : null);
    for (const a of actions) {
      if (a.type === 'LOG') pushLog(nowMs, a.message ?? '', a.eventType ?? null);
      else if (a.type === 'PREBUFFER') {
        const target = find(a.targetId) ?? m.nextSegment;
        if (target) loadSegmentOn(a.deck ?? sbId, target, (m.blockSourceOverride ?? m.musicSource) as MusicSource, a.ops ?? []);
      } else if (a.type === 'FAILOVER_LIBRARY') {
        const target = m.pendingSegment ?? m.nextSegment;
        if (target) loadSegmentOn(sbId, target, 'Library', []);
      } else if (a.type === 'MUSIC_SKIPPED' || a.type === 'PODCAST_SKIP_NEXT') {
        const target = m.pendingSegment ?? find(a.nextSegmentId);
        if (target) loadSegmentOn(sbId, target, (m.blockSourceOverride ?? m.musicSource) as MusicSource, []);
      } else if (a.type === 'PODCAST_RETRY') {
        const el = decks[m.activeDeck], at = el.currentTime;
        const meta = metaRef.current[m.activeDeck];
        el.load(); meta.pendingSeek = at > 1 ? at : null; void el.play().catch(() => undefined);
      } else if (a.type === 'TEARDOWN') {
        if (a.deck) teardown(a.deck);
      } else if (a.type === 'SEEK') {
        const el = decks[m.activeDeck]; try { el.currentTime = a.seekToSec ?? 0; } catch { /* not seekable */ }
      }
    }
  }, [ensureDecks, loadSegmentOn, pushLog, teardown]);

  /** After every engine step: put the engine's volumes on the elements and report real readiness back to the engine. */
  const syncAudio = useCallback((m: Machine): void => {
    const decks = ensureDecks();
    (['A', 'B'] as DeckId[]).forEach((id) => {
      const el = decks[id], d = m.decks[id], meta = metaRef.current[id];
      // Build 19: same fade shape as the engine (volume / ceiling), but scaled to the source's learned level instead of a fixed per-kind ceiling.
      const lv = levelRef.current[id]; const key = levelKey(meta.kind, d.loadedItem); const nowT = Date.now();
      if (lv.key !== key || (isMusicKey(key) && lv.seg !== meta.segmentId)) { lv.key = key; lv.seg = meta.segmentId; lv.settled = false; lv.measured = false; lv.est = new LevelEstimator(); const mem = key ? (levelMemRef.current[key] ?? DEFAULT_LEVEL_DB[key]) : undefined; const ref = podcastOutDbRef.current; lv.target = typeof mem === 'number' ? (isMusicKey(key) && ref !== null ? relativeTrim(mem, ref) : trimFor(mem)) : null; lv.applied = isMusicKey(key) && lv.target !== null ? Math.max(MIN_TRIM, lv.target * Math.pow(10, -MUSIC_START_BELOW_DB / 20)) : (lv.target ?? d.ceiling); lv.at = nowT; }
      if (lv.target !== null) {
        const dtS = Math.min(0.5, Math.max(0, (nowT - lv.at) / 1000));
        if (isMusicKey(lv.key)) {
          // Music rises and stays: after it has reached its measured level it is never turned down again within the block.
          lv.applied = musicTrimNext(lv.applied, lv.target, dtS, lv.settled);
          if (lv.measured && lv.applied === lv.target) lv.settled = true;
          if (lv.settled) lv.applied = musicCreepNext(lv.applied, dtS); // then keeps rising slowly to full level (the listener's own volume is the ceiling)
        } else lv.applied = slewTrim(lv.applied, lv.target, dtS);
      }
      lv.at = nowT;
      const vol = d.ceiling > 0 && lv.key ? clamp01((d.volume / d.ceiling) * lv.applied) : clamp01(d.volume);
      if (Math.abs(el.volume - vol) > 0.001) el.volume = vol;
      if (vol > 0 && meta.mutedUntilAudible) { el.muted = false; meta.mutedUntilAudible = false; }
      if (d.playing && el.paused && el.getAttribute('src')) void el.play().catch(() => undefined);
    });
    // Honest readiness: the standby deck is ready only when its real element can play through.
    const sbId: DeckId = m.activeDeck === 'A' ? 'B' : 'A';
    const sb = m.decks[sbId], sbEl = decks[sbId], sbMeta = metaRef.current[sbId];
    sb.readyAtMs = Infinity;
    if (sbMeta.segmentId && sbEl.getAttribute('src')) sb.readyState = sbEl.readyState >= 3 ? 4 : sbEl.readyState >= 1 ? 2 : 1;
    else if (sb.readyState >= 3) sb.readyState = 0;
    // The new on-air deck is real too: a standby that became active keeps its real readiness.
    m.decks[m.activeDeck].readyAtMs = null;
  }, [ensureDecks]);

  const runEngine = useCallback((event: Record<string, unknown> | undefined, nowMs: number): void => {
    const m0 = machineRef.current; if (!m0) return;
    const ev = event ? { ...event, segmentId: m0.segmentId } : undefined;
    const out = E.tickOnce(m0, rosRef.current, nowMs, ev) as unknown as TickOut;
    const prevActive = m0.segmentId;
    machineRef.current = out.machine; rosRef.current = out.runOfShow;
    applyActions(out.actions, out.machine, out.runOfShow, nowMs);
    const m = out.machine;
    // A new music block: tell the engine how long the block's real tracks are, so its exit plan lands on a track boundary.
    if (m.segmentId !== prevActive && m.activeSegment?.type === 'music') {
      const meta = metaRef.current[m.activeDeck];
      if (meta.kind === 'library' && meta.tracks.length) m.trackLengthsMs = meta.tracks.map((t) => t.durationMs);
      const mode = m.blockSourceOverride ?? m.musicSource;
      const ex = E.musicExitAtMs(m.activeSegment.startMs, E.paramsForSegment(m.activeSegment, m.params), m.songChangeTimesMs || [], m.feedStale, mode, m.trackLengthsMs);
      m.musicExitMs = ex.exitAtMs; m.musicExitReason = ex.reason;
    }
    syncAudio(m);
  }, [applyActions, syncAudio]);

  const step = useCallback((): void => {
    const nowMs = Date.now();
    const m = machineRef.current;
    if (!m || m.state === 'IDLE') { setFrame((n) => n + 1); return; }
    m.libraryUnreachable = m.libraryUnreachable || opts.albumsFailed;
    // Podcast stall watchdog: a podcast that has not played for watchdogSec is reported to the engine (3 retries, then skip).
    if (stallRef.current !== null && nowMs - stallRef.current > params.watchdogSec * 1000 && m.activeSegment?.type === 'podcast') {
      stallRef.current = null; eventsRef.current.push({ type: 'STALL', deck: 'active' });
    } else if (stallRef.current !== null && nowMs - stallRef.current > params.watchdogSec * 1000 && m.activeSegment?.type === 'music' && m.state === 'PLAYING') {
      // Live music that stays in "waiting" past the watchdog is a real failure: report it so the engine fails over to the Library (same path as a hard ERROR).
      stallRef.current = null; eventsRef.current.push({ type: 'ERROR', deck: 'active' });
    }
    // The foreground deck changes at the end of a crossfade without a new "playing" event, and a deck may change source: (re)point the meter, at most once every 2 s per attempt.
    {
      if (!analyserRef.current) ensureMeter();
      const d = decksRef.current?.[m.activeDeck];
      if (analyserRef.current && d && !d.paused && d.readyState >= 3) {
        const a = attemptRef.current;
        if (!a || a.deck !== m.activeDeck || a.src !== d.currentSrc) { if (!a || nowMs - a.at > 2000) attachMeter(m.activeDeck); }
      }
    }
    // Build 19: measure the on-air deck's own level (the tap hears it before the element volume) and learn a per-source target.
    {
      const an = analyserRef.current, tap = tapRef.current, d = decksRef.current?.[m.activeDeck], lv = levelRef.current[m.activeDeck];
      if (an && tap && tap.deck === m.activeDeck && d && !d.paused && d.readyState >= 3 && ctxRef.current?.state === 'running' && lv.key) {
        const dt = Math.min(0.5, Math.max(0, (nowMs - levelMeasuredAtRef.current) / 1000));
        levelMeasuredAtRef.current = nowMs;
        if (dt > 0) {
          const buf = levelBufRef.current && levelBufRef.current.length === an.fftSize ? levelBufRef.current : (levelBufRef.current = new Float32Array(an.fftSize));
          an.getFloatTimeDomainData(buf); lv.est.add(rmsDb(buf), dt);
          const lvl = lv.est.get();
          if (lvl !== null) {
            if (lv.key?.startsWith('podcast:')) podcastOutDbRef.current = outputDb(lvl, lv.applied);
            lv.target = isMusicKey(lv.key) && podcastOutDbRef.current !== null ? relativeTrim(lvl, podcastOutDbRef.current) : trimFor(lvl); if (isMusicKey(lv.key)) lv.measured = true;
            if (lv.est.heardSec >= 10 && nowMs - levelSavedAtRef.current > 10_000) { levelSavedAtRef.current = nowMs; const mem = levelMemRef.current[lv.key]; levelMemRef.current[lv.key] = typeof mem === 'number' ? 0.5 * mem + 0.5 * lvl : lvl; saveLevels(levelMemRef.current); }
          }
        }
      } else levelMeasuredAtRef.current = nowMs;
    }
    const queued = eventsRef.current.splice(0, eventsRef.current.length);
    for (const e of queued) runEngine(e, nowMs);
    runEngine(undefined, nowMs);
    setFrame((n) => n + 1);
  }, [opts.albumsFailed, params.watchdogSec, runEngine, attachMeter, ensureMeter]);

  const startInner = useCallback((): void => {
    const decks = ensureDecks();
    ensureMeter();
    void ctxRef.current?.resume().catch(() => undefined);
    const ros = rosRef.current;
    if (!ros.length) return;
    opts.onStart?.();
    // Unlock deck B inside this click (deck A is unlocked by its own real play below) so later programmatic plays are allowed (Safari/iOS need it per element).
    { const b = decks.B; b.src = SILENT_WAV; void b.play().then(() => { b.pause(); b.removeAttribute('src'); }).catch(() => undefined); }
    const probe = decks.A; probe.volume = 0.5;
    const mode = E.volumeWritable({ writable: true, target: 0.5, afterSet: probe.volume }).mode as 'crossfade' | 'hard-cut';
    const nowMs = Date.now();
    let idx = Math.max(0, Math.min(ros.length - 1, segmentIndexAt(ros, nowMs)));
    let seek: number | null = null;
    const seg0 = ros[idx];
    if (seg0.type === 'podcast') {
      const plan = E.resumePlan(seg0.startMs, nowMs, seg0.durationMs, true, params.nearEndSkipSec) as { action: string; seekToSec?: number };
      if (plan.action === 'seek' && (plan.seekToSec ?? 0) > 2) seek = plan.seekToSec ?? null;
      else if (plan.action !== 'seek') idx = Math.min(ros.length - 1, idx + 1);
    }
    if (idx !== Math.max(0, Math.min(ros.length - 1, segmentIndexAt(ros, nowMs)))) rosRef.current = E.rescheduleFrom(ros, idx, nowMs, null) as Segment[];
    const seg = rosRef.current[idx];
    const m0 = makeMachine(rosRef.current, idx, true, opts.albumsFailed, mode);
    machineRef.current = m0;
    logRef.current = [];
    metaRef.current = { A: emptyMeta(), B: emptyMeta() };
    loadSegmentOn('A', seg, params.musicSource, []);
    if (seek !== null) metaRef.current.A.pendingSeek = seek + (seg.startOffsetSec ?? 0);
    const out = E.tickOnce(m0, rosRef.current, nowMs, { type: 'START', gatePressed: true, segmentId: seg.id }) as unknown as TickOut;
    machineRef.current = out.machine; rosRef.current = out.runOfShow;
    if (seg.type === 'music') {
      const meta = metaRef.current.A;
      if (meta.kind === 'library' && meta.tracks.length) out.machine.trackLengthsMs = meta.tracks.map((t) => t.durationMs);
      const ex = E.musicExitAtMs(seg.startMs, E.paramsForSegment(seg, params), [], false, params.musicSource, out.machine.trackLengthsMs);
      out.machine.musicExitMs = ex.exitAtMs; out.machine.musicExitReason = ex.reason;
    }
    applyActions(out.actions, out.machine, out.runOfShow, nowMs);
    const a = decks.A; a.volume = clamp01(out.machine.decks.A.volume); void a.play().catch(() => { if (!corsRetriedRef.current.A) pushLog(nowMs, 'browser refused to start audio'); });
    syncAudio(out.machine);
    setStarted(true);
    if (timerRef.current === null) timerRef.current = window.setInterval(step, params.tickMs);
  }, [applyActions, ensureDecks, ensureMeter, loadSegmentOn, makeMachine, opts, params, pushLog, step, syncAudio]);

  const start = useCallback((): void => {
    setStartError(null);
    try { startInner(); } catch (err) {
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      setStartError(msg); pushLog(Date.now(), `START FAILED - ${msg}`);
      machineRef.current = null; setStarted(false);
    }
  }, [startInner, pushLog]);

  const stop = useCallback((): void => {
    if (timerRef.current !== null) { window.clearInterval(timerRef.current); timerRef.current = null; }
    const decks = decksRef.current;
    if (decks) (['A', 'B'] as DeckId[]).forEach((id) => { decks[id].pause(); decks[id].removeAttribute('src'); decks[id].load(); });
    metaRef.current = { A: emptyMeta(), B: emptyMeta() };
    if (tapRef.current) { try { tapRef.current.node.disconnect(); } catch { /* gone */ } tapRef.current = null; }
    attemptRef.current = null; setMeterState('idle'); machineRef.current = null; setStarted(false);
  }, []);

  // Keep the idle display and run of show current; never leave timers or audio behind on unmount.
  useEffect(() => { if (!machineRef.current || machineRef.current.state === 'IDLE') rosRef.current = opts.ros; }, [opts.ros]);
  useEffect(() => {
    const idle = window.setInterval(() => { if (!machineRef.current || machineRef.current.state === 'IDLE') setFrame((n) => n + 1); }, 1000);
    return () => { window.clearInterval(idle); if (tapRef.current) { try { tapRef.current.node.disconnect(); } catch { /* gone */ } tapRef.current = null; } void ctxRef.current?.close().catch(() => undefined); ctxRef.current = null; analyserRef.current = null; if (timerRef.current !== null) { window.clearInterval(timerRef.current); timerRef.current = null; } const d = decksRef.current; if (d) { d.A.pause(); d.B.pause(); d.A.removeAttribute('src'); d.B.removeAttribute('src'); } };
  }, []);

  const notifySongChange = useCallback((): void => { if (machineRef.current && machineRef.current.state !== 'IDLE') eventsRef.current.push({ type: 'SONG_CHANGE' }); }, []);
  const notifyFeedStale = useCallback((): void => { if (machineRef.current && machineRef.current.state !== 'IDLE') eventsRef.current.push({ type: 'FEED_STALE' }); }, []);

  /** A newer edition arrived: append its chain after the music block that is on air now (the current episode always finishes untouched). */
  const replaceFromNextBlock = useCallback((build: (afterMs: number) => Segment[]): boolean => {
    const m = machineRef.current; const ros = rosRef.current;
    if (!m || m.state !== 'PLAYING' || m.activeSegment?.type !== 'music') return false;
    const idx = ros.findIndex((s) => s.id === m.segmentId); if (idx < 0) return false;
    const fresh = build(ros[idx].endMs); if (!fresh.length) return false;
    rosRef.current = [...ros.slice(0, idx + 1), ...fresh].map((s, i) => ({ ...s, index: i + 1 }));
    m.nextSegment = rosRef.current[idx + 1] ?? null; m.afterNextSegment = rosRef.current[idx + 2] ?? null;
    pushLog(Date.now(), 'new edition appended after the current music block');
    return true;
  }, [pushLog]);

  const machine = machineRef.current ?? (rosRef.current.length ? makeMachine(rosRef.current, segmentIndexAt(rosRef.current, Date.now()), false, opts.albumsFailed, 'crossfade') : null);
  const activeMeta = machine ? metaRef.current[machine.activeDeck] : null;
  const blockTracks = activeMeta && activeMeta.kind === 'library' ? activeMeta.tracks : [];
  const blockTrack = blockTracks.length ? { title: blockTracks[Math.min(activeMeta?.trackIdx ?? 0, blockTracks.length - 1)].title, artist: blockTracks[Math.min(activeMeta?.trackIdx ?? 0, blockTracks.length - 1)].artist } : null;
  const activeVideo = useCallback((): HTMLMediaElement | null => { const m = machineRef.current; const d = decksRef.current; return m && d ? d[m.activeDeck] ?? null : null; }, []);
  return { startError, activeVideo, analyser: analyserRef.current, meterState, machine: machine as Machine, ros: rosRef.current, nowMs: Date.now(), logRing: logRef.current, started, blockTrack, blockTracks, start, stop, notifySongChange, notifyFeedStale, replaceFromNextBlock };
}
