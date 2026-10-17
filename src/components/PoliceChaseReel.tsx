import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { loadSchedule } from '../guide/loadSchedule';
import { clipsFromChannels, pickPlaying, previewStart, scrollStep, shuffled, PREVIEW_SECONDS, POLICE_CHASE_CHANNEL_ID, type ReelClip } from '../guide/policeChase';
import type { PlayProgramCallback } from '../types';

const GUIDE = 'cable-tv';
const SCROLL_PX_PER_FRAME = 0.35; // about 20 px/s at 60 fps
const mmss = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);

/** One card: still thumbnail, plus a muted looping preview (random point, PREVIEW_SECONDS long, then another random point) while `playing`. */
function ReelCard({ clip, playing, onVisible, onPlay, onHover }: { clip: ReelClip; playing: boolean; onVisible: (key: string, v: boolean) => void; onPlay: (c: ReelClip) => void; onHover: (key: string | null) => void }) {
  const box = useRef<HTMLButtonElement>(null);
  const vid = useRef<HTMLVideoElement>(null);
  const [live, setLive] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === 'undefined') { onVisible(clip.key, true); return; }
    const io = new IntersectionObserver((es) => es.forEach((e) => onVisible(clip.key, e.isIntersecting && e.intersectionRatio >= 0.5)), { threshold: [0, 0.5, 1] });
    io.observe(el);
    return () => { io.disconnect(); onVisible(clip.key, false); };
  }, [clip.key, onVisible]);

  useEffect(() => {
    const v = vid.current;
    if (!v) return;
    if (!playing || failed) { v.pause(); if (v.getAttribute('src')) { v.removeAttribute('src'); v.load(); } setLive(false); return; }
    let cut = 0;
    const jump = () => { cut = previewStart(clip.seconds); try { v.currentTime = cut; } catch { /* metadata not ready yet */ } };
    const onMeta = () => { jump(); v.play().then(() => setLive(true)).catch(() => setFailed(true)); };
    const onTime = () => { if (v.currentTime >= cut + PREVIEW_SECONDS) jump(); };
    const onEnd = () => jump();
    const onErr = () => { setFailed(true); setLive(false); };
    v.addEventListener('loadedmetadata', onMeta); v.addEventListener('timeupdate', onTime); v.addEventListener('ended', onEnd); v.addEventListener('error', onErr);
    v.muted = true; v.src = clip.url; v.load();
    return () => { v.removeEventListener('loadedmetadata', onMeta); v.removeEventListener('timeupdate', onTime); v.removeEventListener('ended', onEnd); v.removeEventListener('error', onErr); v.pause(); };
  }, [playing, failed, clip.url, clip.seconds]);

  return (
    <button ref={box} type="button" data-testid="reel-card" data-clip={clip.key} data-playing={playing && live ? 'true' : 'false'}
      onClick={() => onPlay(clip)} onPointerEnter={() => onHover(clip.key)} onPointerLeave={() => onHover(null)} onFocus={() => onHover(clip.key)} onBlur={() => onHover(null)}
      aria-label={`Play ${clip.title}, ${mmss(clip.seconds)}`}
      className="group relative h-[140px] w-[200px] shrink-0 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/80 text-left transition duration-150 hover:scale-[1.02] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 sm:w-[240px]">
      {clip.thumb && <img src={clip.thumb} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" />}
      <video ref={vid} muted playsInline preload="none" aria-hidden="true" tabIndex={-1} className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${playing && live ? 'opacity-100' : 'opacity-0'}`} />
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-2.5 pt-8">
        <span className="block truncate text-[13px] font-medium text-neutral-100">{clip.title}</span>
        <span className="block truncate text-[11px] text-neutral-400">FOX Clips · {mmss(clip.seconds)}{clip.uploaded ? ` · ${clip.uploaded}` : ''}</span>
      </span>
    </button>
  );
}

interface Props { onPlayProgram: PlayProgramCallback; /** The Home row supplies the visible (collapsible) heading; this one stays for screen readers. */ hideHeading?: boolean }

/** Home row 4: random Police Chase previews (muted, looping, GIF-style) in a slowly scrolling strip. Click plays the whole clip. */
export function PoliceChaseReel({ onPlayProgram, hideHeading = false }: Props) {
  const [clips, setClips] = useState<ReelClip[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState<ReadonlySet<string>>(new Set());
  const [hover, setHover] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const [tabHidden, setTabHidden] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    loadSchedule(GUIDE).then((chs) => { if (alive) setClips(shuffled(clipsFromChannels(chs))); }).catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'schedule unavailable'); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(!!mq?.matches);
    mq?.addEventListener?.('change', on);
    const vis = () => setTabHidden(document.hidden);
    document.addEventListener('visibilitychange', vis);
    return () => { mq?.removeEventListener?.('change', on); document.removeEventListener('visibilitychange', vis); };
  }, []);

  const order = useMemo(() => (clips ?? []).map((c) => c.key), [clips]);
  const onVisible = useCallback((key: string, v: boolean) => setVisible((prev) => { if (prev.has(key) === v) return prev; const n = new Set(prev); if (v) n.add(key); else n.delete(key); return n; }), []);
  const still = paused || reduced || tabHidden;
  // Reduced motion / paused / hidden tab: nothing plays by itself; with reduced motion only the hovered or focused card previews.
  const playing = useMemo(() => (tabHidden || paused ? new Set<string>() : reduced ? new Set(hover ? [hover] : []) : pickPlaying(visible, order)), [visible, order, hover, paused, reduced, tabHidden]);

  // Slow ping-pong auto-scroll; stops while paused, hovered/focused, hidden, or reduced motion.
  useEffect(() => {
    const el = scroller.current;
    if (!el || still || hover) return;
    let raf = 0; let dir: 1 | -1 = 1; let pos = el.scrollLeft;
    const tick = () => {
      const max = el.scrollWidth - el.clientWidth;
      if (Math.abs(el.scrollLeft - pos) > 2) pos = el.scrollLeft; // the viewer scrolled by hand: continue from there
      const s = scrollStep(pos, dir, max, SCROLL_PX_PER_FRAME);
      pos = s.pos; dir = s.dir; el.scrollLeft = pos;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [still, hover, clips]);

  const play = useCallback((c: ReelClip) => {
    const p = c.program;
    onPlayProgram(c.url, c.title, 'FOX Clips · Police Chase', 'video', POLICE_CHASE_CHANNEL_ID, p.guideId ?? GUIDE, p.id, p.sourceId ?? p.metadata?.sourceId, p.assetId ?? p.metadata?.assetId, 0);
  }, [onPlayProgram]);

  if (error) return <section aria-label="Police Chase" className="px-4 text-xs text-neutral-500" data-testid="reel-error">Police Chase previews unavailable: {error}</section>;
  if (!clips || clips.length === 0) return null; // not loaded yet, or the channel is not in the guide

  return (
    <section aria-labelledby="police-chase-heading" data-testid="police-chase-reel" className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 px-4">
        <h2 id="police-chase-heading" className={hideHeading ? 'sr-only' : 'text-sm font-semibold tracking-tight text-neutral-100'}>Police Chase <span className="font-normal text-neutral-500">· random previews, muted · viewer discretion</span></h2>
        <button type="button" onClick={() => setPaused((p) => !p)} aria-pressed={paused}
          className="inline-flex items-center gap-1.5 rounded text-xs text-neutral-400 hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
          {paused ? <Play className="h-3.5 w-3.5" aria-hidden="true" /> : <Pause className="h-3.5 w-3.5" aria-hidden="true" />}{paused ? 'Resume motion' : 'Pause motion'}
        </button>
      </div>
      <div ref={scroller} data-testid="reel-scroller" className="flex gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:thin]">
        {clips.map((c) => <ReelCard key={c.key} clip={c} playing={playing.has(c.key)} onVisible={onVisible} onPlay={play} onHover={setHover} />)}
      </div>
    </section>
  );
}
