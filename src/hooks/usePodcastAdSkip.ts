/* Ad-break prompt + ad-seconds readout for podcast playback. One shared session per episode (module level) so the full player
 * and the bottom dock never disagree and a skip is recorded once. Reads time/duration straight from the media element.
 * Stage A/B: it only ASKS; it never skips on its own. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { skipMedia, isPodcastItem } from '../utils/podcastSkip';
import { applyLocks } from '../utils/captionSync';
import { locksOf } from '../utils/captionLocks';
import {
  BurstTracker, adBudget, addEvent, canAccept, chipFromLearned, chipFromPods, coveredKeys, estimatePods, learnedWindows, loadMemory, markSeen, saveMemory,
  type AdMap, type Budget, type ChipState, type ShowMemory,
} from '../utils/podcastAdSkip';

export interface AdSkipSource { url: string; showKey: string; episodeId: string; canMap: boolean }
export type MapState = 'loading' | 'map' | 'no-map' | 'error';
export interface AdSkipView { budget: Budget; chip: ChipState | null; mapState: MapState; mode: 'ask' | 'off' }

/** Which now-playing items get the prompt: on-demand podcast episodes. Only feed channels (pod-*) have an enclosure the server can read a map from. */
export function adSkipSourceOf(np: { src?: string; channelId?: string | null; programId?: string | null; isLive?: boolean } | null | undefined): AdSkipSource | null {
  if (!np || !isPodcastItem({ channelId: np.channelId, isLive: np.isLive, programId: np.programId })) return null;
  const channelId = String(np.channelId ?? '');
  const url = String(np.src ?? '');
  return { url, showKey: channelId, episodeId: String(np.programId ?? url), canMap: channelId.startsWith('pod-') && /^https:\/\//.test(url) };
}

export type MapResult = { kind: 'ok'; feedSeconds: number | null; adMap: AdMap | null } | { kind: 'none' } | { kind: 'error'; message: string };
const mapCache = new Map<string, Promise<MapResult>>();
export function fetchMap(url: string): Promise<MapResult> {
  let p = mapCache.get(url);
  if (!p) {
    p = (async (): Promise<MapResult> => {
      try {
        const r = await fetch(`/api/podcast/ad-map?url=${encodeURIComponent(url)}`);
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json() as { feedSeconds?: unknown; adMap?: AdMap | null };
        return { kind: 'ok', feedSeconds: typeof j.feedSeconds === 'number' ? j.feedSeconds : null, adMap: j.adMap && Array.isArray(j.adMap.pods) ? j.adMap : null };
      } catch (e: any) { mapCache.delete(url); return { kind: 'error', message: String(e?.message ?? e) }; }
    })();
    mapCache.set(url, p);
    if (mapCache.size > 60) mapCache.delete(mapCache.keys().next().value as string);
  }
  return p;
}

interface Session { tracker: BurstTracker; handled: Set<string> }
const sessions = new Map<string, Session>();
const memories = new Map<string, ShowMemory>();
const store = () => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };
function sessionOf(ep: string): Session {
  let s = sessions.get(ep);
  if (!s) { s = { tracker: new BurstTracker(), handled: new Set() }; sessions.set(ep, s); if (sessions.size > 20) sessions.delete(sessions.keys().next().value as string); }
  return s;
}
function memoryOf(show: string): ShowMemory { let m = memories.get(show); if (!m) { m = loadMemory(show, store()); memories.set(show, m); } return m; }
function putMemory(show: string, m: ShowMemory) { memories.set(show, m); saveMemory(show, m, store()); }

const INITIAL: AdSkipView = { budget: { state: 'unknown', why: 'not-loaded' }, chip: null, mapState: 'loading', mode: 'ask' };

export function usePodcastAdSkip(getMedia: () => HTMLMediaElement | null, source: AdSkipSource | null) {
  const [view, setView] = useState<AdSkipView>(INITIAL);
  const mapRef = useRef<MapResult | 'loading'>('loading');
  const getRef = useRef(getMedia); getRef.current = getMedia;
  const key = source ? `${source.showKey}|${source.episodeId}|${source.url}` : '';

  const compute = useCallback(() => {
    const media = getRef.current();
    if (!source || !media) return;
    const res = mapRef.current;
    const file = media.duration; const head = media.currentTime;
    const adMap = res !== 'loading' && res.kind === 'ok' ? res.adMap : null;
    const feed = res !== 'loading' && res.kind === 'ok' ? res.feedSeconds : null;
    const budget = adBudget(file, adMap?.cleanSeconds ?? feed);
    const sess = sessionOf(source.episodeId);
    let mem = memoryOf(source.showKey);
    const est0 = budget.state === 'ads' && adMap ? estimatePods(adMap.pods, budget.seconds, budget.cleanSeconds) : [];
    // edges measured by the captions' lock-on (or by the listener aligning a line) replace the estimates; no lock = unchanged
    const est = budget.state === 'ads' ? applyLocks(est0, locksOf(source.episodeId), budget.cleanSeconds) : est0;
    // finished skips -> memory (skipped while the prompt is off = not recorded)
    const bursts = sess.tracker.take(Date.now());
    if (bursts.length && Number.isFinite(file) && file > 1) {
      for (const b of bursts) {
        const wins = learnedWindows(mem);
        for (const k of coveredKeys(b, est, wins, file)) sess.handled.add(k);
        if (mem.mode === 'ask') mem = addEvent(mem, { at: b.at, len: b.len, remaining: Math.max(0, file - b.at), ep: source.episodeId, when: Date.now() });
      }
      putMemory(source.showKey, mem);
    }
    if (Number.isFinite(file) && file > 1 && !mem.seen.includes(source.episodeId)) { mem = markSeen(mem, source.episodeId); putMemory(source.showKey, mem); }
    let chip: ChipState | null = null;
    if (mem.mode === 'ask' && Number.isFinite(file) && file > 1) {
      chip = chipFromPods(est, head, file, sess.handled) ?? chipFromLearned(learnedWindows(mem), head, file, sess.handled);
    }
    const mapState: MapState = res === 'loading' ? 'loading' : res.kind === 'error' ? 'error' : adMap ? 'map' : 'no-map';
    const next: AdSkipView = { budget, chip, mapState, mode: mem.mode };
    setView((cur) => (JSON.stringify(cur) === JSON.stringify(next) ? cur : next));
  }, [source?.episodeId, source?.showKey, source?.url]);

  useEffect(() => {
    setView(INITIAL);
    mapRef.current = 'loading';
    if (!source) return;
    let alive = true;
    if (source.canMap) fetchMap(source.url).then((r) => { if (alive) { mapRef.current = r; compute(); } });
    else mapRef.current = { kind: 'none' };
    const t = window.setInterval(compute, 500);
    compute();
    return () => { alive = false; window.clearInterval(t); };
  }, [key, compute]);

  /** Call after every listener skip (buttons, chip) with where it started and where it landed. */
  const noteSeek = useCallback((from: number, to: number) => { if (source) sessionOf(source.episodeId).tracker.seek(from, to, Date.now()); }, [source?.episodeId]);

  const accept = useCallback(() => {
    const media = getRef.current(); const chip = view.chip;
    if (!source || !media || !chip || !canAccept(chip)) return;
    const from = media.currentTime;
    const target = skipMedia(media, chip.skipTo - from);
    if (target !== null) {
      sessionOf(source.episodeId).tracker.seek(from, target, Date.now());
      sessionOf(source.episodeId).handled.add(chip.key);
      putMemory(source.showKey, { ...memoryOf(source.showKey), accepted: memoryOf(source.showKey).accepted + 1 });
    }
    compute();
  }, [view.chip, source?.episodeId, source?.showKey, compute]);

  const dismiss = useCallback(() => {
    if (!source || !view.chip) return;
    sessionOf(source.episodeId).handled.add(view.chip.key);
    putMemory(source.showKey, { ...memoryOf(source.showKey), dismissed: memoryOf(source.showKey).dismissed + 1 });
    compute();
  }, [view.chip, source?.episodeId, source?.showKey, compute]);

  const setMode = useCallback((mode: 'ask' | 'off') => { if (!source) return; putMemory(source.showKey, { ...memoryOf(source.showKey), mode }); compute(); }, [source?.showKey, compute]);

  return { view, noteSeek, accept, dismiss, setMode, active: source !== null };
}
