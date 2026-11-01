import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import { Radio, X, ChevronDown, Play, Pause, Volume2, VolumeX, Maximize2, Expand, Shrink } from 'lucide-react';
import type { Destination, NowPlayingMedia, PlayProgramCallback } from '../types';
import { usePersistentMedia } from '../hooks/usePersistentMedia';
import { useIdleFade } from '../hooks/useIdleFade';
import { RADIO_DOCK_EVENT, type RadioDockAction } from '../utils/radioDock';
import { readRecentStations, recordRecentStation, type RecentStation } from '../utils/radioRecent';
import { LiveRadioDirectory, type LiveRadioItem } from './LiveRadioDirectory';
import { RadioPresetsBar } from './RadioPresetsBar';
import { RadioStationGroup } from './RadioStationGroup';
import { useStationTheme } from '../utils/stationArt';
import { stationGradient } from '../utils/radioAccents';

interface RadioDockProps {
  nowPlaying: NowPlayingMedia | null;
  /** Plays a station WITHOUT leaving the current page (the page's own "stay" play callback). */
  onPlay: PlayProgramCallback;
  onNavigate: (dest: Destination) => void;
  /** True when the bottom mini player is on screen, so the button sits above it. */
  miniPlayerShowing: boolean;
}

const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP_PX = 10;
const RIPPLE_MS = 600;

const isStation = (m: NowPlayingMedia | null): m is NowPlayingMedia => Boolean(m?.channelId?.startsWith('radio:'));

/** Radio button + small panel. Lives above every page, so the sound and the controls never depend on which page is open. */
export function RadioDock({ nowPlaying, onPlay, onNavigate, miniPlayerShowing }: RadioDockProps): ReactElement {
  const [open, setOpen] = useState<boolean>(false);
  const [everOpened, setEverOpened] = useState<boolean>(false); // keep filters and page once opened; mount lazily so startup stays light
  const [full, setFull] = useState<boolean>(false); // full-screen Radio: more stations and sectors in view
  const [tuned, setTuned] = useState<LiveRadioItem | null>(null);
  const [presetTuned, setPresetTuned] = useState<{ id: string; logo?: string } | null>(null); // a preset was tapped: show its picture
  const [btnHold, setBtnHold] = useState<boolean>(false); // a mouse is over the button, or the keyboard is on it: never fade then
  const [menuOpen, setMenuOpen] = useState<boolean>(false); // long-press quick menu: switch station without leaving the page
  const [recents, setRecents] = useState<RecentStation[]>([]);
  const [ripples, setRipples] = useState<Array<{ id: number; x: number; y: number; size: number }>>([]);
  const btnFaded = useIdleFade(btnHold || menuOpen, 12000);
  const rippleId = useRef(0);
  const pressTimer = useRef<number | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const pressFired = useRef(false); // the long press already opened the menu: swallow the click that follows the release
  const menuRef = useRef<HTMLDivElement>(null);

  const show = useCallback(() => { setMenuOpen(false); setOpen(true); setEverOpened(true); }, []);
  const hide = useCallback(() => { setOpen(false); setFull(false); }, []);

  useEffect(() => {
    const onAction = (e: Event) => {
      const action = (e as CustomEvent<RadioDockAction>).detail;
      if (action === 'close') hide();
      else if (action === 'toggle') setOpen((o) => { if (!o) setEverOpened(true); return !o; });
      else show();
    };
    window.addEventListener(RADIO_DOCK_EVENT, onAction);
    return () => window.removeEventListener(RADIO_DOCK_EVENT, onAction);
  }, [hide, show]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (full) setFull(false); else hide(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, hide, full]);

  // Focus: opening moves it into the panel (search box on desktop; the close button on a phone so the keyboard does not pop up);
  // closing hands it back to the Radio button.
  const wasOpen = useRef<boolean>(false);
  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => {
        const panel = document.getElementById('radio-dock-panel');
        const phone = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 768;
        const target = (!phone && panel?.querySelector<HTMLElement>('[data-testid="live-radio-search"]')) || panel?.querySelector<HTMLElement>('[data-testid="radio-dock-close"]');
        target?.focus();
      }, 60);
      wasOpen.current = true;
      return () => window.clearTimeout(t);
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      window.setTimeout(() => document.getElementById('radio-dock-button')?.focus(), 0);
    }
    return undefined;
  }, [open]);

  const station = isStation(nowPlaying) ? nowPlaying : null;
  const media = usePersistentMedia('audio', station ? `${station.src}|audio` : undefined, Boolean(station));
  const live = Boolean(station) && media.attached && !media.paused;
  const theme = useStationTheme(station?.channelId, station?.title); // the playing station's colours, or null
  const art = station && tuned && tuned.id === station.channelId ? tuned : null;
  const nowLogo = art?.logo ?? (station && presetTuned && presetTuned.id === station.channelId ? presetTuned.logo : undefined);

  // Remember stations as they start, so the quick menu has something real to offer.
  const stationId = station?.channelId;
  useEffect(() => {
    if (!station || !stationId) return;
    recordRecentStation({ channelId: stationId, src: station.src, title: station.title, subtitle: station.subtitle, programId: station.programId, guideId: station.guideId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationId]);

  const cancelPress = useCallback(() => {
    if (pressTimer.current !== null) { window.clearTimeout(pressTimer.current); pressTimer.current = null; }
    pressStart.current = null;
  }, []);
  const openMenu = useCallback(() => { setRecents(readRecentStations()); setMenuOpen(true); }, []);
  const closeMenu = useCallback((refocus = false) => {
    setMenuOpen(false);
    if (refocus) window.setTimeout(() => document.getElementById('radio-dock-button')?.focus(), 0);
  }, []);
  useEffect(() => () => cancelPress(), [cancelPress]);

  const onBtnPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Ripple from the exact point of contact.
    const r = e.currentTarget.getBoundingClientRect();
    const id = ++rippleId.current;
    setRipples((list) => [...list.slice(-3), { id, x: e.clientX - r.left, y: e.clientY - r.top, size: Math.max(r.width, r.height) * 2 }]);
    window.setTimeout(() => setRipples((list) => list.filter((x) => x.id !== id)), RIPPLE_MS + 50);
    // Long press: hold still for half a second.
    cancelPress();
    pressFired.current = false;
    pressStart.current = { x: e.clientX, y: e.clientY };
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      pressFired.current = true;
      try { navigator.vibrate?.(15); } catch { /* no haptics on this device */ }
      openMenu();
    }, LONG_PRESS_MS);
  };
  const onBtnPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const st = pressStart.current;
    if (st && Math.hypot(e.clientX - st.x, e.clientY - st.y) > LONG_PRESS_SLOP_PX) cancelPress();
  };
  const onBtnClick = () => {
    if (pressFired.current) { pressFired.current = false; return; }
    show();
  };

  // Quick menu: focus the first item, Escape / outside press closes, arrow keys move.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const t = window.setTimeout(() => menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus(), 30);
    const onDown = (e: PointerEvent) => { const t2 = e.target as Node; if (!menuRef.current?.contains(t2) && !(t2 as HTMLElement).closest?.('#radio-dock-button')) closeMenu(); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement as HTMLElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => { window.clearTimeout(t); window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey); };
  }, [menuOpen, closeMenu]);

  const switchTo = (r: RecentStation) => {
    closeMenu();
    onPlay(r.src, r.title, r.subtitle, 'audio', r.channelId, r.guideId ?? 'audio-podcasts', r.programId);
  };
  const menuLift = miniPlayerShowing ? 'bottom-[12.5rem] sm:bottom-[13.5rem] md:bottom-[9.5rem]' : 'bottom-[8.5rem] sm:bottom-[9.25rem] md:bottom-[5.25rem]';

  // The button rides above the bottom nav (phone) and above the mini player when it is showing.
  const lift = miniPlayerShowing ? 'bottom-[9.5rem] sm:bottom-[10.5rem] md:bottom-[6.5rem]' : 'bottom-[4.75rem] sm:bottom-[5.5rem] md:bottom-6';

  return (
    <>
      {!open && (
        <button type="button" id="radio-dock-button" data-testid="radio-dock-button" onClick={onBtnClick} aria-expanded={false} aria-controls="radio-dock-panel" aria-haspopup="menu"
          onPointerDown={onBtnPointerDown} onPointerMove={onBtnPointerMove} onPointerUp={cancelPress} onPointerCancel={cancelPress}
          onContextMenu={(e) => { e.preventDefault(); cancelPress(); pressFired.current = false; openMenu(); }}
          // Mouse only (touch taps emulate mouseenter and never send mouseleave), and keyboard focus only (the panel hands focus back to this button when it closes).
          onPointerEnter={(e) => { if (e.pointerType === 'mouse') setBtnHold(true); }} onPointerLeave={() => { setBtnHold(false); cancelPress(); }}
          onFocus={(e) => setBtnHold(e.currentTarget.matches(':focus-visible'))} onBlur={() => setBtnHold(false)}
          title="Live Radio: tap to open, press and hold for recent stations"
          className={`fixed right-3 sm:right-6 ${lift} z-[45] flex min-h-[48px] select-none items-center gap-2 overflow-hidden rounded-full bg-gradient-to-br from-orange-500 to-red-600 px-4 text-sm font-extrabold uppercase tracking-wider text-white shadow-lg shadow-red-900/50 ring-1 ring-white/20 transition-[opacity,transform,background-color] duration-700 motion-reduce:duration-0 ${btnFaded ? 'opacity-0 pointer-events-none' : 'opacity-100'} hover:from-orange-400 hover:to-red-500 active:scale-95 cursor-pointer touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-white`}>
          {ripples.map((r) => (
            <span key={r.id} aria-hidden="true" data-testid="radio-ripple" className="ajn-ripple" style={{ left: r.x - r.size / 2, top: r.y - r.size / 2, width: r.size, height: r.size }} />
          ))}
          <Radio className="relative h-5 w-5" aria-hidden="true" />
          <span className="relative">Radio</span>
          {live && (
            <span data-testid="radio-live-dot" role="img" aria-label="Radio is playing" className="ajn-live-dot relative h-2.5 w-2.5 rounded-full bg-emerald-300" />
          )}
        </button>
      )}

      {menuOpen && !open && (
        <div ref={menuRef} role="menu" aria-label="Recent radio stations" data-testid="radio-quick-menu"
          className={`fixed right-3 sm:right-6 ${menuLift} z-[50] w-64 overflow-hidden rounded-2xl border border-red-700/70 bg-neutral-950/97 text-neutral-100 shadow-2xl shadow-black/70 backdrop-blur-md`}>
          <p className="border-b border-neutral-800 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-orange-300">Switch station</p>
          {recents.length === 0 ? (
            <p className="px-3 py-3 text-xs text-neutral-400" data-testid="radio-quick-empty">No stations played yet. Open Radio and pick one: it will show up here.</p>
          ) : recents.slice(0, 6).map((r) => {
            const current = r.channelId === stationId;
            return (
              <button key={r.channelId} type="button" role="menuitem" data-testid="radio-quick-item" aria-current={current ? 'true' : undefined} onClick={() => switchTo(r)}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-left hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none touch-manipulation">
                <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${current ? 'bg-emerald-300' : 'bg-neutral-700'}`} />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{r.title}</span>{r.subtitle && <span className="block truncate text-[11px] text-neutral-400">{r.subtitle}</span>}</span>
                {current && <span className="shrink-0 text-[10px] font-bold uppercase text-emerald-300">{live ? 'Playing' : 'Current'}</span>}
              </button>
            );
          })}
          <button type="button" role="menuitem" data-testid="radio-quick-open" onClick={show}
            className="flex w-full cursor-pointer items-center gap-2 border-t border-neutral-800 px-3 py-2.5 text-left text-sm text-orange-200 hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none touch-manipulation">
            <Radio className="h-4 w-4" aria-hidden="true" /> Open full Radio
          </button>
        </div>
      )}

      <aside id="radio-dock-panel" data-testid="radio-dock-panel" aria-label="Live radio player" hidden={!open}
        style={theme ? { borderColor: theme.borderTint } : undefined}
        className={`${open ? 'flex' : 'hidden'} fixed z-[55] flex-col overflow-hidden border border-red-700/70 bg-neutral-950/97 shadow-2xl shadow-black/70 backdrop-blur-md ${
          full ? 'inset-0 z-[60] max-h-none rounded-none' : 'inset-x-0 bottom-14 max-h-[80vh] rounded-t-2xl sm:bottom-16 md:inset-x-auto md:bottom-6 md:right-6 md:w-[27rem] md:rounded-2xl'}`}>
        <div style={theme ? { background: `linear-gradient(90deg, ${theme.accentColor}, ${theme.themeColor})` } : undefined} className="flex items-center gap-2 bg-gradient-to-r from-orange-600 to-red-700 px-3 py-2 text-white">
          <Radio className="h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="mr-auto min-w-0">
            <p className="text-sm font-extrabold uppercase leading-tight tracking-wider">Radio</p>
            <p className="truncate text-[10px] leading-tight text-orange-100">US + Canada · plays while you browse</p>
          </div>
          <button type="button" data-testid="radio-dock-full" onClick={() => setFull((f) => !f)} aria-pressed={full} aria-label={full ? 'Exit full screen' : 'Full screen'} title={full ? 'Exit full screen' : 'Full screen: see more stations'}
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-white touch-manipulation">
            {full ? <Shrink className="h-5 w-5" /> : <Expand className="h-5 w-5" />}
          </button>
          <button type="button" onClick={hide} aria-label="Minimise radio (keeps playing)" title="Minimise (keeps playing)"
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-white touch-manipulation">
            <ChevronDown className="h-5 w-5" />
          </button>
          <button type="button" data-testid="radio-dock-close" onClick={hide} aria-label="Close radio panel" title="Close"
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-white touch-manipulation">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div data-testid="radio-dock-now" role="status" className="flex items-center gap-3 border-b border-neutral-800 px-3 py-2">
          {station ? (
            <>
              {nowLogo ? (
                <img src={nowLogo} alt="" referrerPolicy="no-referrer" draggable={false} className="h-11 w-11 shrink-0 rounded-lg bg-neutral-900 object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              ) : (
                <div aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-red-900/60 text-sm font-bold text-orange-100">{station.title.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '▶'}</div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-neutral-100">{station.title}</p>
                <p className="truncate text-xs text-neutral-400">{live ? 'Playing' : media.attached ? 'Paused' : 'Loading…'}{station.subtitle ? ` · ${station.subtitle}` : ''}</p>
              </div>
              <button type="button" onClick={media.toggle} disabled={!media.attached} aria-label={media.paused ? 'Play' : 'Pause'}
                className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-red-600 text-white disabled:opacity-40 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white touch-manipulation">
                {media.paused ? <Play className="ml-0.5 h-5 w-5 fill-current" /> : <Pause className="h-5 w-5" />}
              </button>
              <button type="button" onClick={media.toggleMute} disabled={!media.attached} aria-pressed={media.muted} aria-label={media.muted ? 'Unmute' : 'Mute'}
                className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-neutral-800 text-neutral-100 hover:bg-neutral-700 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 touch-manipulation">
                {media.muted ? <VolumeX className="h-4 w-4 text-red-400" /> : <Volume2 className="h-4 w-4" />}
              </button>
              <button type="button" onClick={() => { hide(); onNavigate('player'); }} aria-label="Open the full player (visualizer)" title="Full player and visualizer"
                className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-neutral-800 text-neutral-100 hover:bg-neutral-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 touch-manipulation">
                <Maximize2 className="h-4 w-4" />
              </button>
            </>
          ) : (
            <p className="text-xs text-neutral-400">Pick a station below. It keeps playing when you close this panel or change pages.</p>
          )}
        </div>

        <RadioPresetsBar station={station} info={art ? { number: art.number, logo: art.logo, corsVerified: art.corsVerified } : null} live={live} onPlay={onPlay}
          onPresetTuned={(id, logo) => setPresetTuned({ id, logo })} />

        <RadioStationGroup onPlay={onPlay} onTuned={setTuned} activeId={station?.channelId} />

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
          {everOpened && <LiveRadioDirectory compact wide={full} onPlay={onPlay} onTuned={setTuned} activeId={station?.channelId} />}
        </div>
      </aside>
    </>
  );
}
