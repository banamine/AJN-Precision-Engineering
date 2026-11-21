/* Live captions for a podcast episode. One transcript fetch per episode, the ad map from the shared ad-skip cache, and a status that
 * says exactly how well the captions are tied to the audio:
 *   in-sync  the file has no stitched-in ads (offset 0)
 *   locked   Part 2 matched the transcript's pauses to real silences in the audio (needs the signal meter)
 *   manual   the listener tapped the line they were hearing
 *   approx   only the ad-map estimate (can be off by up to about a minute after a long break)
 * Reads time straight from the audio element. Nothing here plays, skips or seeks unless the listener taps. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { adBudget, estimatePods, fmtMS, type AdMap } from '../utils/podcastAdSkip';
import { type Cue, transcriptPauses } from '../utils/transcriptParse';
import {
  SilenceTracker, buildTimeline, cueIndexAt, locate, lockOn, offsetsOf, segFrom, segTo, showToFile, sponsorWindows,
  type SyncState, type Where,
} from '../utils/captionSync';
import { locksOf, lockSourceOf, setLock } from '../utils/captionLocks';
import { fetchMap, type AdSkipSource, type MapResult } from './usePodcastAdSkip';

interface TranscriptPayload { available: boolean; reason?: string; cues: Cue[]; hasSpeakers: boolean; endsAt: number | null; feedSeconds: number | null }
type TrResult = { kind: 'ok'; data: TranscriptPayload } | { kind: 'error'; message: string };
const trCache = new Map<string, Promise<TrResult>>();
function fetchTranscript(url: string): Promise<TrResult> {
  let p = trCache.get(url);
  if (!p) {
    p = (async (): Promise<TrResult> => {
      try {
        const r = await fetch(`/api/podcast/transcript?url=${encodeURIComponent(url)}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json() as TranscriptPayload;
        return { kind: 'ok', data: { ...j, cues: Array.isArray(j.cues) ? j.cues : [] } };
      } catch (e: any) { trCache.delete(url); return { kind: 'error', message: String(e?.message ?? e) }; }
    })();
    trCache.set(url, p);
    if (trCache.size > 20) trCache.delete(trCache.keys().next().value as string);
  }
  return p;
}

/** The highlight moves a moment before the voice reaches a line, so the eye is on it as it is spoken (transcript times mark where a line starts). */
const READ_LEAD = 0.5;
const LOCK_KEY = 'ajn-captions-autosync';
const readSwitch = (): boolean => { try { return localStorage.getItem(LOCK_KEY) !== 'off'; } catch { return true; } };

export interface SponsorChip { key: string; inside: boolean; startsIn: number; skipTo: number; skipSeconds: number }
export interface CaptionView {
  state: SyncState;
  cues: readonly Cue[];
  hasSpeakers: boolean;
  /** index of the current line (or the last one before an ad break); -1 before the first */
  index: number;
  /** while inside an ad break: seconds left (estimated) */
  ad: { left: number; estimated: boolean } | null;
  sponsor: SponsorChip | null;
  autoSync: boolean;
  meter: boolean;
}
const EMPTY: CaptionView = { state: 'loading', cues: [], hasSpeakers: false, index: -1, ad: null, sponsor: null, autoSync: true, meter: false };

export function usePodcastCaptions(getMedia: () => HTMLMediaElement | null, source: AdSkipSource | null, analyser: AnalyserNode | null, meter: boolean) {
  const [view, setView] = useState<CaptionView>(EMPTY);
  const [autoSync, setAutoSync] = useState<boolean>(readSwitch);
  const trRef = useRef<TrResult | 'loading'>('loading');
  const mapRef = useRef<MapResult | 'loading'>('loading');
  const getRef = useRef(getMedia); getRef.current = getMedia;
  const tracker = useRef(new SilenceTracker());
  const dismissed = useRef(new Set<string>());
  const ctx = useRef<{ tl: ReturnType<typeof buildTimeline> | null; o: number[]; cues: readonly Cue[] }>({ tl: null, o: [0], cues: [] });
  const key = source ? `${source.showKey}|${source.episodeId}|${source.url}` : '';
  const ep = source?.episodeId ?? '';

  const compute = useCallback(() => {
    const media = getRef.current();
    const tr = trRef.current; const map = mapRef.current;
    if (!source || !media) return;
    if (tr === 'loading') { setView((c) => (c.state === 'loading' && !c.cues.length ? c : { ...EMPTY, autoSync, meter })); return; }
    if (tr.kind === 'error') { setView({ ...EMPTY, state: /HTTP 404/.test(tr.message) ? 'not-listed' : 'error', autoSync, meter }); return; }
    const data = tr.data;
    if (!data.available || !data.cues.length) { setView({ ...EMPTY, state: 'no-transcript', autoSync, meter }); return; }
    const cues = data.cues;
    const t = media.currentTime; const dur = media.duration;
    const adMap: AdMap | null = map !== 'loading' && map.kind === 'ok' ? map.adMap : null;
    const feed = map !== 'loading' && map.kind === 'ok' ? map.feedSeconds : null;
    const clean = adMap?.cleanSeconds ?? feed ?? data.feedSeconds ?? data.endsAt;
    const budget = adBudget(dur, clean);
    const base = { cues, hasSpeakers: data.hasSpeakers, autoSync, meter };
    if (budget.state === 'unknown') {
      setView({ ...EMPTY, ...base, state: budget.why === 'not-loaded' ? 'loading' : 'no-map' });
      return;
    }
    let state: SyncState; let where: Where; let tl: ReturnType<typeof buildTimeline>; let o: number[];
    if (budget.state === 'none') {
      tl = buildTimeline([], budget.cleanSeconds); o = [0]; state = 'in-sync';
      where = { kind: 'show', show: t, seg: 0 };
    } else if (!adMap) {
      if (map === 'loading') { setView({ ...EMPTY, ...base, state: 'loading' }); return; }
      // No ad map for this episode (not a Triton/iHeart file) but the file is longer than the show, so ads are stitched in at unknown places.
      // Follow the transcript from the start of the file as one stretch; each tap on the line you hear re-aligns it (a break after that point
      // shifts it again). Never presented as exact, and no sponsor skipping from it.
      tl = buildTimeline([], budget.cleanSeconds);
      o = offsetsOf(tl, locksOf(ep));
      where = { kind: 'show', show: Math.max(0, t - o[0]), seg: 0 };
      state = lockSourceOf(ep, 0) === 'manual' ? 'manual' : 'unmapped';
    } else {
      const est = estimatePods(adMap.pods, budget.seconds, budget.cleanSeconds);
      tl = buildTimeline(est, budget.cleanSeconds);
      o = offsetsOf(tl, locksOf(ep));
      where = locate(t, tl, o);
      const seg = where.kind === 'show' ? where.seg : -1;
      const src = seg >= 0 ? lockSourceOf(ep, seg) : null;
      state = src === 'auto' ? 'locked' : src === 'manual' ? 'manual' : 'approx';
      if (where.kind === 'ad') {
        // inside a break: the segment after it decides how exact the end is
        const after = lockSourceOf(ep, where.pod + 1);
        state = after === 'auto' ? 'locked' : after === 'manual' ? 'manual' : 'approx';
      }
    }
    ctx.current = { tl, o, cues };
    const index = where.kind === 'show' ? cueIndexAt(cues, where.show + READ_LEAD) : cueIndexAt(cues, tl.bounds[where.pod] ?? 0);
    const ad = where.kind === 'ad' ? { left: Math.max(0, where.length - where.into), estimated: state === 'approx' } : null;

    // sponsor-read prompt: only when the sync is trustworthy, and it only asks
    let sponsor: SponsorChip | null = null;
    if (adMap && where.kind === 'show' && (state === 'locked' || state === 'manual' || state === 'in-sync')) {
      for (const w of sponsorWindows(cues)) {
        const k = `sp:${Math.round(w.s)}`;
        if (dismissed.current.has(k)) continue;
        if (where.show >= w.s - 20 && where.show < w.e - 3) {
          const skipTo = Math.min(showToFile(w.e, tl, o), dur - 0.5);
          if (skipTo - t < 5) continue;
          sponsor = { key: k, inside: where.show >= w.s, startsIn: w.s - where.show, skipTo, skipSeconds: skipTo - t };
          break;
        }
      }
    }
    const next: CaptionView = { state, cues, hasSpeakers: data.hasSpeakers, index, ad, sponsor, autoSync, meter };
    setView((c) => (c.state === next.state && c.cues === next.cues && c.index === next.index && c.autoSync === next.autoSync && c.meter === next.meter
      && JSON.stringify(c.ad) === JSON.stringify(next.ad) && JSON.stringify(c.sponsor) === JSON.stringify(next.sponsor) ? c : next));
  }, [source?.episodeId, source?.url, ep, autoSync, meter]);

  // fetches + the 250 ms tick
  useEffect(() => {
    setView({ ...EMPTY, autoSync, meter });
    trRef.current = 'loading'; mapRef.current = 'loading'; dismissed.current = new Set(); tracker.current.reset();
    if (!source) return;
    let alive = true;
    let tries = 0; let retry: number | undefined;
    const load = () => {
      fetchTranscript(source.url).then((r) => { if (alive) { trRef.current = r; compute(); } });
      if (source.canMap) fetchMap(source.url).then((r) => { if (alive) { mapRef.current = r; compute(); } });
    };
    // a failed lookup (e.g. the server has just restarted and has not listed the feeds yet) is retried, not shown as "no transcript"
    const again = () => {
      const bad = (x: unknown) => typeof x === 'object' && x !== null && (x as { kind?: string }).kind === 'error';
      if (alive && tries < 6 && (bad(trRef.current) || bad(mapRef.current))) { tries += 1; load(); }
      if (alive && tries < 6) retry = window.setTimeout(again, 10_000 * tries + 5_000);
    };
    load();
    if (!source.canMap) mapRef.current = { kind: 'none' };
    retry = window.setTimeout(again, 5_000);
    const t = window.setInterval(compute, 250);
    compute();
    return () => { alive = false; window.clearInterval(t); if (retry) window.clearTimeout(retry); };
  }, [key, compute]);

  // Part 2, listening: level readings -> silences. Paused while the tab is hidden (browsers slow timers there) or the audio is not playing.
  const wantListen = Boolean(analyser) && meter && autoSync;
  useEffect(() => {
    if (!source || !wantListen || !analyser) return;
    const buf = new Float32Array(analyser.fftSize);
    const timer = window.setInterval(() => {
      const media = getRef.current();
      if (!media || media.paused || media.seeking || document.hidden) { if (document.hidden || media?.paused) tracker.current.reset(); return; }
      analyser.getFloatTimeDomainData(buf);
      let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      tracker.current.feed(rms > 0 ? 20 * Math.log10(rms) : -120, media.currentTime);
    }, 100);
    return () => window.clearInterval(timer);
  }, [key, wantListen, analyser]);

  // Part 2, matching: try every 4 s while the current segment has no lock
  useEffect(() => {
    if (!source || !wantListen) return;
    const timer = window.setInterval(() => {
      const media = getRef.current(); const c = ctx.current;
      const tr = trRef.current;
      if (!media || !c.tl || tr === 'loading' || tr.kind !== 'ok' || document.hidden) return;
      const w = locate(media.currentTime, c.tl, c.o);
      if (w.kind !== 'show') return;
      if (lockSourceOf(ep, w.seg) === 'auto') return;
      const since = tracker.current.since; if (since === null) return;
      const lk = new Map(locksOf(ep)); lk.delete(w.seg);
      const center = offsetsOf(c.tl, lk)[w.seg];
      const res = lockOn(tracker.current.list.map((s) => s.mid), transcriptPauses(c.cues), center, 100, { from: since, to: media.currentTime }, { from: segFrom(c.tl, w.seg), to: segTo(c.tl, w.seg) });
      if (res) setLock(ep, w.seg, res.offset, 'auto');
    }, 4000);
    return () => window.clearInterval(timer);
  }, [key, wantListen]);

  /** The listener says: the line I am hearing right now is this one. Good to within a couple of seconds. */
  const alignTo = useCallback((i: number) => {
    const media = getRef.current(); const c = ctx.current; const cue = c.cues[i];
    if (!media || !c.tl || !cue) return;
    const w = locate(media.currentTime, c.tl, c.o);
    if (w.kind !== 'show') return;
    const heardAt = cue.s + Math.min(2, (cue.e - cue.s) / 2);
    if (lockSourceOf(ep, w.seg) !== 'auto') setLock(ep, w.seg, media.currentTime - heardAt, 'manual');
    compute();
  }, [ep, compute]);
  /** Tap-to-jump: play from this line. */
  const jumpTo = useCallback((i: number) => {
    const media = getRef.current(); const c = ctx.current; const cue = c.cues[i];
    if (!media || !c.tl || !cue) return;
    const target = showToFile(cue.s, c.tl, c.o);
    if (Number.isFinite(target) && target >= 0 && target < (media.duration || Infinity)) media.currentTime = target;
    compute();
  }, [compute]);
  const acceptSponsor = useCallback(() => {
    const media = getRef.current(); const chip = view.sponsor;
    if (!media || !chip) return;
    dismissed.current.add(chip.key); media.currentTime = chip.skipTo; compute();
  }, [view.sponsor, compute]);
  const dismissSponsor = useCallback(() => { if (view.sponsor) { dismissed.current.add(view.sponsor.key); compute(); } }, [view.sponsor, compute]);
  const setAuto = useCallback((on: boolean) => { try { localStorage.setItem(LOCK_KEY, on ? 'on' : 'off'); } catch { /* private mode */ } setAutoSync(on); if (!on) tracker.current.reset(); }, []);

  return useMemo(() => ({ view, alignTo, jumpTo, acceptSponsor, dismissSponsor, setAutoSync: setAuto, active: source !== null }), [view, alignTo, jumpTo, acceptSponsor, dismissSponsor, setAuto, source !== null]);
}

export const adLeftText = (left: number) => `about ${fmtMS(left)} left`;
