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

const LONG_LABEL: Record<AudioSourceType, string> = { radio: 'LIVE RADIO', music: 'LIBRARY MUSIC', podcasts: 'PODCASTS', listenback: 'LISTEN BACK' };
const SHORT_LABEL: Record<AudioSourceType, string> = { radio: 'Live', music: 'Music', podcasts: 'Podcasts', listenback: 'Replay' };
const INFO_FACES = [
  { src: 'music' as const, rot: 90, border: 'border-cyan-500/45', tint: 'rgba(6, 182, 212, 0.18)', badge: 'bg-cyan-400 text-black', badgeText: 'LIBRARY MUSIC', hintCls: 'text-cyan-300', hint: 'Pick an album below ↓', title: 'Recorded Music & Concert Vault', text: 'Albums, concerts and music videos from the AJN library.' },
  { src: 'podcasts' as const, rot: 180, border: 'border-pink-500/45', tint: 'rgba(236, 72, 153, 0.18)', badge: 'bg-pink-500 text-white', badgeText: 'PODCASTS', hintCls: 'text-pink-300', hint: 'Pick an episode below ↓', title: 'Syndicated Talk & Daily Editions', text: 'News, talk, true crime, tech and more. Newest episodes first.' },
  { src: 'listenback' as const, rot: 270, border: 'border-amber-500/45', tint: 'rgba(245, 158, 11, 0.18)', badge: 'bg-amber-400 text-black', badgeText: 'LISTEN BACK', hintCls: 'text-amber-300', hint: 'Pick an hour →', title: 'Hourly Broadcast Archives', text: 'Replay AJN hours; switch to the paired video at the same spot.' },
];

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
      {/* Tab controls: one short row (4 equal keys, arrows only where there is room). Swipe or the keys turn the prism. */}
      <div className="mb-1.5 flex items-center gap-1.5">
        <div role="tablist" aria-label="Radio source" className="grid min-w-0 flex-1 grid-cols-4 gap-1">
          {SOURCE_ORDER.map((src, i) => (
            <button
              key={src}
              type="button"
              role="tab"
              data-testid={MODE_TEST_ID[src]}
              aria-selected={activeSource === src}
              aria-pressed={activeSource === src}
              aria-label={LONG_LABEL[src]}
              onClick={() => selectByIndex(i)}
              className={`ck-key ck-key--sm !min-h-[42px] !min-w-0 truncate !px-1 text-[11px] font-bold uppercase tracking-wide sm:text-xs${activeSource === src ? ' is-latched' : ''}`}
            >
              <span>{SHORT_LABEL[src]}</span>
            </button>
          ))}
        </div>
        <div className="hidden items-center gap-1 sm:flex">
          <button type="button" data-testid="source-prism-prev" aria-label="Previous source" onClick={() => step(-1)} className="ck-key ck-key--icon !min-h-[42px] !min-w-[42px] text-base font-bold text-[#E06D3B]">‹</button>
          <button type="button" data-testid="source-prism-next" aria-label="Next source" onClick={() => step(1)} className="ck-key ck-key--icon !min-h-[42px] !min-w-[42px] text-base font-bold text-[#E06D3B]">›</button>
        </div>
      </div>

      {/* 3D Scene Viewport: short (every face fits in one glance) */}
      <div
        ref={sceneRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerLeave={finishDrag}
        className="relative h-[128px] w-full touch-pan-y overflow-hidden rounded-2xl lg:h-[112px]"
        style={{ perspective: '900px' }}
      >
        <div
          data-testid="source-prism-cylinder"
          className="relative h-[128px] w-full lg:h-[112px]"
          style={{
            transformStyle: 'preserve-3d',
            transition: isDragging ? 'none' : 'transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
            transform: `translateZ(-${apothemPx}px) rotateY(${displayAngle}deg)`,
          }}
        >
          {/* Facet 0: Live Radio (header + the five presets, nothing else) */}
          <div
            role="tabpanel"
            aria-hidden={activeSource !== 'radio'}
            className={`absolute inset-0 flex h-full w-full flex-col gap-1 overflow-hidden rounded-2xl border border-[#E06D3B]/45 bg-[#181B24]/95 p-2 ${
              activeSource === 'radio' ? 'pointer-events-auto' : 'pointer-events-none'
            }`}
            style={{
              backfaceVisibility: 'hidden',
              transform: `rotateY(0deg) translateZ(${apothemPx}px)`,
              background: 'linear-gradient(135deg, rgba(224, 109, 59, 0.18), rgba(15, 17, 23, 0.96))',
            }}
          >
            <div className="flex shrink-0 items-center justify-between">
              <span className="rounded bg-[#E06D3B] px-2 py-0.5 text-[10px] font-bold text-black">STARTER STATIONS</span>
              <span className="font-mono text-[10px] text-emerald-400">{isLiveRadio ? '● ON AIR' : 'STANDBY'}</span>
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-3 content-center gap-1">
              {FACTORY_RADIO_PRESETS.map((st) => {
                const isActive = nowPlaying?.channelId === st.channelId;
                return (
                  <button
                    key={st.channelId}
                    type="button"
                    aria-pressed={isActive}
                    aria-current={isActive ? 'true' : undefined}
                    onClick={() => onPlayStation?.(st.channelId)}
                    className={`ck-key !min-h-[36px] lg:!min-h-[32px] !min-w-0 w-full !justify-start gap-1 !px-1 !py-0.5 text-left${isActive ? ' is-latched' : ''}`}
                  >
                    <span className="shrink-0 rounded border border-[#E06D3B]/30 bg-black/40 px-1 font-mono text-[9px] font-bold text-[#E06D3B]">{st.presetNumber}</span>
                    <span className="line-clamp-2 break-words text-left text-[10px] font-bold leading-[1.1]">{st.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Facets 1-3: badge + hint on one line, then headline and one short sentence */}
          {INFO_FACES.map((f) => (
            <div
              key={f.src}
              role="tabpanel"
              aria-hidden={activeSource !== f.src}
              className={`absolute inset-0 flex h-full w-full flex-col justify-center gap-1 overflow-hidden rounded-2xl border bg-[#181B24]/95 p-3 ${f.border} ${
                activeSource === f.src ? 'pointer-events-auto' : 'pointer-events-none'
              }`}
              style={{
                backfaceVisibility: 'hidden',
                transform: `rotateY(${f.rot}deg) translateZ(${apothemPx}px)`,
                background: `linear-gradient(135deg, ${f.tint}, rgba(15, 17, 23, 0.96))`,
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${f.badge}`}>{f.badgeText}</span>
                <span className={`truncate font-mono text-[10px] ${f.hintCls}`}>{f.hint}</span>
              </div>
              <h3 className="m-0 line-clamp-1 text-sm font-bold text-white sm:text-base">{f.title}</h3>
              <p className="m-0 line-clamp-2 text-[11px] text-slate-300 sm:text-xs">{f.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
