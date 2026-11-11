import React, { useEffect, useRef, useState } from 'react';
import type { NowPlayingMedia } from '../types';

export type AudioSourceType = 'radio' | 'music' | 'podcasts' | 'listenback';

export interface SourcePrism3DProps {
  activeSource: AudioSourceType;
  onSelectSource: (source: AudioSourceType) => void;
  nowPlaying?: NowPlayingMedia | null;
  onPlayStation?: (channelId: string) => void;
}

const SOURCE_ORDER: AudioSourceType[] = ['radio', 'music', 'podcasts', 'listenback'];
const FACES = SOURCE_ORDER.length;
const STEP_DEG = 360 / FACES;
const SOURCE_INDEX: Record<AudioSourceType, number> = { radio: 0, music: 1, podcasts: 2, listenback: 3 };
const MODE_TEST_ID: Record<AudioSourceType, string> = {
  radio: 'radio-mode-live',
  music: 'radio-mode-archive',
  podcasts: 'radio-mode-podcasts',
  listenback: 'radio-mode-listenback',
};

export const FACTORY_RADIO_PRESETS = [
  { presetNumber: '01', channelId: 'radio:ajn-alex-jones-show', name: 'AJN Alex Jones' },
  { presetNumber: '02', channelId: 'radio:infowars-live-aac', name: 'Infowars Live AAC' },
  { presetNumber: '03', channelId: 'radio:ch109-original', name: 'Channel 109 Original' },
  { presetNumber: '04', channelId: 'radio:ch109-classic-rock', name: '109 Classic Rock' },
  { presetNumber: '05', channelId: 'radio:ch109-warm-109', name: '109 Warm' },
];

export const SourcePrism3D: React.FC<SourcePrism3DProps> = ({
  activeSource,
  onSelectSource,
  nowPlaying,
  onPlayStation,
}) => {
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const [prismWidth, setPrismWidth] = useState<number>(320);
  const [baseAngle, setBaseAngle] = useState<number>(-SOURCE_INDEX[activeSource] * STEP_DEG);
  const [dragDeltaX, setDragDeltaX] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartXRef = useRef<number | null>(null);

  useEffect(() => {
    const targetIdx = SOURCE_INDEX[activeSource];
    setBaseAngle((prev) => {
      const cur = (((-Math.round(prev / STEP_DEG)) % FACES) + FACES) % FACES;
      if (cur === targetIdx) return prev;
      let diff = targetIdx - cur;
      if (diff > FACES / 2) diff -= FACES;
      if (diff < -FACES / 2) diff += FACES;
      return prev - diff * STEP_DEG;
    });
  }, [activeSource]);

  useEffect(() => {
    const el = sceneRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => el.clientWidth > 0 && setPrismWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const apothemPx = Math.round((prismWidth / (2 * Math.tan(Math.PI / FACES))) * 10) / 10;
  const activeIdx = SOURCE_INDEX[activeSource];

  const selectByIndex = (targetIdx: number) => {
    const norm = ((targetIdx % FACES) + FACES) % FACES;
    let diff = norm - activeIdx;
    if (diff > FACES / 2) diff -= FACES;
    if (diff < -FACES / 2) diff += FACES;
    setBaseAngle((prev) => prev - diff * STEP_DEG);
    onSelectSource(SOURCE_ORDER[norm]);
  };

  const step = (dir: 1 | -1) => {
    const next = (activeIdx + dir + FACES) % FACES;
    setBaseAngle((prev) => prev - dir * STEP_DEG);
    onSelectSource(SOURCE_ORDER[next]);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement)?.closest('button, a, input')) return;
    dragStartXRef.current = e.clientX;
    setIsDragging(true);
    setDragDeltaX(0);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || dragStartXRef.current === null) return;
    setDragDeltaX(e.clientX - dragStartXRef.current);
  };

  const finishDrag = () => {
    if (!isDragging) return;
    const delta = dragDeltaX;
    setIsDragging(false);
    setDragDeltaX(0);
    dragStartXRef.current = null;
    if (delta < -40) step(1);
    else if (delta > 40) step(-1);
  };

  const displayAngle = baseAngle + (isDragging ? dragDeltaX * 0.35 : 0);
  const isLiveRadio = Boolean(nowPlaying && String(nowPlaying.channelId ?? '').startsWith('radio:'));

  return (
    <section aria-label="Audio Source Prism" data-testid="source-prism-3d" className="w-full select-none mb-4">
      {/* Tab Controls */}
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <div role="tablist" aria-label="Radio source" className="flex items-center gap-1.5 flex-wrap">
          {SOURCE_ORDER.map((src, i) => (
            <button
              key={src}
              type="button"
              role="tab"
              data-testid={MODE_TEST_ID[src]}
              aria-selected={activeSource === src}
              aria-pressed={activeSource === src}
              onClick={() => selectByIndex(i)}
              style={{ minHeight: '48px', minWidth: '48px' }}
              className={`h-12 !min-h-[48px] !min-w-[48px] px-3 py-1.5 rounded-lg text-xs font-bold uppercase transition-all ${
                activeSource === src
                  ? 'bg-[#E06D3B] text-black'
                  : 'bg-[#181B24] text-slate-300 border border-white/10 hover:text-white'
              }`}
            >
              {i + 1}. {src === 'radio' ? 'LIVE RADIO' : src === 'music' ? 'ARCHIVE MUSIC' : src === 'podcasts' ? 'PODCASTS' : 'LISTEN BACK'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            data-testid="source-prism-prev"
            aria-label="Previous source"
            onClick={() => step(-1)}
            style={{ minWidth: '48px', minHeight: '48px' }}
            className="w-12 h-12 !min-h-[48px] !min-w-[48px] rounded-lg bg-[#181B24] border border-white/15 text-[#E06D3B] flex items-center justify-center"
          >
            ‹
          </button>
          <button
            type="button"
            data-testid="source-prism-next"
            aria-label="Next source"
            onClick={() => step(1)}
            style={{ minWidth: '48px', minHeight: '48px' }}
            className="w-12 h-12 !min-h-[48px] !min-w-[48px] rounded-lg bg-[#181B24] border border-white/15 text-[#E06D3B] flex items-center justify-center"
          >
            ›
          </button>
        </div>
      </div>

      {/* 3D Scene Viewport */}
      <div
        ref={sceneRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerLeave={finishDrag}
        className="w-full h-[340px] lg:h-[260px] overflow-hidden rounded-2xl relative touch-pan-y"
        style={{ perspective: '900px' }}
      >
        <div
          data-testid="source-prism-cylinder"
          className="w-full h-[340px] lg:h-[260px] relative"
          style={{
            transformStyle: 'preserve-3d',
            transition: isDragging ? 'none' : 'transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
            transform: `translateZ(-${apothemPx}px) rotateY(${displayAngle}deg)`,
          }}
        >
          {/* Facet 0: Live Radio */}
          <div
            role="tabpanel"
            aria-hidden={activeSource !== 'radio'}
            className={`absolute inset-0 w-full h-full rounded-2xl p-3 sm:p-4 flex flex-col justify-between overflow-hidden border border-[#E06D3B]/45 bg-[#181B24]/95 ${
              activeSource === 'radio' ? 'pointer-events-auto' : 'pointer-events-none'
            }`}
            style={{
              backfaceVisibility: 'hidden',
              transform: `rotateY(0deg) translateZ(${apothemPx}px)`,
              background: 'linear-gradient(135deg, rgba(224, 109, 59, 0.18), rgba(15, 17, 23, 0.96))',
            }}
          >
            <div className="h-8 flex items-center justify-between shrink-0">
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#E06D3B] text-black">LIVE RADIO</span>
              <span className="text-[10px] font-mono text-emerald-400">{isLiveRadio ? '● ON AIR' : 'STANDBY'}</span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-1 sm:gap-1.5 my-auto">
              {FACTORY_RADIO_PRESETS.map((st) => (
                <button
                  key={st.channelId}
                  type="button"
                  onClick={() => onPlayStation?.(st.channelId)}
                  style={{ minHeight: '48px', minWidth: '48px' }}
                  className={`!min-h-[48px] !min-w-[48px] lg:!min-h-[56px] px-3 py-1 rounded-xl border text-left flex lg:flex-col items-center lg:items-start justify-between ${
                    nowPlaying?.channelId === st.channelId
                      ? 'bg-[#E06D3B]/20 border-[#E06D3B] text-white'
                      : 'bg-[#0F1117]/80 border-white/10 text-slate-200'
                  }`}
                >
                  <span className="font-mono text-[10px] text-[#E06D3B]">{st.presetNumber}</span>
                  <span className="text-xs font-bold truncate">{st.name}</span>
                </button>
              ))}
            </div>
            <div className="text-[10px] font-mono text-slate-400 border-t border-white/10 pt-1">P01–P05 Live Edge</div>
          </div>

          {/* Facet 1: Archive Music */}
          <div
            role="tabpanel"
            aria-hidden={activeSource !== 'music'}
            className={`absolute inset-0 w-full h-full rounded-2xl p-4 flex flex-col justify-between overflow-hidden border border-cyan-500/45 bg-[#181B24]/95 ${
              activeSource === 'music' ? 'pointer-events-auto' : 'pointer-events-none'
            }`}
            style={{
              backfaceVisibility: 'hidden',
              transform: `rotateY(90deg) translateZ(${apothemPx}px)`,
              background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.18), rgba(15, 17, 23, 0.96))',
            }}
          >
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-400 text-black w-fit">ARCHIVE MUSIC</span>
            <div className="my-auto">
              <h3 className="text-lg font-bold text-white">Recorded Music & Concert Vault</h3>
              <p className="text-xs text-slate-300 mt-1">Real-time Web Audio spectrum enabled via local proxy.</p>
            </div>
            <span className="text-[10px] font-mono text-cyan-300 border-t border-white/10 pt-1.5">Select an album below ↓</span>
          </div>

          {/* Facet 2: Podcasts */}
          <div
            role="tabpanel"
            aria-hidden={activeSource !== 'podcasts'}
            className={`absolute inset-0 w-full h-full rounded-2xl p-4 flex flex-col justify-between overflow-hidden border border-pink-500/45 bg-[#181B24]/95 ${
              activeSource === 'podcasts' ? 'pointer-events-auto' : 'pointer-events-none'
            }`}
            style={{
              backfaceVisibility: 'hidden',
              transform: `rotateY(180deg) translateZ(${apothemPx}px)`,
              background: 'linear-gradient(135deg, rgba(236, 72, 153, 0.18), rgba(15, 17, 23, 0.96))',
            }}
          >
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-pink-500 text-white w-fit">PODCAST VENDOR HUBS</span>
            <div className="my-auto">
              <h3 className="text-lg font-bold text-white">Syndicated Talk & Daily Editions</h3>
              <p className="text-xs text-slate-300 mt-1">Daily feeds from Fox News Radio, Infowars, and Rush Limbaugh.</p>
            </div>
            <span className="text-[10px] font-mono text-pink-300 border-t border-white/10 pt-1.5">Select an episode below ↓</span>
          </div>

          {/* Facet 3: Listen Back */}
          <div
            role="tabpanel"
            aria-hidden={activeSource !== 'listenback'}
            className={`absolute inset-0 w-full h-full rounded-2xl p-4 flex flex-col justify-between overflow-hidden border border-amber-500/45 bg-[#181B24]/95 ${
              activeSource === 'listenback' ? 'pointer-events-auto' : 'pointer-events-none'
            }`}
            style={{
              backfaceVisibility: 'hidden',
              transform: `rotateY(270deg) translateZ(${apothemPx}px)`,
              background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.18), rgba(15, 17, 23, 0.96))',
            }}
          >
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-400 text-black w-fit">LISTEN BACK</span>
            <div className="my-auto">
              <h3 className="text-lg font-bold text-white">Hourly Broadcast Archives</h3>
              <p className="text-xs text-slate-300 mt-1">Replay AJN hours; switch to the paired video at the same spot.</p>
            </div>
            <span className="text-[10px] font-mono text-amber-300 border-t border-white/10 pt-1.5">Select an hour on the right →</span>
          </div>
        </div>
      </div>
    </section>
  );
};
