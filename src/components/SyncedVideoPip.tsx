// Mini Video overlay for Parallel Audio/Video Sync. The audio element in #persistent-player stays the master:
// this muted <video> follows its play/pause/seek and is nudged back whenever it drifts. It never makes sound,
// never creates an AudioContext, and is removed when the episode changes.
import { useEffect, useRef, useState } from 'react';
import { GripHorizontal, Maximize2, PictureInPicture2, X } from 'lucide-react';
import { usePip, pipStore, clampPipPos, readPipPos, PIP_POS_KEY, type PipPos } from '../utils/avSyncPip';
import { findPersistentMedia } from '../hooks/usePersistentMedia';
import { bridgeSrc } from '../utils/mediaRoute';
import { needsDriftCorrection } from '../utils/avSync';
import { useAvSwitch } from '../hooks/useAvSync';
import type { Destination, NowPlayingMedia, PlayProgramCallback } from '../types';

const DRIFT_CHECK_MS = 500;

export function SyncedVideoPip({ nowPlaying, onPlay, onNavigate }: { nowPlaying: NowPlayingMedia | null; onPlay: PlayProgramCallback; onNavigate: (destination: Destination) => void }) {
  const pip = usePip();
  const { hardSwitch } = useAvSwitch(nowPlaying, onPlay, onNavigate);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const [pos, setPos] = useState<PipPos | null>(() => { try { return typeof localStorage === 'undefined' ? null : readPipPos(localStorage); } catch { return null; } });
  const place = (next: PipPos): void => {
    const box = boxRef.current; if (!box) return;
    const r = box.getBoundingClientRect();
    const clamped = clampPipPos(next, { w: r.width, h: r.height }, { w: window.innerWidth, h: window.innerHeight });
    setPos(clamped);
    try { localStorage.setItem(PIP_POS_KEY, JSON.stringify(clamped)); } catch { /* storage unavailable: position lasts this visit */ }
  };
  const onDragStart = (e: React.PointerEvent<HTMLDivElement>): void => {
    if ((e.target as HTMLElement).closest('button')) return;
    const r = boxRef.current?.getBoundingClientRect(); if (!r) return;
    dragRef.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onDragMove = (e: React.PointerEvent<HTMLDivElement>): void => { const d = dragRef.current; if (d) place({ x: e.clientX - d.dx, y: e.clientY - d.dy }); };
  const onDragEnd = (e: React.PointerEvent<HTMLDivElement>): void => { dragRef.current = null; try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* not captured */ } };
  const onHandleKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const step = e.shiftKey ? 48 : 16; const r = boxRef.current?.getBoundingClientRect(); if (!r) return;
    const move: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = move[e.key]; if (!m) return;
    e.preventDefault(); place({ x: r.left + m[0], y: r.top + m[1] });
  };
  useEffect(() => {
    if (!pos) return;
    const onResize = (): void => { const r = boxRef.current?.getBoundingClientRect(); if (r) setPos(clampPipPos(pos, { w: r.width, h: r.height }, { w: window.innerWidth, h: window.innerHeight })); };
    window.addEventListener('resize', onResize); return () => window.removeEventListener('resize', onResize);
  }, [pos]);
  const active = Boolean(pip && nowPlaying?.mediaType === 'audio');
  const src = pip ? bridgeSrc(pip.src) : undefined;

  useEffect(() => {
    setError(null);
    const video = videoRef.current;
    if (!active || !video) return;
    let master: HTMLMediaElement | null = null;
    let seekedToMaster = false;
    const follow = () => {
      if (!master || !Number.isFinite(master.currentTime)) return;
      if (video.readyState >= 1 && needsDriftCorrection(video.currentTime, master.currentTime)) { try { video.currentTime = master.currentTime; } catch { /* not seekable yet */ } }
    };
    const syncPlayState = () => {
      if (!master) return;
      if (master.paused) { if (!video.paused) video.pause(); } else if (video.paused && video.readyState >= 2) void video.play().catch(() => {});
    };
    const onMasterPlay = () => { follow(); syncPlayState(); };
    const onMasterPause = () => { syncPlayState(); follow(); };
    const onMasterSeek = () => follow();
    const onMetadata = () => {
      if (!master) return;
      try { video.currentTime = master.currentTime; seekedToMaster = true; } catch { /* retried by the drift check */ }
      syncPlayState();
    };
    const onCanPlay = () => syncPlayState();
    const onVideoError = () => setError('The video for this episode could not be loaded.');
    const detach = () => { for (const e of ['play', 'playing'] as const) master?.removeEventListener(e, onMasterPlay); master?.removeEventListener('pause', onMasterPause); master?.removeEventListener('seeked', onMasterSeek); master?.removeEventListener('ratechange', onMasterSeek); };
    const attach = () => {
      const next = findPersistentMedia('audio');
      const audio = next && next.tagName === 'AUDIO' ? next : null;
      if (audio === master) return;
      detach(); master = audio;
      if (master) { for (const e of ['play', 'playing'] as const) master.addEventListener(e, onMasterPlay); master.addEventListener('pause', onMasterPause); master.addEventListener('seeked', onMasterSeek); master.addEventListener('ratechange', onMasterSeek); if (video.readyState >= 1) onMetadata(); }
    };
    video.addEventListener('loadedmetadata', onMetadata);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('error', onVideoError);
    attach();
    const timer = window.setInterval(() => { attach(); follow(); syncPlayState(); if (master && video.readyState >= 1 && !seekedToMaster) onMetadata(); }, DRIFT_CHECK_MS);
    return () => { window.clearInterval(timer); detach(); video.removeEventListener('loadedmetadata', onMetadata); video.removeEventListener('canplay', onCanPlay); video.removeEventListener('error', onVideoError); };
  }, [active, src]);

  if (!active || !pip || !src) return null;
  const canNativePip = typeof document !== 'undefined' && document.pictureInPictureEnabled === true;
  return (
    <aside ref={boxRef} id="synced-video-pip" data-testid="synced-video-pip" aria-label={`Mini video: ${pip.title}`}
      style={pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined}
      className={`fixed z-50 ${pos ? '' : 'right-2 sm:right-6 bottom-[13.5rem] sm:bottom-[14.5rem] md:bottom-[10rem]'} w-56 sm:w-72 overflow-hidden rounded-xl border border-[#E06D3B]/70 bg-black shadow-2xl`}>
      <video ref={videoRef} key={src} src={src} muted playsInline preload="auto" className="block aspect-video w-full bg-black" aria-label="Synced video (sound plays from the audio player)" />
      {error && <p role="alert" className="absolute inset-x-0 top-0 bg-red-950/90 px-2 py-1 text-[11px] text-red-200">{error}</p>}
      <div data-testid="synced-video-pip-handle" role="group" tabIndex={0} aria-label="Move mini video. Drag, or use the arrow keys." title="Drag to move" onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd} onKeyDown={onHandleKey}
        style={{ touchAction: 'none' }} className="flex cursor-grab items-center justify-between gap-1 bg-neutral-900/95 px-2 py-1 active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E06D3B]">
        <span className="flex min-w-0 items-center gap-1 truncate text-[10px] font-mono uppercase tracking-wider text-neutral-300"><GripHorizontal className="h-3.5 w-3.5 shrink-0 text-[#E06D3B]" aria-hidden="true" />Video · drag to move</span>
        <span className="flex items-center gap-1">
          {canNativePip && <button type="button" aria-label="Pop video out of the page" title="Pop out" className="rounded p-1 text-neutral-300 hover:bg-neutral-800" onClick={() => { void videoRef.current?.requestPictureInPicture().catch(() => {}); }}><PictureInPicture2 className="h-3.5 w-3.5" /></button>}
          <button type="button" aria-label="Switch main player to video" title="Make video the main player" className="rounded p-1 text-neutral-300 hover:bg-neutral-800" onClick={hardSwitch}><Maximize2 className="h-3.5 w-3.5" /></button>
          <button type="button" aria-label="Close mini video" title="Close" className="rounded p-1 text-neutral-300 hover:bg-neutral-800" onClick={() => pipStore.close()}><X className="h-3.5 w-3.5" /></button>
        </span>
      </div>
    </aside>
  );
}
