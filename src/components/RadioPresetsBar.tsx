import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import type { NowPlayingMedia, PlayProgramCallback } from '../types';
import { registerLiveRadioMeter } from '../utils/mediaRoute';
import {
  RADIO_PRESET_SLOTS, clearRadioPreset, saveRadioPreset, useRadioPresets,
  type RadioPreset, type RadioPresetInput, type RadioPresetMap, type RadioPresetSlot,
} from '../utils/radioPresets';
import { getStationTheme } from '../utils/radioAccents';
import { getStationArt } from '../utils/stationArt';

const HOLD_MS = 500;
const HOLD_SLOP_PX = 10;
const STATUS_MS = 4000;

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
export function RadioPresetsBar({ station, info, live, onPlay, onPresetTuned }: RadioPresetsBarProps): ReactElement {
  const presets: RadioPresetMap = useRadioPresets();
  const [status, setStatus] = useState<string>('');
  const [holding, setHolding] = useState<RadioPresetSlot | null>(null);
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  const [menu, setMenu] = useState<RadioPresetSlot | null>(null);
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
      <div role="group" aria-label="Radio presets" className="grid grid-cols-5 gap-1.5 px-3 py-2">
        {RADIO_PRESET_SLOTS.map((slot) => {
          const p = presets[slot];
          const active = Boolean(p && playing && p.channelId === playing.channelId);
          const isHolding = holding === slot;
          const theme = p ? getStationTheme(p.channelId, p.title, p.logo ?? getStationArt(p.channelId)) : null;
          const base = 'relative flex min-h-[64px] min-w-0 select-none flex-col items-stretch gap-0.5 overflow-hidden rounded-lg px-1.5 py-1 text-left transition-transform active:scale-95 motion-reduce:transition-none cursor-pointer touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400';
          const tone = !p
            ? 'border border-dashed border-neutral-700/60 bg-neutral-900/40 text-neutral-400 hover:border-neutral-500 hover:bg-neutral-900'
            : active
              ? 'border border-orange-500 bg-orange-500/15 text-white ring-1 ring-orange-400/40'
              : 'border border-neutral-700/80 bg-neutral-900/90 text-neutral-100 shadow-sm hover:border-orange-500/60';
          const label = p
            ? `Preset ${slot}: ${p.title}${p.number ? `, station ${p.number}` : ''}${active ? (live ? ', playing now' : ', current station') : ''}. Tap to tune. Press and hold, or Shift+Enter, to replace it with the playing station.`
            : `Preset ${slot}, empty. Press and hold, or Shift+Enter, to save the playing station here.`;
          const logoSrc = p ? (p.logo ?? getStationArt(p.channelId)) : undefined;
          const showLogo = Boolean(logoSrc) && !broken.has(p?.channelId ?? '');
          return (
            <button key={slot} type="button" data-testid={`radio-preset-${slot}`} data-filled={p ? 'true' : 'false'} aria-label={label} aria-current={active ? 'true' : undefined} title={label}
              onPointerDown={onPointerDown(slot)} onPointerMove={onPointerMove} onPointerUp={cancelHold} onPointerCancel={cancelHold} onPointerLeave={cancelHold}
              onClick={onClick(slot)} onKeyDown={onKeyDown(slot)}
              onContextMenu={(e) => { e.preventDefault(); cancelHold(); fired.current = null; setMenu(slot); }}
              style={theme && !active ? { borderColor: `${theme.color}50` } : undefined}
              className={`${base} ${tone}`}>
              {isHolding && (
                <span aria-hidden="true" data-testid="radio-preset-hold" className="pointer-events-none absolute inset-0 rounded-lg ring-2 ring-orange-400"
                  style={{ animation: `ajnPresetFill ${HOLD_MS}ms linear forwards`, background: 'rgba(249,115,22,0.22)' }} />
              )}
              <span className="relative flex items-center justify-between gap-1">
                <span className="font-mono text-xs font-bold text-orange-400">{slot}</span>
                {theme && <span className="text-[10px]" title={theme.label}>{theme.iconEmoji}</span>}
                {p?.number ? <span className="font-mono text-[10px] text-neutral-400">#{p.number}</span> : null}
                {active && live && <span aria-hidden="true" data-testid="radio-preset-live" className="ajn-live-dot h-2 w-2 shrink-0 rounded-full bg-emerald-400 animate-pulse" />}
              </span>
              {p ? (
                <>
                  <span className="relative flex flex-1 items-center justify-center">
                    {showLogo ? (
                      <img src={logoSrc} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false}
                        className="h-7 w-7 rounded bg-neutral-900 object-contain" onError={() => setBroken((prev) => new Set(prev).add(p.channelId))} />
                    ) : (
                      <span aria-hidden="true" style={{ background: theme ? theme.color : tileColor(p.channelId), boxShadow: theme ? `0 0 8px ${theme.color}45` : undefined }} className="flex h-7 w-7 items-center justify-center rounded text-[11px] font-bold text-neutral-100">{initialsOf(p.title)}</span>
                    )}
                  </span>
                  <span className="relative block truncate text-[11px] font-semibold leading-tight">{p.title}</span>
                </>
              ) : (
                <span className="relative flex flex-1 items-center justify-center text-lg leading-none text-neutral-600" aria-hidden="true">+</span>
              )}
            </button>
          );
        })}
      </div>
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
