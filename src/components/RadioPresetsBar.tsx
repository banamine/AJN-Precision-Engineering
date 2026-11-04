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
import { AUDIO_SLOTS, saveAudioPreset, useAudioPresets, type AudioBank, type AudioPreset, type AudioPresetInput } from '../utils/audioPresets';

const HOLD_MS = 500;
const HOLD_SLOP_PX = 10;
const STATUS_MS = 4000;

export const PRESET_VIEW_KEY = 'ajn.radio.presetView.v1';
export type PresetView = 'wall' | 'unit';
/** The remembered view ('wall' when nothing is stored or storage is blocked). */
export function readPresetView(storage?: { getItem(key: string): string | null }, fallback: PresetView = 'wall'): PresetView {
  try {
    const s = storage ?? (typeof window === 'undefined' ? null : window.localStorage);
    const v = s?.getItem(PRESET_VIEW_KEY);
    return v === 'unit' || v === 'wall' ? v : fallback;
  } catch { return fallback; }
}

/** What the dock knows about the station that is playing right now (the directory record, when the station was picked there). */
export interface PresetSourceInfo { number?: number; logo?: string; corsVerified?: boolean }

export interface DeckItem { id: string; title: string; subtitle?: string; play: () => void; /** What a preset key stores for this item. */ preset: AudioPresetInput }
export interface DeckSources {
  music: DeckItem[];
  /** null until the concert catalog has loaded (it is fetched on demand). */
  concerts: DeckItem[] | null;
  podcasts: DeckItem[];
  loadConcerts?: () => void;
  loadSpoken?: () => void;
  concertsError?: string | null;
  /** Podcasts: a one-line status (loading more / list unavailable / N feeds unreadable). */
  podcastsNote?: string;
}

interface RadioPresetsBarProps {
  /** Archive Music / Podcasts deck modes: real episode lists supplied by the Radio page. */
  deckSources?: DeckSources;
  /** Whatever is playing now (any audio), used to store Archive Music, Concerts and Podcasts onto preset keys. */
  nowPlaying?: NowPlayingMedia | null;
  /** True while any audio is actually playing (not paused). */
  playingNow?: boolean;
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
  /** View used when the listener has not chosen one yet. The app passes 'unit' (the automotive head unit); the default stays 'wall'. */
  defaultView?: PresetView;
}

function initialsOf(name: string): string {
  const letters = name.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const first = letters[0] ?? '?';
  return (first.length >= 2 ? first.slice(0, 2) : first + (letters[1]?.[0] ?? '')).toUpperCase();
}
/** Pick-from-the-list panel for Archive Music, Live Concerts and Podcasts (Live Radio has its own station picker). Search narrows the list; a tap plays. */
function DeckPicker({ label, items, note, playingItem, onPick }: { label: string; items: DeckItem[]; note?: string; playingItem: (it: DeckItem) => boolean; onPick: (it: DeckItem) => void }): ReactElement {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const hits = needle ? items.filter((it) => `${it.title} ${it.subtitle ?? ''}`.toLowerCase().includes(needle)) : items;
  const MAX = 60;
  return (
    <div data-testid="radio-deck-picker" className="relative mt-4 rounded-2xl border border-white/15 bg-black/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-widest text-neutral-300">Choose from {label}</span>
        <span className="text-[11px] text-neutral-400">{items.length ? `${needle ? `${hits.length} of ` : ''}${items.length}` : ''}</span>
      </div>
      <input data-testid="radio-deck-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${label.toLowerCase()}`} aria-label={`Search ${label}`}
        className="mt-2 min-h-[40px] w-full rounded-lg border border-white/20 bg-black/40 px-3 text-sm text-white placeholder:text-neutral-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ajn-accent)]" />
      {note ? <p className="mt-2 text-xs text-orange-200">{note}</p> : null}
      <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto overscroll-contain pr-1" aria-label={`${label} list`}>
        {hits.slice(0, MAX).map((it) => {
          const on = playingItem(it);
          return (
            <li key={it.id}>
              <button type="button" data-testid="radio-deck-pick" aria-current={on ? 'true' : undefined} onClick={() => onPick(it)}
                className={`flex min-h-[44px] w-full cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-left touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ajn-accent)] ${on ? 'border-[#E06D3B] bg-[#E06D3B]/15 text-white' : 'border-white/10 bg-white/5 text-neutral-100 hover:border-[#E06D3B]/60'}`}>
                <span aria-hidden="true" className={`text-xs ${on ? 'text-[#F9A56D]' : 'text-neutral-500'}`}>{on ? '▶' : '•'}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{it.title}</span>{it.subtitle ? <span className="block truncate text-[11px] text-neutral-400">{it.subtitle}</span> : null}</span>
              </button>
            </li>
          );
        })}
        {!hits.length ? <li className="px-1 py-3 text-xs text-neutral-400">{items.length ? 'Nothing matches that search.' : (note ?? 'Nothing loaded yet.')}</li> : null}
        {hits.length > MAX ? <li className="px-1 py-2 text-[11px] text-neutral-400">Showing the first {MAX} of {hits.length}. Type in the search box to narrow.</li> : null}
      </ul>
    </div>
  );
}

/** The head unit switches to one column whenever ITS OWN box is narrower than 640 px (the desktop dock drawer is ~430 px wide even on a wide screen, so a viewport breakpoint squeezes it). */
const narrowObservers = new WeakMap<Element, ResizeObserver>();
function observeNarrow(el: HTMLElement | null): void {
  if (!el || narrowObservers.has(el)) return;
  const apply = (): void => { el.dataset.narrow = el.clientWidth < 640 ? '1' : '0'; };
  apply();
  if (typeof ResizeObserver === 'undefined') return;
  const ro = new ResizeObserver(apply);
  ro.observe(el);
  narrowObservers.set(el, ro);
}
function tileColor(id: string, name?: string): string {
  return getStationTheme(id, name).color;
}

/** Five hardware-style presets: tap to tune, press and hold (half a second) to save the station that is playing. */
export function RadioPresetsBar({ station, info, live, onPlay, onPresetTuned, wide = false, initialView, defaultView = 'wall', deckSources, nowPlaying, playingNow }: RadioPresetsBarProps): ReactElement {
  const presets: RadioPresetMap = useRadioPresets();
  const [status, setStatus] = useState<string>('');
  const [holding, setHolding] = useState<RadioPresetSlot | null>(null);
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  const [menu, setMenu] = useState<RadioPresetSlot | null>(null);
  const [bank, setBank] = useState<'presets' | 'recent'>('presets');
  const [recents, setRecents] = useState<RecentStation[]>([]);
  const [view, setViewState] = useState<PresetView>(() => initialView ?? readPresetView(undefined, defaultView));
  const [preview, setPreview] = useState<string | null>(null); // head unit: key hovered/focused, shown on the LCD
  const setView = useCallback((next: PresetView) => {
    setViewState(next);
    try { window.localStorage.setItem(PRESET_VIEW_KEY, next); } catch { /* blocked storage: the choice just is not remembered */ }
  }, []);
  const [knobAngle, setKnobAngle] = useState(0); // knob art only: turns one detent per station step
  const [mode, setMode] = useState<'live' | 'archive' | 'podcasts'>('live');
  const [sub, setSub] = useState<'music' | 'concerts'>('music');
  const [browse, setBrowse] = useState(false); // non-live tabs: false = my saved keys, true = pages of the catalog
  const audioPresets = useAudioPresets();
  const [listPage, setListPage] = useState(0);
  const [storeArmed, setStoreArmed] = useState(false); // head unit: STORE pressed, next preset key saves the playing station
  const [vol, setVol] = useState(1);
  const [hasPlayer, setHasPlayer] = useState(false);
  const volDrag = useRef<number | null>(null);
  useEffect(() => {
    const media = document.getElementById('persistent-player') as HTMLMediaElement | null;
    setHasPlayer(Boolean(media));
    if (!media) return undefined;
    setVol(media.volume);
    const onVol = () => setVol(media.volume);
    media.addEventListener('volumechange', onVol);
    return () => media.removeEventListener('volumechange', onVol);
  }, []);
  const setVolume = useCallback((next: number) => {
    const clamped = Math.min(1, Math.max(0, next));
    const media = document.getElementById('persistent-player') as HTMLMediaElement | null;
    if (media) media.volume = clamped;
    setVol(clamped);
  }, []);
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
  const assignLive = useCallback((slot: RadioPresetSlot): boolean => {
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
  const audioBank: AudioBank | null = mode === 'live' ? null : mode === 'podcasts' ? 'podcasts' : sub;
  const modeItems: DeckItem[] = audioBank === 'music' ? (deckSources?.music ?? []) : audioBank === 'concerts' ? (deckSources?.concerts ?? []) : audioBank === 'podcasts' ? (deckSources?.podcasts ?? []) : [];
  const playingItem = (it: DeckItem): boolean => Boolean(nowPlaying?.programId && nowPlaying.programId.startsWith(`${it.id}::`));
  const bankLabel = audioBank === 'music' ? 'Archive Music' : audioBank === 'concerts' ? 'Live Concerts' : 'Podcasts';
  const turn = useCallback((dir: 1 | -1) => {
    if (mode === 'live') { stepStation(dir); return; }
    if (!modeItems.length) { say(audioBank === 'concerts' && !deckSources?.concerts ? 'Concerts are still loading…' : `${bankLabel}: nothing loaded yet.`); return; }
    const cur = modeItems.findIndex((x) => nowPlaying?.programId?.startsWith(`${x.id}::`));
    const next = modeItems[cur < 0 ? (dir > 0 ? 0 : modeItems.length - 1) : (cur + dir + modeItems.length) % modeItems.length];
    setKnobAngle((a) => a + dir * 36);
    next.play();
    say(`Playing ${next.title}`);
  }, [mode, modeItems, audioBank, bankLabel, deckSources?.concerts, nowPlaying?.programId, stepStation, say]);

  /** Stores whatever is playing from this tab onto a key of this tab's bank. Refuses (and says why) when nothing from this tab is playing. */
  const assignAudio = useCallback((slot: RadioPresetSlot): boolean => {
    if (!audioBank) return false;
    const it = modeItems.find((x) => nowPlaying?.programId?.startsWith(`${x.id}::`));
    if (!it) { say(`Play something from ${bankLabel} first, then press STORE and a key.`); return false; }
    const res = saveAudioPreset(audioBank, slot, it.preset);
    if (!res.saved) { say('This could not be saved to a preset.'); return false; }
    try { navigator.vibrate?.(30); } catch { /* no haptics */ }
    say(`Saved to ${bankLabel} key ${slot}: ${it.title}`);
    return true;
  }, [audioBank, modeItems, nowPlaying?.programId, bankLabel, say]);
  const assign = useCallback((slot: RadioPresetSlot): boolean => (mode === 'live' ? assignLive(slot) : assignAudio(slot)), [mode, assignLive, assignAudio]);
  const playAudioPreset = useCallback((p: AudioPreset) => {
    const it = modeItems.find((x) => x.id === p.itemId);
    if (it) { it.play(); return; }
    onPlay(p.src, p.title, p.subtitle, 'audio', p.channelId, p.guideId ?? 'audio-podcasts', p.programId);
  }, [modeItems, onPlay]);

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
    if (mode !== 'live') {
      if (storeArmed) { setStoreArmed(false); assignAudio(slot); return; }
      const ap = audioBank ? audioPresets[audioBank][slot] : undefined;
      if (ap) { playAudioPreset(ap); return; }
      say(`${bankLabel} key ${slot} is empty. Play something here, then press & hold the key (or STORE then the key).`);
      return;
    }
    if (storeArmed) { setStoreArmed(false); assign(slot); return; }
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
      {view !== 'unit' && (
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
      )}
      {view === 'unit' ? (
      <div data-testid="radio-head-unit" className="relative mx-auto my-4 w-[calc(100%-1.5rem)] max-w-[1000px] overflow-hidden rounded-[28px] p-4 sm:p-7"
        style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.13), rgba(255,255,255,0.04) 55%, rgba(255,255,255,0.08))', backdropFilter: 'blur(22px) saturate(140%)', WebkitBackdropFilter: 'blur(22px) saturate(140%)', border: '1px solid rgba(255,255,255,0.18)', boxShadow: '0 0 0 1px rgba(224,109,59,0.45), 0 0 46px rgba(224,109,59,0.30), 0 28px 70px rgba(0,0,0,0.65), inset 0 1px 1px rgba(255,255,255,0.28)' }}>
        <span aria-hidden="true" className="pointer-events-none absolute -left-16 -top-16 h-56 w-56 rounded-full" style={{ background: 'radial-gradient(circle, rgba(224,109,59,0.40), transparent 70%)', filter: 'blur(26px)' }} />
        <span aria-hidden="true" className="pointer-events-none absolute -bottom-20 right-10 h-64 w-64 rounded-full" style={{ background: 'radial-gradient(circle, rgba(249,115,22,0.28), transparent 70%)', filter: 'blur(30px)' }} />
        {(() => {
          const nowTheme = playing ? getStationTheme(playing.channelId ?? '', playing.title, info?.logo ?? getStationArt(playing.channelId)) : null;
          const nowLogo = playing ? (info?.logo ?? getStationArt(playing.channelId)) : undefined;
          const accent = nowTheme?.accentColor ?? '#E06D3B';
          const curItem = mode === 'live' ? undefined : modeItems.find((x) => playingItem(x));
          const lampOn = mode === 'live' ? (live || Boolean(playingNow && nowPlaying?.title)) : Boolean(playingNow && curItem);
          const loadingConcerts = audioBank === 'concerts' && !deckSources?.concerts && !deckSources?.concertsError;
          const line2 = mode === 'live' ? (preview ?? playing?.title ?? (playingNow ? nowPlaying?.title : undefined) ?? 'No station') : (preview ?? curItem?.title ?? (loadingConcerts ? 'Loading concerts…' : modeItems.length ? `${bankLabel}` : (deckSources?.concertsError && audioBank === 'concerts' ? 'Concerts unavailable' : 'Nothing loaded')));
          const line3Base = mode === 'live' ? (preview ? '' : (playing?.subtitle ?? (playing ? '' : (playingNow && nowPlaying?.title ? 'Not a live station. Pick one below or press a preset' : 'Pick a station or press a preset')))) : (deckSources?.concertsError && audioBank === 'concerts' && !modeItems.length ? deckSources.concertsError : curItem?.subtitle ?? `${modeItems.length} to choose from · keys are your saved ${bankLabel.toLowerCase()}`);
          const line3 = status || line3Base;
          const glassKey = 'relative flex h-16 min-w-0 flex-1 select-none flex-col items-center justify-center gap-0.5 overflow-hidden rounded-xl border text-center touch-manipulation cursor-pointer active:scale-95 motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ajn-accent)]';
          const keyBg = { background: 'linear-gradient(180deg, rgba(255,255,255,0.16), rgba(255,255,255,0.05))', boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.3), 0 4px 10px rgba(0,0,0,0.45)' } as const;
          const modeBtn = (label: string, key: 'live' | 'archive' | 'podcasts') => {
            const selected = mode === key;
            return (
              <button key={key} type="button" data-testid={`radio-mode-${key}`} aria-pressed={selected}
                onClick={() => { setMode(key); setListPage(0); setBrowse(false); setStoreArmed(false); if (key === 'archive' && sub === 'concerts') deckSources?.loadConcerts?.(); if (key === 'podcasts') deckSources?.loadSpoken?.(); say(key === 'live' ? 'Live Radio' : key === 'archive' ? `Archive Music: ${sub === 'concerts' ? 'live concerts' : 'music channels'}` : 'Podcasts'); }}
                className={`min-h-[44px] flex-1 cursor-pointer rounded-lg px-3 text-sm font-semibold touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ajn-accent)] ${selected ? 'border border-[#E06D3B] bg-[#E06D3B]/15 text-white' : 'border border-transparent text-neutral-300 hover:text-white'}`}>{label}</button>
            );
          };
          const volAngle = -135 + vol * 270;
          return (
            <div ref={observeNarrow} data-testid="radio-head-unit-grid" className="relative grid grid-cols-[minmax(0,1fr)] gap-5 md:grid-cols-[minmax(0,1fr)_270px] md:gap-x-8">
              <div className="space-y-4 md:col-start-1 md:row-start-1">
                <div data-testid="radio-head-unit-lcd" className="flex min-h-[112px] items-stretch gap-3 rounded-2xl p-4"
                  style={{ background: 'linear-gradient(180deg, rgba(15,17,23,0.55), rgba(15,17,23,0.35))', border: '1px solid rgba(255,255,255,0.18)', boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.45), 0 1px 1px rgba(255,255,255,0.12)' }}>
                  <div className="flex min-w-0 flex-1 flex-col justify-between gap-1">
                    <div className="flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-widest text-neutral-300">
                      <span className="min-w-0 truncate">AJN-1 · {mode === 'live' ? (bank === 'presets' ? 'My presets' : 'Recent') : browse ? `${bankLabel} · browse` : `${bankLabel} · my keys`}</span>
                      <span data-testid="radio-head-unit-lamp" className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1 text-xs font-black tracking-wider ${lampOn ? 'border-red-400/70 bg-red-500/15 text-red-200' : 'border-white/20 bg-white/5 text-neutral-300'}`} style={lampOn ? { boxShadow: '0 0 14px rgba(239,68,68,0.55)' } : undefined}>
                        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${lampOn ? 'bg-red-400 animate-pulse motion-reduce:animate-none' : 'bg-neutral-500'}`} />{mode === 'live' ? (live ? 'ON AIR' : (playingNow && nowPlaying?.title ? 'PLAYING' : 'OFF AIR')) : (lampOn ? 'PLAYING' : 'STOPPED')}
                      </span>
                    </div>
                    <p className="truncate text-2xl font-semibold leading-tight text-white sm:text-[28px]">{line2}</p>
                    <p className="truncate text-sm text-neutral-300">{line3}</p>
                  </div>
                  {nowLogo && !broken.has(playing?.channelId ?? '') ? (
                    <div aria-hidden="true" className="hidden h-14 w-14 shrink-0 items-center justify-center self-center overflow-hidden rounded-lg border border-white/20 bg-black/30 sm:flex">
                      <img src={nowLogo} alt="" draggable={false} referrerPolicy="no-referrer" className="h-full w-full object-contain" onError={() => setBroken((prev) => new Set(prev).add(playing?.channelId ?? ''))} />
                    </div>
                  ) : null}
                </div>
                <div role="group" aria-label="Radio source" className="flex gap-1 rounded-xl p-1" style={{ background: 'rgba(15,17,23,0.45)', border: '1px solid rgba(255,255,255,0.12)' }}>
                  {modeBtn('Live Radio', 'live')}{modeBtn('Archive Music', 'archive')}{modeBtn('Podcasts', 'podcasts')}
                </div>
                {mode === 'archive' && (
                  <div role="group" aria-label="Archive source" className="flex gap-1">
                    {([['music', 'Music channels'], ['concerts', 'Live concerts']] as const).map(([k, text]) => (
                      <button key={k} type="button" data-testid={`radio-sub-${k}`} aria-pressed={sub === k}
                        onClick={() => { setSub(k); setListPage(0); setBrowse(false); setStoreArmed(false); if (k === 'concerts') deckSources?.loadConcerts?.(); }}
                        className={`min-h-[36px] cursor-pointer rounded-full px-3 text-xs font-semibold touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ajn-accent)] ${sub === k ? 'border border-[#E06D3B] bg-[#E06D3B]/15 text-white' : 'border border-white/15 text-neutral-300 hover:text-white'}`}>{text}</button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-col items-center gap-3 md:col-start-2 md:row-start-1 md:row-span-1">
                <div className="relative h-[250px] w-[250px] shrink-0">
                  <svg viewBox="0 0 200 200" aria-hidden="true" className="absolute inset-0 h-full w-full">
                    <circle cx="100" cy="100" r="97" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.22)" />
                    <circle cx="100" cy="100" r="74" fill="none" stroke="rgba(224,109,59,0.55)" strokeWidth="1.2" />
                    {Array.from({ length: 20 }, (_, i) => {
                      const a = ((i + 1) * 18 - 90) * Math.PI / 180;
                      return <text key={i} x={100 + 85 * Math.cos(a)} y={100 + 85 * Math.sin(a) + 3} textAnchor="middle" fontSize="8.5" fontWeight="700" fill="rgba(255,255,255,0.8)">{i + 1}</text>;
                    })}
                    <g transform={`rotate(${knobAngle / 2} 100 100)`}><rect x="98" y="5" width="4" height="10" rx="2" fill="#F97316" /></g>
                  </svg>
                  <button type="button" data-testid="radio-head-unit-knob" aria-label={`Tune knob: turn or press for the next station in ${bank === 'presets' ? 'My presets' : 'Recent'}. Arrow keys step back and forward.`}
                    onPointerDown={(e) => { knobDrag.current = { x: e.clientX, acc: 0 }; knobMoved.current = false; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* capture is optional */ } }}
                    onPointerMove={(e) => {
                      const d = knobDrag.current; if (!d) return;
                      d.acc += e.clientX - d.x; d.x = e.clientX;
                      while (Math.abs(d.acc) >= 24) { const dir = d.acc > 0 ? 1 : -1; d.acc -= dir * 24; knobMoved.current = true; turn(dir); }
                    }}
                    onPointerUp={() => { knobDrag.current = null; }} onPointerCancel={() => { knobDrag.current = null; }}
                    onClick={() => { if (knobMoved.current) { knobMoved.current = false; return; } turn(1); }}
                    onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); turn(1); } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); turn(-1); } }}
                    onWheel={(e) => { if (e.deltaY) turn(e.deltaY > 0 ? 1 : -1); }}
                    className="absolute left-1/2 top-1/2 h-[132px] w-[132px] -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none select-none rounded-full p-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ajn-accent)]"
                    style={{ background: 'linear-gradient(180deg,#c9825f 0%,#E06D3B 40%,#7a3a20 100%)', boxShadow: '0 10px 26px rgba(0,0,0,0.75), 0 0 22px rgba(224,109,59,0.45), inset 0 1px 2px rgba(255,255,255,0.5)' }}>
                    <span aria-hidden="true" className="relative block h-full w-full rounded-full transition-transform duration-150 motion-reduce:transition-none"
                      style={{ transform: `rotate(${knobAngle}deg)`, background: 'conic-gradient(from 180deg at 50% 50%, #3b4150 0deg, #aab1bd 45deg, #3b4150 90deg, #1f2430 135deg, #aab1bd 180deg, #3b4150 225deg, #1f2430 270deg, #aab1bd 315deg, #3b4150 360deg)', boxShadow: 'inset 0 2px 3px rgba(255,255,255,0.45), inset 0 -4px 8px rgba(0,0,0,0.8)' }}>
                      <span className="absolute left-1/2 top-1.5 h-5 w-1.5 -translate-x-1/2 rounded-full bg-amber-400" style={{ boxShadow: '0 0 10px #F97316' }} />
                    </span>
                  </button>
                </div>
                <div className="sr-only focus-within:not-sr-only focus-within:flex focus-within:gap-2">
                  <button type="button" data-testid="radio-head-unit-prev" aria-label="Previous station" onClick={() => turn(-1)} className="rounded border border-white/30 px-3 py-2 text-xs text-white">Previous</button>
                  <button type="button" data-testid="radio-head-unit-next" aria-label="Next station" onClick={() => turn(1)} className="rounded border border-white/30 px-3 py-2 text-xs text-white">Next</button>
                </div>
              </div>

              <div className="space-y-2 md:col-start-1 md:row-start-2">
                <div className="flex flex-col items-stretch gap-2 sm:flex-row">
                  {mode !== 'live' && !browse ? (
                  <div className="grid flex-1 grid-cols-5 gap-2">
                    {AUDIO_SLOTS.map((slot) => {
                      const ap = audioBank ? audioPresets[audioBank][slot] : undefined;
                      const act = Boolean(ap && nowPlaying?.programId?.startsWith(`${ap.itemId}::`));
                      return (
                        <button key={slot} type="button" data-testid={`radio-audio-preset-${slot}`} data-filled={ap ? 'true' : 'false'} aria-current={act ? 'true' : undefined}
                          aria-label={ap ? `${bankLabel} key ${slot}: ${ap.title}. Tap to play. Press and hold to replace with what is playing.` : `${bankLabel} key ${slot}, empty. Play something, then press and hold to save it here.`}
                          onPointerDown={onPointerDown(slot)} onPointerMove={onPointerMove} onPointerUp={cancelHold} onPointerCancel={cancelHold} onPointerLeave={cancelHold}
                          onClick={onClick(slot)} onKeyDown={onKeyDown(slot)}
                          onMouseEnter={() => ap && setPreview(ap.title)} onMouseLeave={() => setPreview(null)} onFocus={() => ap && setPreview(ap.title)} onBlur={() => setPreview(null)}
                          style={act ? { ...keyBg, background: 'linear-gradient(180deg, rgba(224,109,59,0.30), rgba(224,109,59,0.08))' } : keyBg}
                          className={`${glassKey} ${act ? 'border-[#E06D3B] text-white' : ap ? 'border-white/25 text-white hover:border-[#E06D3B]/70' : 'border-dashed border-white/20 text-neutral-400'}`}>
                          {isHoldingSlot(slot) && <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-[2] rounded-xl ring-2 ring-[#E06D3B]" style={{ animation: `ajnPresetFill ${HOLD_MS}ms linear forwards`, background: 'rgba(224,109,59,0.22)' }} />}
                          <span aria-hidden="true" className={`text-lg font-semibold leading-none ${act ? 'text-[#F9A56D]' : ''}`}>{String(slot).padStart(2, '0')}</span>
                          <span aria-hidden="true" className="w-full truncate px-1 text-[10px] leading-none text-neutral-300">{ap?.title ?? '+'}</span>
                        </button>
                      );
                    })}
                  </div>
                  ) : mode !== 'live' ? (
                  <div className="grid flex-1 grid-cols-5 gap-2">
                    {RADIO_PRESET_SLOTS.map((slot) => {
                      const it = modeItems[listPage * 5 + slot - 1];
                      const act = Boolean(it && playingItem(it));
                      return (
                        <button key={slot} type="button" data-testid={`radio-deck-item-${slot}`} disabled={!it} aria-label={it ? `Play ${it.title}` : `Slot ${slot}, empty`} title={it?.title}
                          onClick={() => it && it.play()} onMouseEnter={() => it && setPreview(it.title)} onMouseLeave={() => setPreview(null)} onFocus={() => it && setPreview(it.title)} onBlur={() => setPreview(null)}
                          style={act ? { ...keyBg, background: 'linear-gradient(180deg, rgba(224,109,59,0.30), rgba(224,109,59,0.08))' } : keyBg}
                          className={`${glassKey} ${act ? 'border-[#E06D3B] text-white' : it ? 'border-white/25 text-white hover:border-[#E06D3B]/70' : 'border-dashed border-white/20 text-neutral-500'} disabled:cursor-default`}>
                          <span aria-hidden="true" className={`text-lg font-semibold leading-none ${act ? 'text-[#F9A56D]' : ''}`}>{String(listPage * 5 + slot).padStart(2, '0')}</span>
                          <span aria-hidden="true" className="w-full truncate px-1 text-[10px] leading-none text-neutral-300">{it?.title ?? '–'}</span>
                        </button>
                      );
                    })}
                  </div>
                  ) : (
                  <div className="grid flex-1 grid-cols-5 gap-2">
                    {RADIO_PRESET_SLOTS.map((slot) => {
                      const p = bank === 'presets' ? presets[slot] : undefined;
                      const r = bank === 'recent' ? recents[slot - 1] : undefined;
                      const id = p?.channelId ?? r?.channelId;
                      const title = p?.title ?? r?.title;
                      const active = Boolean(id && playing && id === playing.channelId);
                      const keyCls = `${glassKey} ${active ? 'border-[#E06D3B] text-white' : id ? 'border-white/25 text-white hover:border-[#E06D3B]/70' : 'border-dashed border-white/20 text-neutral-400'}`;
                      const keyStyle = active ? { ...keyBg, boxShadow: '0 0 16px rgba(224,109,59,0.55), inset 0 1px 1px rgba(255,255,255,0.3)', background: 'linear-gradient(180deg, rgba(224,109,59,0.30), rgba(224,109,59,0.08))' } : keyBg;
                      const body = (
                        <>
                          {isHoldingSlot(slot) && <span aria-hidden="true" data-testid="radio-preset-hold" className="pointer-events-none absolute inset-0 z-[2] rounded-xl ring-2 ring-[#E06D3B]" style={{ animation: `ajnPresetFill ${HOLD_MS}ms linear forwards`, background: 'rgba(224,109,59,0.25)' }} />}
                          <span aria-hidden="true" className={`text-lg font-semibold leading-none ${active ? 'text-[#F9A56D]' : ''}`}>{String(slot).padStart(2, '0')}</span>
                          <span aria-hidden="true" className="w-full truncate px-1 text-[10px] leading-none text-neutral-300">{title ?? '+'}</span>
                          {active && live && <span aria-hidden="true" data-testid="radio-preset-live" className="ajn-live-dot absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse motion-reduce:animate-none" />}
                        </>
                      );
                      const hover = { onMouseEnter: () => title && setPreview(title), onFocus: () => title && setPreview(title), onMouseLeave: () => setPreview(null), onBlur: () => setPreview(null) };
                      if (bank === 'recent') {
                        return (
                          <button key={slot} type="button" data-testid={`radio-recent-${slot}`} disabled={!r} aria-current={active ? 'true' : undefined}
                            aria-label={r ? `${r.title}${active ? (live ? ', playing now' : ', current station') : ''}. Tap to tune.` : `Recent ${slot}, empty`}
                            onClick={() => r && tuneRecent(r)} {...hover} style={keyStyle} className={`${keyCls} disabled:cursor-default`}>{body}</button>
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
                          {...hover} style={keyStyle} className={keyCls}>{body}</button>
                      );
                    })}
                  </div>
                  )}
                  <div className="flex h-11 w-full shrink-0 overflow-hidden rounded-xl border border-white/25 sm:h-auto sm:w-[104px]" style={keyBg}>
                    <button type="button" data-testid="radio-preset-bank" aria-label={`Bank: ${bank === 'presets' ? 'My presets' : 'Recent'}. Press to switch.`}
                      onClick={() => { if (mode === 'live') openBank(bank === 'presets' ? 'recent' : 'presets'); else if (!browse) { setBrowse(true); setListPage(0); say(`${bankLabel}: browsing, 5 at a time`); } else if (modeItems.length > (listPage + 1) * 5) setListPage((pg) => pg + 1); else { setBrowse(false); setListPage(0); say(`${bankLabel}: my keys`); } }}
                      className="flex-1 cursor-pointer text-[11px] font-bold tracking-wider text-neutral-100 hover:text-white touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ajn-accent)]">BANK</button>
                    <button type="button" data-testid="radio-preset-store" aria-pressed={storeArmed} aria-label="Store: press, then a preset key, to save the playing station"
                      onClick={() => { if (mode === 'live' && !playing) { say('Play a station first, then press Store and a preset key.'); return; } if (mode !== 'live' && browse) { setBrowse(false); } setStoreArmed((v) => !v); say(storeArmed ? 'Store cancelled' : 'Store armed: press a preset key'); }}
                      className={`flex-1 cursor-pointer border-l border-white/20 text-[11px] font-bold tracking-wider touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ajn-accent)] ${storeArmed ? 'bg-[#E06D3B] text-[#0F1117]' : 'text-neutral-100 hover:text-white'}`}>STORE</button>
                  </div>
                </div>
              </div>

              <div className="flex items-end justify-around gap-4 md:col-start-2 md:row-start-2">
                <div className="flex flex-col items-center gap-1.5">
                  <button type="button" role="slider" data-testid="radio-volume-knob" aria-label="Volume" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(vol * 100)} aria-disabled={!hasPlayer}
                    onPointerDown={(e) => { volDrag.current = e.clientX; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* optional */ } }}
                    onPointerMove={(e) => { if (volDrag.current === null) return; const dx = e.clientX - volDrag.current; volDrag.current = e.clientX; setVolume(vol + dx / 140); }}
                    onPointerUp={() => { volDrag.current = null; }} onPointerCancel={() => { volDrag.current = null; }}
                    onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); setVolume(vol + 0.05); } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); setVolume(vol - 0.05); } }}
                    onWheel={(e) => { if (e.deltaY) setVolume(vol + (e.deltaY < 0 ? 0.05 : -0.05)); }}
                    className="relative h-16 w-16 cursor-ew-resize touch-none rounded-full p-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ajn-accent)]"
                    style={{ background: `conic-gradient(from -135deg, #E06D3B ${vol * 270}deg, rgba(255,255,255,0.18) ${vol * 270}deg 270deg, transparent 270deg)`, boxShadow: '0 6px 16px rgba(0,0,0,0.6)' }}>
                    <span aria-hidden="true" className="relative block h-full w-full rounded-full" style={{ background: 'conic-gradient(from 180deg, #3b4150, #8d94a1, #3b4150, #1f2430, #8d94a1, #3b4150)', transform: `rotate(${volAngle}deg)`, boxShadow: 'inset 0 2px 2px rgba(255,255,255,0.4), inset 0 -3px 6px rgba(0,0,0,0.7)' }}>
                      <span className="absolute left-1/2 top-1 h-3 w-1 -translate-x-1/2 rounded-full bg-amber-400" />
                    </span>
                  </button>
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-neutral-300">Volume</span>
                </div>
                <div className="flex flex-col items-center gap-1.5">
                  <button type="button" data-testid="radio-bank-select" aria-label={`Bank select: ${bank === 'presets' ? 'My presets' : 'Recent'}. Press to switch.`} onClick={() => { if (mode === 'live') openBank(bank === 'presets' ? 'recent' : 'presets'); else if (!browse) { setBrowse(true); setListPage(0); } else if (modeItems.length > (listPage + 1) * 5) setListPage((pg) => pg + 1); else { setBrowse(false); setListPage(0); } }}
                    className="relative h-16 w-16 cursor-pointer rounded-full p-1.5 touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ajn-accent)]"
                    style={{ background: 'linear-gradient(180deg,#c9825f,#7a3a20)', boxShadow: '0 6px 16px rgba(0,0,0,0.6)' }}>
                    <span aria-hidden="true" className="relative block h-full w-full rounded-full transition-transform duration-200 motion-reduce:transition-none" style={{ transform: `rotate(${bank === 'presets' ? -40 : 40}deg)`, background: 'conic-gradient(from 180deg, #3b4150, #8d94a1, #3b4150, #1f2430, #8d94a1, #3b4150)', boxShadow: 'inset 0 2px 2px rgba(255,255,255,0.4), inset 0 -3px 6px rgba(0,0,0,0.7)' }}>
                      <span className="absolute left-1/2 top-1 h-3 w-1 -translate-x-1/2 rounded-full bg-amber-400" />
                    </span>
                  </button>
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-neutral-300">Bank select</span>
                </div>
              </div>
            </div>
          );
        })()}
        {mode !== 'live' && (
          <DeckPicker label={bankLabel} items={modeItems} playingItem={playingItem}
            note={audioBank === 'concerts' ? (deckSources?.concertsError ?? (!deckSources?.concerts ? 'Loading concerts…' : undefined)) : audioBank === 'podcasts' ? deckSources?.podcastsNote : undefined}
            onPick={(it) => { it.play(); setKnobAngle((a) => a + 36); say(`Playing ${it.title}`); }} />
        )}
        <div className="relative mt-3 flex justify-end">
          <button type="button" data-testid="radio-view-wall" onClick={() => setView('wall')} className="cursor-pointer rounded-md px-2 py-1 text-[11px] text-neutral-400 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ajn-accent)]">Show wall view</button>
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
                  <span className="line-clamp-2 text-[10px] leading-tight text-neutral-400">{playing ? `+ Save "${playing.title}" here` : 'Play a station, then hold to save.'}</span>
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
      <style>{`[data-narrow="1"]{grid-template-columns:minmax(0,1fr)!important}[data-narrow="1"]>*{grid-column:1!important;grid-row:auto!important}[data-testid^="radio-"]:focus-visible{outline:2px solid #F97316!important;outline-offset:3px}[data-testid="radio-volume-knob"]:focus-visible,[data-testid="radio-bank-select"]:focus-visible,[data-testid="radio-head-unit-knob"]:focus-visible{outline:3px solid #fff!important;outline-offset:-5px}@keyframes ajnPresetFill{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}@media (prefers-reduced-motion:reduce){[data-testid="radio-preset-hold"]{animation:none!important}}`}</style>
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
