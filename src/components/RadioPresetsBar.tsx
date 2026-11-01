import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import { Search } from 'lucide-react';
import type { NowPlayingMedia, PlayProgramCallback } from '../types';
import { registerLiveRadioMeter } from '../utils/mediaRoute';
import {
  RADIO_PRESET_SLOTS, clearRadioPreset, saveRadioPreset, useRadioPresets,
  type RadioPreset, type RadioPresetInput, type RadioPresetMap, type RadioPresetSlot,
} from '../utils/radioPresets';
import { getStationTheme } from '../utils/radioAccents';
import { getStationArt } from '../utils/stationArt';
import { readRecentStations, type RecentStation } from '../utils/radioRecent';

const HOLD_MS = 500;
const HOLD_SLOP_PX = 10;
const STATUS_MS = 4000;

export const PRESET_VIEW_KEY = 'ajn.radio.presetView.v1';
export type PresetView = 'wall' | 'unit';
/** The remembered view ('wall' when nothing is stored or storage is blocked). */
export function readPresetView(storage?: { getItem(key: string): string | null }): PresetView {
  try {
    const s = storage ?? (typeof window === 'undefined' ? null : window.localStorage);
    return s?.getItem(PRESET_VIEW_KEY) === 'unit' ? 'unit' : 'wall';
  } catch { return 'wall'; }
}

/** What the dock knows about the station that is playing right now (the directory record, when the station was picked there). */
export interface PresetSourceInfo { number?: number; logo?: string; corsVerified?: boolean }

interface RadioPresetsBarProps {
  /** The station playing now, or null. Only "radio:" ids can be saved. */
  station: NowPlayingMedia | null;
  /** Extra detail (number, logo) when the dock has it. */
  info?: PresetSourceInfo | null;
  /** True while sound is actually playing (green dot on the matching slot). */
  live: boolean;
  /** Plays a station WITHOUT leaving the page (same callback the directory uses). */
  onPlay: PlayProgramCallback;
  /** Lets the dock show the preset's picture in its "now playing" strip. */
  onPresetTuned?: (channelId: string, logo?: string) => void;
  /** Full-screen dock: five tiles in one row and no "All stations" tile. */
  wide?: boolean;
  /** Seeds the view (tests). Normally read from this device's saved choice. */
  initialView?: PresetView;
}

function initialsOf(name: string): string {
  const letters = name.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const first = letters[0] ?? '?';
  return (first.length >= 2 ? first.slice(0, 2) : first + (letters[1]?.[0] ?? '')).toUpperCase();
}
function tileColor(id: string, name?: string): string {
  return getStationTheme(id, name).color;
}

/** Five hardware-style presets: tap to tune, press and hold (half a second) to save the station that is playing. */
export function RadioPresetsBar({ station, info, live, onPlay, onPresetTuned, wide = false, initialView }: RadioPresetsBarProps): ReactElement {
  const presets: RadioPresetMap = useRadioPresets();
  const [status, setStatus] = useState<string>('');
  const [holding, setHolding] = useState<RadioPresetSlot | null>(null);
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  const [menu, setMenu] = useState<RadioPresetSlot | null>(null);
  const [bank, setBank] = useState<'presets' | 'recent'>('presets');
  const [recents, setRecents] = useState<RecentStation[]>([]);
  const [view, setViewState] = useState<PresetView>(() => initialView ?? readPresetView());
  const [preview, setPreview] = useState<string | null>(null); // head unit: key hovered/focused, shown on the LCD
  const setView = useCallback((next: PresetView) => {
    setViewState(next);
    try { window.localStorage.setItem(PRESET_VIEW_KEY, next); } catch { /* blocked storage: the choice just is not remembered */ }
  }, []);
  const [knobAngle, setKnobAngle] = useState(0); // knob art only: turns one detent per station step
  const knobDrag = useRef<{ x: number; acc: number } | null>(null);
  const knobMoved = useRef(false);
  const timer = useRef<number | null>(null);
  const statusTimer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef<RadioPresetSlot | null>(null); // the long press already saved: swallow the click that follows the release
  const menuRef = useRef<HTMLDivElement>(null);

  const say = useCallback((text: string) => {
    setStatus(text);
    if (statusTimer.current !== null) window.clearTimeout(statusTimer.current);
    statusTimer.current = window.setTimeout(() => { statusTimer.current = null; setStatus(''); }, STATUS_MS);
  }, []);

  const cancelHold = useCallback(() => {
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
    start.current = null;
    setHolding(null);
  }, []);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (statusTimer.current !== null) window.clearTimeout(statusTimer.current);
  }, []);

  const playing = station && station.channelId?.startsWith('radio:') ? station : null;
  const isHoldingSlot = (slot: RadioPresetSlot): boolean => holding === slot;

  /** Saves the playing station into a slot. Returns true when saved. */
  const assign = useCallback((slot: RadioPresetSlot): boolean => {
    if (!playing || !playing.channelId) { say('Play a station first, then press and hold a preset to save it.'); return false; }
    // Number and picture come from the directory record; if this station was started elsewhere, reuse what another slot already knows about it.
    const known = RADIO_PRESET_SLOTS.map((n) => presets[n]).find((p) => p?.channelId === playing.channelId);
    const input: RadioPresetInput = {
      channelId: playing.channelId,
      title: playing.title,
      subtitle: playing.subtitle,
      number: info?.number ?? known?.number,
      logo: info?.logo ?? known?.logo,
      src: playing.src,
      programId: playing.programId,
      guideId: playing.guideId,
      corsVerified: info?.corsVerified ?? known?.corsVerified,
    };
    const res = saveRadioPreset(slot, input);
    if (!res.saved) { say('This station could not be saved to a preset.'); return false; }
    try { navigator.vibrate?.(30); } catch { /* no haptics on this device */ }
    say(`Saved to Preset ${slot}: ${playing.title}`);
    return true;
  }, [playing, info, presets, say]);

  const tune = useCallback((p: RadioPreset) => {
    if (p.corsVerified) registerLiveRadioMeter(p.channelId);
    onPresetTuned?.(p.channelId, p.logo);
    onPlay(p.src, p.title, p.subtitle, 'audio', p.channelId, p.guideId ?? 'audio-podcasts', p.programId);
  }, [onPlay, onPresetTuned]);

  const openBank = useCallback((next: 'presets' | 'recent') => {
    setBank(next);
    if (next === 'recent') setRecents(readRecentStations().slice(0, 6));
  }, []);
  const tuneRecent = useCallback((r: RecentStation) => {
    onPresetTuned?.(r.channelId, getStationArt(r.channelId));
    onPlay(r.src, r.title, r.subtitle, 'audio', r.channelId, r.guideId ?? 'audio-podcasts', r.programId);
  }, [onPlay, onPresetTuned]);

  /** Knob / skip keys: step to the previous or next station in the visible bank. Does nothing (and says so) when the bank is empty. */
  const stepStation = useCallback((dir: 1 | -1) => {
    const list = bank === 'presets'
      ? RADIO_PRESET_SLOTS.map((n) => presets[n]).filter((p): p is RadioPreset => Boolean(p)).map((p) => ({ channelId: p.channelId, title: p.title, go: () => tune(p) }))
      : recents.map((r) => ({ channelId: r.channelId, title: r.title, go: () => tuneRecent(r) }));
    if (!list.length) { say(bank === 'presets' ? 'No presets saved yet. Play a station, then press and hold a key.' : 'No recent stations yet.'); return; }
    const i = list.findIndex((x) => x.channelId === playing?.channelId);
    const next = list[i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length];
    setKnobAngle((a) => a + dir * 36);
    next.go();
    say(`Tuned ${next.title}`);
  }, [bank, presets, recents, playing, tune, tuneRecent, say]);

  const onPointerDown = (slot: RadioPresetSlot) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    cancelHold();
    fired.current = null;
    start.current = { x: e.clientX, y: e.clientY };
    setHolding(slot);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      fired.current = slot;
      setHolding(null);
      assign(slot);
    }, HOLD_MS);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const st = start.current;
    if (st && Math.hypot(e.clientX - st.x, e.clientY - st.y) > HOLD_SLOP_PX) cancelHold();
  };
  const onClick = (slot: RadioPresetSlot) => () => {
    if (fired.current === slot) { fired.current = null; return; }
    const p = presets[slot];
    if (p) { tune(p); return; }
    say(playing ? `Press & hold to assign ${playing.title} to Preset ${slot}` : `Preset ${slot} is empty. Play a station, then press and hold to save it.`);
  };
  const onKeyDown = (slot: RadioPresetSlot) => (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); assign(slot); }
    else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) { e.preventDefault(); setMenu(slot); }
  };

  // Context menu (right click / keyboard): "Assign playing station" and "Clear preset".
  useEffect(() => {
    if (menu === null) return undefined;
    const t = window.setTimeout(() => menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus(), 30);
    const onDown = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(null); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMenu(null); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement as HTMLElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => { window.clearTimeout(t); window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey, true); };
  }, [menu]);

  return (
    <div data-testid="radio-presets" className="relative border-b border-neutral-800 bg-neutral-950/90">
      <div role="group" aria-label="Radio preset banks" className="flex items-center gap-1 px-3 pt-2">
        {([['presets', 'My presets'], ['recent', 'Recent']] as const).map(([id, text]) => (
          <button key={id} type="button" data-testid={`radio-bank-${id}`} aria-pressed={bank === id} onClick={() => openBank(id)}
            className={`cursor-pointer rounded-md px-2.5 py-1 text-xs font-semibold touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 ${bank === id ? 'bg-neutral-800 text-orange-300' : 'text-neutral-400 hover:text-neutral-200'}`}>{text}</button>
        ))}
        <div role="group" aria-label="Preset view" className="ml-auto flex items-center gap-1">
          {([['wall', 'Wall'], ['unit', 'Head unit']] as const).map(([id, text]) => (
            <button key={id} type="button" data-testid={`radio-view-${id}`} aria-pressed={view === id} onClick={() => setView(id)}
              className={`cursor-pointer rounded-md px-2.5 py-1 text-xs font-semibold touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 ${view === id ? 'bg-neutral-800 text-orange-300' : 'text-neutral-400 hover:text-neutral-200'}`}>{text}</button>
          ))}
        </div>
      </div>
      {view === 'unit' ? (
      <div data-testid="radio-head-unit" className="mx-auto my-2 w-[calc(100%-1.5rem)] max-w-[420px] rounded-xl border-2 border-[#20242c] p-2 pb-2.5"
        style={{ background: 'linear-gradient(180deg,#2a2e36 0%,#14171c 45%,#0a0c0f 100%)', boxShadow: '0 12px 28px rgba(0,0,0,0.8), inset 0 1px 1px rgba(255,255,255,0.18), inset 0 -2px 4px rgba(0,0,0,0.8)' }}>
        <div className="flex items-center justify-between px-1 pb-1.5 font-mono text-[10px] font-bold tracking-widest text-neutral-400">
          <span>AJN-1</span><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-neutral-700" />
        </div>
        {(() => {
          const nowTheme = playing ? getStationTheme(playing.channelId ?? '', playing.title, info?.logo ?? getStationArt(playing.channelId)) : null;
          const nowLogo = playing ? (info?.logo ?? getStationArt(playing.channelId)) : undefined;
          const accent = nowTheme?.accentColor ?? '#a3a3a3';
          const line2 = preview ?? playing?.title ?? 'No station';
          const line3 = preview ? '' : (playing?.subtitle ?? '');
          const skipCls = 'flex h-11 w-11 cursor-pointer items-center justify-center rounded border border-neutral-600 bg-neutral-800 text-[11px] font-bold text-neutral-200 hover:border-orange-500/60 active:scale-95 touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400';
          return (
            <div className="flex items-stretch gap-2">
            <div className="flex w-[92px] shrink-0 flex-col items-center justify-between gap-1.5">
              <button type="button" data-testid="radio-head-unit-knob" aria-label={`Tune knob: turn or press for the next station in ${bank === 'presets' ? 'My presets' : 'Recent'}. Arrow keys step back and forward.`}
                onPointerDown={(e) => { knobDrag.current = { x: e.clientX, acc: 0 }; knobMoved.current = false; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* capture is optional */ } }}
                onPointerMove={(e) => {
                  const d = knobDrag.current; if (!d) return;
                  d.acc += e.clientX - d.x; d.x = e.clientX;
                  while (Math.abs(d.acc) >= 24) { const dir = d.acc > 0 ? 1 : -1; d.acc -= dir * 24; knobMoved.current = true; stepStation(dir); }
                }}
                onPointerUp={() => { knobDrag.current = null; }} onPointerCancel={() => { knobDrag.current = null; }}
                onClick={() => { if (knobMoved.current) { knobMoved.current = false; return; } stepStation(1); }}
                onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); stepStation(1); } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); stepStation(-1); } }}
                onWheel={(e) => { if (e.deltaY) stepStation(e.deltaY > 0 ? 1 : -1); }}
                className="relative h-16 w-16 shrink-0 cursor-ew-resize touch-none select-none rounded-full p-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
                style={{ background: 'linear-gradient(180deg,#4b5563 0%,#1e2229 100%)', boxShadow: '0 2px 8px rgba(0,0,0,0.7), inset 0 1px 1px rgba(255,255,255,0.25)' }}>
                <span aria-hidden="true" className="relative block h-full w-full rounded-full transition-transform duration-150 motion-reduce:transition-none"
                  style={{ transform: `rotate(${knobAngle}deg)`, background: 'conic-gradient(from 180deg at 50% 50%, #374151 0deg, #9ca3af 45deg, #374151 90deg, #1f2937 135deg, #9ca3af 180deg, #374151 225deg, #1f2937 270deg, #9ca3af 315deg, #374151 360deg)', boxShadow: '0 8px 18px rgba(0,0,0,0.85), inset 0 1px 2px rgba(255,255,255,0.4), inset 0 -3px 6px rgba(0,0,0,0.9)' }}>
                  <span className="absolute left-1/2 top-0.5 h-3.5 w-1.5 -translate-x-1/2 rounded-full bg-amber-400" style={{ boxShadow: '0 0 8px #f97316' }} />
                </span>
              </button>
              <div className="flex gap-1.5">
                <button type="button" data-testid="radio-head-unit-prev" aria-label="Previous station" onClick={() => stepStation(-1)} className={skipCls}>{'\u23EE'}</button>
                <button type="button" data-testid="radio-head-unit-next" aria-label="Next station" onClick={() => stepStation(1)} className={skipCls}>{'\u23ED'}</button>
              </div>
            </div>
            <div data-testid="radio-head-unit-lcd" className="flex min-h-[112px] min-w-0 flex-1 items-stretch gap-2 rounded-md border border-black p-2"
              style={{ background: nowTheme ? nowTheme.themeColor : '#0a0a0a', color: `${accent}d9`, boxShadow: 'inset 0 3px 8px rgba(0,0,0,0.9), 0 1px 1px rgba(255,255,255,0.12)' }}>
              <div className="flex min-w-0 flex-1 flex-col justify-between">
                <div className="flex items-center justify-between gap-2 font-mono text-[10px] font-bold uppercase tracking-wider">
                  <span className="whitespace-nowrap">{bank === 'presets' ? 'My presets' : 'Recent'}</span>
                  <span data-testid="radio-head-unit-lamp" className="flex items-center gap-1 whitespace-nowrap">
                    <span aria-hidden="true" className={`h-2 w-2 rounded-full ${live ? 'bg-emerald-400 animate-pulse motion-reduce:animate-none' : 'bg-neutral-600'}`} />{live ? 'ON AIR' : 'OFF AIR'}
                  </span>
                </div>
                <p className="truncate text-sm font-bold leading-tight">{line2}</p>
                <p className="truncate text-[11px] leading-tight opacity-80">{line3}</p>
              </div>
              <div aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center self-center overflow-hidden rounded border-2 border-black/70 bg-black/40">
                {nowLogo && !broken.has(playing?.channelId ?? '') ? (
                  <img src={nowLogo} alt="" draggable={false} referrerPolicy="no-referrer" className="h-full w-full object-contain" onError={() => setBroken((prev) => new Set(prev).add(playing?.channelId ?? ''))} />
                ) : (
                  <span className="text-base font-bold">{playing ? initialsOf(playing.title) : '--'}</span>
                )}
              </div>
            </div>
            </div>
          );
        })()}
        <div className="mt-2.5 grid grid-cols-6 gap-1.5">
          {RADIO_PRESET_SLOTS.map((slot) => {
            const p = bank === 'presets' ? presets[slot] : undefined;
            const r = bank === 'recent' ? recents[slot - 1] : undefined;
            const id = p?.channelId ?? r?.channelId;
            const title = p?.title ?? r?.title;
            const active = Boolean(id && playing && id === playing.channelId);
            const logoSrc = p ? (p.logo ?? getStationArt(p.channelId)) : r ? getStationArt(r.channelId) : undefined;
            const showLogo = Boolean(logoSrc) && !broken.has(id ?? '');
            const color = id ? tileColor(id, title) : undefined;
            const keyBase = `relative flex h-14 min-w-14 select-none flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg border text-center touch-manipulation cursor-pointer active:scale-95 motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 ${active ? 'border-orange-500 bg-orange-500/15 text-white' : id ? 'border-neutral-600 bg-neutral-900 text-neutral-100 hover:border-orange-500/60' : 'border-dashed border-neutral-700/70 bg-neutral-900/50 text-neutral-500'}`;
            const body = (
              <>
                {isHoldingSlot(slot) && <span aria-hidden="true" data-testid="radio-preset-hold" className="pointer-events-none absolute inset-0 z-[2] rounded-lg ring-2 ring-orange-400" style={{ animation: `ajnPresetFill ${HOLD_MS}ms linear forwards`, background: 'rgba(249,115,22,0.22)' }} />}
                <span aria-hidden="true" className="font-mono text-[11px] font-bold text-orange-400">{slot}</span>
                {id ? (showLogo
                  ? <img src={logoSrc} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} className="h-[22px] w-[22px] rounded-sm object-contain" onError={() => setBroken((prev) => new Set(prev).add(id))} />
                  : <span aria-hidden="true" style={{ color }} className="text-[11px] font-bold">{initialsOf(title ?? '?')}</span>)
                  : <span aria-hidden="true" className="text-sm leading-none">+</span>}
                {active && live && <span aria-hidden="true" data-testid="radio-preset-live" className="ajn-live-dot absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse motion-reduce:animate-none" />}
              </>
            );
            const hover = { onMouseEnter: () => title && setPreview(title), onFocus: () => title && setPreview(title), onMouseLeave: () => setPreview(null), onBlur: () => setPreview(null) };
            if (bank === 'recent') {
              return (
                <button key={slot} type="button" data-testid={`radio-recent-${slot}`} disabled={!r} aria-current={active ? 'true' : undefined}
                  aria-label={r ? `${r.title}${active ? (live ? ', playing now' : ', current station') : ''}. Tap to tune.` : `Recent ${slot}, empty`}
                  onClick={() => r && tuneRecent(r)} {...hover} className={`${keyBase} disabled:cursor-default`}>{body}</button>
              );
            }
            const label = p
              ? `Preset ${slot}: ${p.title}${p.number ? `, station ${p.number}` : ''}${active ? (live ? ', playing now' : ', current station') : ''}. Tap to tune. Press and hold, or Shift+Enter, to replace it with the playing station.`
              : `Preset ${slot}, empty. Press and hold, or Shift+Enter, to save the playing station here.`;
            return (
              <button key={slot} type="button" data-testid={`radio-preset-${slot}`} data-filled={p ? 'true' : 'false'} aria-label={label} aria-current={active ? 'true' : undefined} title={label}
                onPointerDown={onPointerDown(slot)} onPointerMove={onPointerMove} onPointerUp={cancelHold} onPointerCancel={cancelHold} onPointerLeave={cancelHold}
                onClick={onClick(slot)} onKeyDown={onKeyDown(slot)}
                onContextMenu={(e) => { e.preventDefault(); cancelHold(); fired.current = null; setMenu(slot); }}
                {...hover} style={color && !active ? { borderColor: `${color}50` } : undefined} className={keyBase}>{body}</button>
            );
          })}
          <button type="button" data-testid="radio-preset-bank" aria-label={`Bank: ${bank === 'presets' ? 'My presets' : 'Recent'}. Press to switch.`}
            onClick={() => openBank(bank === 'presets' ? 'recent' : 'presets')}
            className="flex h-14 min-w-14 cursor-pointer select-none items-center justify-center rounded-lg border border-neutral-600 bg-neutral-800 text-[11px] font-bold tracking-wider text-orange-300 hover:border-orange-500/60 touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400">BANK</button>
        </div>
      </div>
      ) : bank === 'presets' ? (
      <div role="group" aria-label="Radio presets" className={`grid gap-2 px-3 py-2 ${wide ? 'grid-cols-5' : 'grid-cols-3'}`}>
        {RADIO_PRESET_SLOTS.map((slot) => {
          const p = presets[slot];
          const active = Boolean(p && playing && p.channelId === playing.channelId);
          const isHolding = holding === slot;
          const theme = p ? getStationTheme(p.channelId, p.title, p.logo ?? getStationArt(p.channelId)) : null;
          const base = 'relative flex h-[112px] min-w-0 select-none flex-col overflow-hidden rounded-xl text-left transition-transform active:scale-95 motion-reduce:transition-none cursor-pointer touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400';
          const tone = !p
            ? 'border border-dashed border-neutral-700/60 bg-neutral-900/40 text-neutral-400 hover:border-neutral-500 hover:bg-neutral-900'
            : active
              ? 'border border-orange-500 bg-orange-500/15 text-white'
              : 'border border-neutral-700/80 bg-neutral-900/90 text-neutral-100 shadow-sm hover:border-orange-500/60';
          const label = p
            ? `Preset ${slot}: ${p.title}${p.number ? `, station ${p.number}` : ''}${active ? (live ? ', playing now' : ', current station') : ''}. Tap to tune. Press and hold, or Shift+Enter, to replace it with the playing station.`
            : `Preset ${slot}, empty. Press and hold, or Shift+Enter, to save the playing station here.`;
          const logoSrc = p ? (p.logo ?? getStationArt(p.channelId)) : undefined;
          const showLogo = Boolean(logoSrc) && !broken.has(p?.channelId ?? '');
          const color = theme ? theme.color : p ? tileColor(p.channelId) : undefined;
          return (
            <button key={slot} type="button" data-testid={`radio-preset-${slot}`} data-filled={p ? 'true' : 'false'} aria-label={label} aria-current={active ? 'true' : undefined} title={label}
              onPointerDown={onPointerDown(slot)} onPointerMove={onPointerMove} onPointerUp={cancelHold} onPointerCancel={cancelHold} onPointerLeave={cancelHold}
              onClick={onClick(slot)} onKeyDown={onKeyDown(slot)}
              onContextMenu={(e) => { e.preventDefault(); cancelHold(); fired.current = null; setMenu(slot); }}
              style={color ? (active ? { boxShadow: `0 0 0 2px ${color}` } : { borderColor: `${color}50` }) : undefined}
              className={`${base} ${tone}`}>
              {isHolding && (
                <span aria-hidden="true" data-testid="radio-preset-hold" className="pointer-events-none absolute inset-0 z-[2] rounded-xl ring-2 ring-orange-400"
                  style={{ animation: `ajnPresetFill ${HOLD_MS}ms linear forwards`, background: 'rgba(249,115,22,0.22)' }} />
              )}
              {p ? (
                <>
                  <span className="relative flex h-[72px] w-full shrink-0 items-center justify-center overflow-hidden" style={{ background: `${color}33` }}>
                    {showLogo ? (
                      <img src={logoSrc} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false}
                        className="h-full w-full object-contain p-1" onError={() => setBroken((prev) => new Set(prev).add(p.channelId))} />
                    ) : (
                      <span aria-hidden="true" style={{ color }} className="text-lg font-bold">{initialsOf(p.title)}</span>
                    )}
                    <span aria-hidden="true" className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] font-bold leading-none text-orange-400">{slot}</span>
                    {active && live && <span aria-hidden="true" data-testid="radio-preset-live" className="ajn-live-dot absolute bottom-1 right-1 h-2 w-2 rounded-full bg-emerald-400 animate-pulse motion-reduce:animate-none" />}
                  </span>
                  <span className="relative block min-w-0 px-1.5 pt-1">
                    <span className="block truncate text-xs font-semibold leading-tight">{p.title}</span>
                    <span className="block truncate text-[10px] leading-tight text-neutral-400">{p.number ? `#${p.number}` : (theme?.label ?? '')}</span>
                  </span>
                </>
              ) : (
                <span className="relative flex h-full flex-col items-center justify-center gap-1 px-2 text-center">
                  <span aria-hidden="true" className="font-mono text-xs font-bold text-orange-400/80">{slot}</span>
                  <span className="line-clamp-2 text-[10px] leading-tight text-neutral-400">{playing ? `+ Save "${playing.title}" here` : 'Empty. Play a station, then hold to save.'}</span>
                </span>
              )}
            </button>
          );
        })}
        {!wide && (
          <button type="button" data-testid="radio-all-stations"
            onClick={() => document.querySelector<HTMLElement>('[data-testid="live-radio-search"]')?.focus()}
            className="flex h-[112px] min-w-0 cursor-pointer select-none flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-neutral-700/60 bg-neutral-900/30 px-2 text-center text-neutral-400 hover:border-neutral-500 hover:text-neutral-200 touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400">
            <Search className="h-5 w-5" aria-hidden="true" />
            <span className="text-xs font-semibold">All stations</span>
          </button>
        )}
      </div>
      ) : (
      <div role="group" aria-label="Recent radio stations" className={`grid gap-2 px-3 py-2 ${wide ? 'grid-cols-5' : 'grid-cols-3'}`}>
        {recents.length === 0 ? (
          <p data-testid="radio-recent-empty" className="col-span-full py-6 text-center text-xs text-neutral-400">No stations played yet.</p>
        ) : recents.map((r, i) => {
          const isNow = Boolean(playing && playing.channelId === r.channelId);
          const logoSrc = getStationArt(r.channelId);
          const showLogo = Boolean(logoSrc) && !broken.has(r.channelId);
          const color = tileColor(r.channelId, r.title);
          return (
            <button key={r.channelId} type="button" data-testid={`radio-recent-${i + 1}`} aria-current={isNow ? 'true' : undefined}
              aria-label={`${r.title}${isNow ? (live ? ', playing now' : ', current station') : ''}. Tap to tune.`}
              onClick={() => tuneRecent(r)}
              style={isNow ? { boxShadow: `0 0 0 2px ${color}` } : { borderColor: `${color}50` }}
              className={`relative flex h-[112px] min-w-0 cursor-pointer select-none flex-col overflow-hidden rounded-xl border text-left active:scale-95 motion-reduce:transition-none touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 ${isNow ? 'border-orange-500 bg-orange-500/15 text-white' : 'border-neutral-700/80 bg-neutral-900/90 text-neutral-100 hover:border-orange-500/60'}`}>
              <span className="relative flex h-[72px] w-full shrink-0 items-center justify-center overflow-hidden" style={{ background: `${color}33` }}>
                {showLogo ? (
                  <img src={logoSrc} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false}
                    className="h-full w-full object-contain p-1" onError={() => setBroken((prev) => new Set(prev).add(r.channelId))} />
                ) : (
                  <span aria-hidden="true" style={{ color }} className="text-lg font-bold">{initialsOf(r.title)}</span>
                )}
                {isNow && live && <span aria-hidden="true" className="ajn-live-dot absolute bottom-1 right-1 h-2 w-2 rounded-full bg-emerald-400 animate-pulse motion-reduce:animate-none" />}
              </span>
              <span className="relative block min-w-0 px-1.5 pt-1">
                <span className="block truncate text-xs font-semibold leading-tight">{r.title}</span>
                <span className="block truncate text-[10px] leading-tight text-neutral-400">{r.subtitle ?? ''}</span>
              </span>
            </button>
          );
        })}
      </div>
      )}
      <p data-testid="radio-presets-status" role="status" aria-live="polite" className={`px-3 pb-2 text-[11px] text-orange-200 ${status ? '' : 'sr-only'}`}>{status || 'Radio presets. Tap to tune; press and hold to save the playing station.'}</p>
      <style>{`@keyframes ajnPresetFill{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}@media (prefers-reduced-motion:reduce){[data-testid="radio-preset-hold"]{animation:none!important}}`}</style>
      {menu !== null && (
        <div ref={menuRef} role="menu" aria-label={`Preset ${menu} options`} data-testid="radio-preset-menu"
          className="absolute left-3 top-full z-[5] w-56 overflow-hidden rounded-xl border border-red-700/70 bg-neutral-950 text-neutral-100 shadow-2xl">
          <button type="button" role="menuitem" data-testid="radio-preset-menu-assign" disabled={!playing}
            onClick={() => { assign(menu); setMenu(null); }}
            className="block w-full cursor-pointer px-3 py-2.5 text-left text-sm hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 touch-manipulation">Assign playing station</button>
          <button type="button" role="menuitem" data-testid="radio-preset-menu-clear" disabled={!presets[menu]}
            onClick={() => { const n = menu; clearRadioPreset(n); say(`Preset ${n} cleared`); setMenu(null); }}
            className="block w-full cursor-pointer border-t border-neutral-800 px-3 py-2.5 text-left text-sm hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 touch-manipulation">Clear preset</button>
        </div>
      )}
    </div>
  );
}
