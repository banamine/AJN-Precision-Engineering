import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Heart, Play, Tv, Radio, Sparkles, Clock, ArrowRight, Archive, Headphones, Rocket } from 'lucide-react';
import { useLatestFullShows } from '../hooks/useLatestFullShows';
import { useHomeNow } from '../hooks/useHomeNow';
import { RecentCarousel } from './RecentCarousel';
import { HomeBroadcastHub } from './HomeBroadcastHub';
import { loadSchedule } from '../guide/loadSchedule';
import { LiveRadioBand } from './LiveRadioBand';
import { AjnResourcePanel } from './AjnResourcePanel';
import { ajnArtFor } from '../utils/ajnArt';
import { HERO_POOL, PROGRAM_POOL, type ProgramTile } from '../data/homeFeatures';
import { requestChannelFocus } from '../guide/focusRequest';
import { localDateKey, msUntilLocalMidnight, pickForDay } from '../utils/dayRotation';
import { saveLastView } from '../nav/lastView';
import type { FavoriteMedia } from '../utils/mediaFavorites';
import { Destination, NowPlayingMedia, MediaType, PlayProgramCallback, RecentlyPlayedItem } from '../types';

interface HomeViewProps {
  onNavigate: (dest: Destination) => void;
  onPlayProgram: PlayProgramCallback;
  nowPlaying: NowPlayingMedia | null;
  recentlyPlayed: RecentlyPlayedItem[];
  onResumeRecentlyPlayed: (item: RecentlyPlayedItem) => void;
  favorites?: FavoriteMedia[];
  onPlayFavorite?: (item: FavoriteMedia) => void;
}

interface LiveChannelPreview {
  id: string;
  name: string;
  networkTag: string;
  currentProgram: string;
  airTime: string;
  archivePath: string;
  mediaType?: MediaType;
  isLive: boolean;
  logo?: string;
}

/** Archive item cover through our own proxy (same path rule as every other Archive request). */
function archiveThumb(archivePath: string): string | undefined {
  const m = archivePath.match(/^\/download\/([^/]+)\//);
  return m ? `/api/archive/proxy?path=${encodeURIComponent(`/download/${m[1]}/__ia_thumb.jpg`)}` : undefined;
}

function TypePill({ type }: { type?: string }) {
  const audio = type === 'audio';
  return (
    <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow ${audio ? 'bg-sky-600' : 'bg-orange-500'}`}>
      {audio ? 'Audio' : 'Video'}
    </span>
  );
}

/** Image-backed card: picture fills the card, a dark scrim keeps the text readable on any image. */
function MediaCard({ image, fit = 'cover', onClick, label, className = '', children }: { key?: string | number; image?: string; fit?: 'cover' | 'contain'; onClick: () => void; label: string; className?: string; children: ReactNode }) {
  const [broken, setBroken] = useState(false);
  return (
    <button type="button" onClick={onClick} aria-label={label} className={`group relative isolate overflow-hidden rounded-xl border border-white/10 bg-neutral-900 text-left transition hover:border-sky-400/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${className}`}>
      {image && !broken && (
        <img src={image} alt="" aria-hidden="true" loading="lazy" onError={() => setBroken(true)}
          className={fit === 'contain' ? 'absolute inset-0 z-0 h-full w-full object-contain p-6 pb-14 opacity-90 transition duration-300 group-hover:scale-105' : 'absolute inset-0 z-0 h-full w-full object-cover transition duration-300 group-hover:scale-105'} />
      )}
      <div className="absolute inset-0 z-[1] bg-gradient-to-t from-neutral-950 via-neutral-950/70 to-neutral-950/20" />
      <div className="relative z-[2] flex h-full flex-col justify-between p-3">{children}</div>
    </button>
  );
}

function FullShowShortcuts({ onPlayProgram, className = '', testId }: { onPlayProgram: PlayProgramCallback; className?: string; testId: string }) {
  const latest = useLatestFullShows();
  if (latest.status === 'loading') return null;
  if (latest.status === 'error') return <p data-testid={testId} className={`text-xs text-neutral-400 ${className}`}>Latest Alex Jones and War Room shows are unavailable right now.</p>;
  return (
    <div data-testid={testId} className={`flex flex-col gap-2 ${className}`}>
      {latest.shows.map((s) => (
        <button key={s.showSlug} type="button" data-testid={`shortcut-${s.showSlug}`}
          onClick={() => onPlayProgram(s.url, s.title, `Full show · ${s.showName} · ${s.dateLabel}`, 'audio', 'ajn-radio', 'ajn-radio', s.id)}
          aria-label={`Play full show: ${s.showName}, ${s.dateLabel}${s.dayKind === 'special' ? ', special broadcast' : ''}`}
          className="group flex items-center gap-3 rounded-2xl bg-gradient-to-r from-red-600 via-orange-600 to-amber-500 p-2.5 pr-4 text-left shadow-2xl shadow-orange-950/80 ring-2 ring-orange-400/90 transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/70">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-black/45 ring-1 ring-white/25"><Play className="ml-0.5 h-5 w-5 fill-emerald-300 text-emerald-300" /></span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[11px] font-black uppercase tracking-wider text-emerald-300 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">{s.showName} · FULL SHOW</span>
            <span className="truncate text-xs font-extrabold text-white drop-shadow">{s.dateLabel}{s.dayKind === 'special' ? ' · SPECIAL' : ''}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

interface DailyFrame { image: string; show: string; hour: number; source: string; timestamp: number }

/** Set to true once the hub is tested: hides the old On Now grid and RecentCarousel, which repeat what the hub shows. Default keeps them for rollback. */
const HUB_REPLACES_LEGACY_ROWS = true;

export function HomeView({ onNavigate, onPlayProgram, nowPlaying, recentlyPlayed, onResumeRecentlyPlayed, favorites = [], onPlayFavorite }: HomeViewProps) {
  // "Today on AJN": curated stills published by tools/daily-frames. No manifest (or an invalid one) = section hidden, nothing faked.
  const [daily, setDaily] = useState<{ date: string; items: DailyFrame[] } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/daily/manifest.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => {
        if (!alive || !m || !Array.isArray(m.items)) return;
        const items = (m.items as DailyFrame[]).filter((i) => typeof i?.image === 'string' && i.image.startsWith('/daily/') && typeof i.source === 'string');
        if (items.length) setDaily({ date: String(m.date ?? ''), items: items.slice(0, 8) });
      })
      .catch(() => { /* optional feature: stay hidden */ });
    return () => { alive = false; };
  }, []);
  // Daily rotation: everything below flips at the viewer's local midnight (same date = same picks).
  const [dateKey, setDateKey] = useState(() => localDateKey());
  useEffect(() => {
    const t = window.setTimeout(() => setDateKey(localDateKey()), msUntilLocalMidnight() + 500);
    return () => window.clearTimeout(t);
  }, [dateKey]);
  const hero = useMemo(() => pickForDay(HERO_POOL, (f) => f.id, dateKey, 1, 'hero')[0], [dateKey]);
  const [heroImage, setHeroImage] = useState(() => archiveThumb(hero.archivePath) ?? hero.image);
  useEffect(() => { setHeroImage(archiveThumb(hero.archivePath) ?? hero.image); }, [hero]);
  // One shared "airing now per genre" read for the program tiles and the carousel.
  const now = useHomeNow();
  // Pinned tiles always show (they take a slot); the remaining slots rotate daily.
  const tiles = useMemo(() => {
    const pinned = PROGRAM_POOL.filter((t) => t.pinned);
    const rest = PROGRAM_POOL.filter((t) => !t.pinned);
    return [...pickForDay(rest, (t) => t.id, dateKey, Math.max(0, 3 - pinned.length), 'tiles'), ...pinned];
  }, [dateKey]);
  const tileImage = (t: ProgramTile) => t.image ?? now.items.find((i) => i.guideId === t.guideId)?.thumb;
  const openTile = (t: ProgramTile) => {
    if (t.guideId && t.dest === 'tv-guide') {
      saveLastView({ guideId: t.guideId });
      if (t.focusChannelId) requestChannelFocus(t.guideId, t.focusChannelId);
      window.dispatchEvent(new CustomEvent('ajn:select-guide', { detail: { guideId: t.guideId } }));
    }
    onNavigate(t.dest);
  };
  const [liveChannels, setLiveChannels] = useState<LiveChannelPreview[]>([]);

  useEffect(() => {
    let mounted = true;
    // Cable TV only (2 MB): the 19 MB audio schedule is not needed for four preview cards. Shared cache + one request at a time.
    loadSchedule('cable-tv').then((tvChannels) => {
      if (!mounted) return;
      const allChannels = tvChannels as any[];
      const nowHour = new Date().getHours() + new Date().getMinutes() / 60;
      setLiveChannels(allChannels.slice(0, 8).map((ch: any) => {
        const matchingProg = ch.programs?.find((p: any) => nowHour >= (p.startHour ?? p.startTime ?? 0) && nowHour < (p.endHour ?? p.endTime ?? 24)) || ch.programs?.[0];
        return {
          id: ch.id,
          name: ch.name,
          networkTag: ch.mediaType === 'audio' ? 'AUDIO' : 'TV',
          currentProgram: matchingProg?.title || 'Continuous Broadcast Stream',
          airTime: matchingProg ? `${Math.floor(matchingProg.startHour ?? 0)}:00 - ${Math.floor(matchingProg.endHour ?? 24)}:00` : 'Live Feed',
          archivePath: matchingProg?.archivePath || matchingProg?.mediaUrl || '',
          mediaType: ch.mediaType || (matchingProg?.archivePath?.toLowerCase().endsWith('.mp3') ? 'audio' : 'video'),
          isLive: true,
          logo: typeof ch.logo === 'string' && ch.logo.startsWith('/') ? ch.logo : (/alex jones|war room/i.test(String(ch.name)) ? ajnArtFor({ show: String(ch.name), mediaType: ch.mediaType, live: true }) : undefined),
        };
      }).filter((channel: LiveChannelPreview) => channel.archivePath).slice(0, 4));
    }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  return (
    <div className="space-y-14 pb-16">
      <section className="relative isolate overflow-hidden rounded-2xl border border-sky-500/20 bg-neutral-950 shadow-2xl">
        <img src={heroImage} alt="" aria-hidden="true" onError={() => setHeroImage('/Classic%20Archive.png')} className="absolute inset-0 h-full w-full object-cover opacity-20" />
        <div className="absolute inset-0 bg-gradient-to-r from-neutral-950 via-neutral-950/90 to-neutral-950/55" />
        
        {/* High-visibility Driver Mode / Full Show Floating Overlay Button */}
        <div className="absolute top-4 right-4 sm:top-6 sm:right-6 z-20">
          <button
            type="button"
            onClick={() => {
              if (nowPlaying) {
                onNavigate('player');
              } else {
                onPlayProgram(hero.archivePath, hero.title, hero.category, hero.mediaType);
              }
            }}
            title="Play Full Show (High-Visibility Drive Mode)"
            aria-label="Play full show, high-visibility drive button"
            className="group flex items-center gap-3 sm:gap-4 rounded-2xl bg-gradient-to-r from-red-600 via-orange-600 to-amber-500 p-2.5 sm:p-3 pr-4 sm:pr-5 shadow-2xl shadow-orange-950/80 ring-2 ring-orange-400/90 transition-all duration-200 hover:scale-105 active:scale-95 hover:from-red-500 hover:via-orange-500 hover:to-amber-400 cursor-pointer"
          >
            <span className="flex h-11 w-11 sm:h-13 sm:w-13 shrink-0 items-center justify-center rounded-xl bg-black/45 shadow-inner ring-1 ring-white/25 group-hover:bg-black/35">
              <Play className="h-6 w-6 sm:h-7 sm:w-7 fill-emerald-300 text-emerald-300 transition-transform duration-200 group-hover:scale-115 ml-0.5" />
            </span>
            <span className="flex flex-col text-left">
              <span className="text-[11px] sm:text-xs font-black uppercase tracking-wider text-emerald-300 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                FULL SHOW • DRIVE PLAY
              </span>
              <span className="text-xs sm:text-sm font-extrabold tracking-tight text-white drop-shadow">
                {nowPlaying?.isLive ? 'TUNE LIVE STREAM' : 'TAP TO PLAY NOW'}
              </span>
            </span>
          </button>
        </div>

        {/* Daily shortcuts: newest Alex Jones + War Room full shows, stacked under the Drive Play button (tablet/desktop). */}
        <div className="absolute right-4 top-[5.75rem] z-20 hidden w-[17rem] sm:right-6 sm:top-[7.25rem] sm:block">
          <FullShowShortcuts onPlayProgram={onPlayProgram} testId="full-show-shortcuts-overlay" />
        </div>

        <div className="relative z-10 min-h-[330px] flex flex-col justify-end p-6 sm:p-8 lg:p-10">
          <div className="max-w-3xl space-y-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300 border border-emerald-500/20">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {nowPlaying?.isLive ? 'LIVE NOW' : nowPlaying ? 'NOW PLAYING' : hero.tag}
              </span>
              <span className="text-xs text-neutral-400">{(nowPlaying?.mediaType ?? (nowPlaying ? 'video' : hero.mediaType)) === 'audio' ? 'Audio' : 'Video'} • AJN Cloud TV</span>
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight text-neutral-50 leading-tight">
              {nowPlaying?.title || hero.title}
            </h1>
            <p className="max-w-2xl text-sm sm:text-base text-neutral-300 leading-relaxed">
              {nowPlaying?.subtitle || hero.description}
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  if (nowPlaying) {
                    onNavigate('player');
                  } else {
                    onPlayProgram(hero.archivePath, hero.title, hero.category, hero.mediaType);
                  }
                }}
                className="inline-flex items-center gap-3 rounded-xl bg-gradient-to-r from-red-600 via-orange-600 to-amber-500 px-5 py-3 text-sm sm:text-base font-black text-emerald-300 shadow-xl shadow-orange-950/70 ring-2 ring-orange-400/80 hover:from-red-500 hover:to-orange-500 hover:scale-[1.02] active:scale-95 transition-all cursor-pointer"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/40">
                  <Play className="h-5 w-5 fill-emerald-300 text-emerald-300 ml-0.5" />
                </span>
                <span className="tracking-wide">PLAY FULL SHOW</span>
              </button>
              <button type="button" onClick={() => onNavigate('tv-guide')} className="inline-flex items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-900/80 px-4 py-3 text-sm font-medium text-neutral-200 hover:bg-neutral-800">
                <Tv className="h-4 w-4 text-sky-400" /> Open Guide
              </button>
              {hero.apollo ? (
              <button type="button" onClick={() => { try { sessionStorage.setItem('ajn.library.open', 'apollo'); } catch { /* storage blocked: opens on All */ } onNavigate('library'); }}
                className="inline-flex items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-900/80 px-4 py-3 text-sm font-medium text-neutral-200 hover:bg-neutral-800">
                <Rocket className="h-4 w-4 text-amber-400" aria-hidden="true" /> Apollo Mission Archive
              </button>
              ) : (
                <button type="button" onClick={() => onNavigate('library')} className="inline-flex items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-900/80 px-4 py-3 text-sm font-medium text-neutral-200 hover:bg-neutral-800">
                  <Archive className="h-4 w-4 text-amber-400" aria-hidden="true" /> Open Library
                </button>
              )}
            </div>
            <FullShowShortcuts onPlayProgram={onPlayProgram} className="sm:hidden" testId="full-show-shortcuts-inline" />
          </div>
        </div>
      </section>

      <LiveRadioBand />
      <HomeBroadcastHub onPlayProgram={onPlayProgram} onNavigate={onNavigate} />

      <section aria-labelledby="collections-heading" className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 id="collections-heading" className="text-lg font-semibold tracking-tight text-neutral-100">AJN Programs</h2>
            <p className="mt-1 text-xs text-neutral-500">Visual entry points into the archive and broadcast catalog.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4" data-testid="home-program-tiles">
          {tiles.map((t) => {
            const img = tileImage(t);
            return (
              <button key={t.id} type="button" onClick={() => openTile(t)} className="group relative min-h-[190px] overflow-hidden rounded-xl border border-neutral-800 bg-gradient-to-br from-neutral-900 to-neutral-950 text-left">
                {img && <img src={img} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover opacity-55 transition duration-500 group-hover:scale-105 group-hover:opacity-70" loading="lazy" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />}
                <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/65 to-transparent" />
                <div className="relative flex h-full min-h-[190px] flex-col justify-end p-5">
                  <span className={`text-[10px] font-mono font-semibold tracking-[0.18em] ${t.accent}`}>{t.badge}</span>
                  <h3 className="mt-2 text-xl font-semibold text-white">{t.title}</h3>
                  <p className="mt-1 max-w-sm text-xs leading-relaxed text-neutral-300">{t.description}</p>
                  <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-sky-300">Explore <ArrowRight className="h-3.5 w-3.5" /></span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-12">
          {daily && (
            <section aria-labelledby="today-ajn-heading" className="space-y-3" data-testid="home-today-ajn">
              <div><h2 id="today-ajn-heading" className="text-lg font-semibold tracking-tight text-neutral-100">Today on AJN</h2><p className="text-xs text-neutral-500">Stills picked from {daily.date}'s broadcasts. Tap one to watch from that moment.</p></div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {daily.items.map((f) => (
                  <MediaCard key={f.image} image={f.image} className="aspect-video" label={`Watch ${f.show} hour ${f.hour} from ${Math.floor(f.timestamp / 60)} minutes`}
                    onClick={() => onPlayProgram(f.source, `${f.show} · Hour ${f.hour}`, `From ${daily.date}`, 'video', undefined, undefined, undefined, undefined, undefined, Math.max(0, Math.floor(f.timestamp) - 5))}>
                    <div className="flex items-center justify-between"><TypePill type="video" /></div>
                    <div className="min-w-0"><h3 className="truncate text-sm font-semibold text-white">{f.show}</h3><p className="truncate text-[11px] text-neutral-300">Hour {f.hour}</p></div>
                  </MediaCard>
                ))}
              </div>
            </section>
          )}

          {!HUB_REPLACES_LEGACY_ROWS && (<>
          <section aria-labelledby="live-stations-heading" className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-sky-500/20 bg-sky-500/10 text-sky-400"><Radio className="h-4 w-4" /></div>
                <div><h2 id="live-stations-heading" className="text-lg font-semibold tracking-tight text-neutral-100">On Now</h2><p className="text-xs text-neutral-500">What the 24/7 schedule has on right now.</p></div>
              </div>
              <button type="button" onClick={() => onNavigate('tv-guide')} className="flex items-center gap-1 text-xs font-medium text-sky-400 hover:text-sky-300">Full Guide <ArrowRight className="h-3.5 w-3.5" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="home-on-now">
              {liveChannels.length === 0 && <p className="col-span-full rounded-xl border border-dashed border-neutral-800 p-5 text-sm text-neutral-500">Loading what is on now… If this stays empty, open the Full Guide.</p>}
              {liveChannels.map((channel) => (
                <MediaCard key={channel.id} image={channel.logo} fit="contain" className="aspect-[4/3]" label={`Play ${channel.name}: ${channel.currentProgram}`}
                  onClick={() => onPlayProgram(channel.archivePath, channel.currentProgram, channel.name, channel.mediaType)}>
                  <div className="flex items-center justify-between"><TypePill type={channel.mediaType} /><span className="rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">On now</span></div>
                  <div className="min-w-0"><h3 className="truncate text-sm font-semibold text-white">{channel.name}</h3><p className="truncate text-[11px] text-neutral-300">{channel.currentProgram}</p></div>
                </MediaCard>
              ))}
            </div>
          </section>

          <RecentCarousel now={now} onPlayProgram={onPlayProgram} onNavigate={onNavigate} playing={!!nowPlaying} />
          </>)}

          <AjnResourcePanel onPlayProgram={onPlayProgram} />
        </div>

        <aside className="min-w-0 space-y-10">
          <section aria-labelledby="recent-heading" className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 id="recent-heading" className="text-lg font-semibold tracking-tight text-neutral-100">Recently Played</h2>
              {recentlyPlayed.length > 0 && <span className="font-mono text-[11px] text-neutral-600">{recentlyPlayed.length}/5</span>}
            </div>
            {recentlyPlayed.length === 0 ? (
              <div className="rounded-xl border border-dashed border-neutral-800 bg-neutral-950/40 p-5 text-sm text-neutral-500">Nothing played yet. Start a program and it appears here, ready to resume.</div>
            ) : (
              <ul className="space-y-2" data-testid="home-recent">
                {recentlyPlayed.map((item) => (
                  <li key={item.id}>
                    <button type="button" onClick={() => onResumeRecentlyPlayed(item)} className="group flex w-full items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900/70 p-2 text-left hover:border-sky-500/40 hover:bg-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
                      <span className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-neutral-800">
                        {item.thumbnailUrl && <img src={item.thumbnailUrl} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />}
                        <Play className="relative h-4 w-4 fill-current text-sky-300 drop-shadow" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2"><TypePill type={item.mediaType} /><span className="text-[10px] text-neutral-500">Resume</span></span>
                        <span className="mt-1 block truncate text-sm font-semibold text-neutral-100 group-hover:text-sky-300">{item.title}</span>
                        {item.subtitle && <span className="block truncate text-[11px] text-neutral-500">{item.subtitle}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="favorites-heading" className="space-y-3" data-testid="home-favorites-section">
            <div className="flex items-center justify-between">
              <h2 id="favorites-heading" className="flex items-center gap-2 text-lg font-semibold tracking-tight text-neutral-100"><Heart className="h-4 w-4 fill-rose-500 text-rose-500" aria-hidden="true" /> Favorites</h2>
              {favorites.length > 0 && <span className="font-mono text-[11px] text-neutral-600">{favorites.length}</span>}
            </div>
            {favorites.length === 0 ? (
              <div data-testid="home-favorites-empty" className="rounded-xl border border-dashed border-neutral-800 bg-neutral-950/40 p-5 text-sm text-neutral-500">Tap the heart in the player to save something here.</div>
            ) : (
              <ul className="max-h-[26rem] space-y-2 overflow-y-auto pr-1" data-testid="home-favorites">
                {favorites.map((item) => (
                  <li key={item.id}>
                    <button type="button" onClick={() => onPlayFavorite?.(item)} className="group flex w-full items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900/70 p-2 text-left hover:border-rose-500/40 hover:bg-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400">
                      <span className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-neutral-800">
                        {item.thumbnailUrl && <img src={item.thumbnailUrl} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />}
                        <Play className="relative h-4 w-4 fill-current text-rose-300 drop-shadow" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <TypePill type={item.mediaType} />
                        <span className="mt-1 block truncate text-sm font-semibold text-neutral-100 group-hover:text-rose-300">{item.title}</span>
                        {item.subtitle && <span className="block truncate text-[11px] text-neutral-500">{item.subtitle}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="resources-heading" className="space-y-3">
            <h2 id="resources-heading" className="text-lg font-semibold tracking-tight text-neutral-100">Jump to</h2>
            <ul className="space-y-2">
              {([
                { label: 'TV & Audio Guide', hint: 'Every channel, 24 hours', icon: Tv, dest: 'tv-guide' },
                { label: 'Archive Library', hint: 'Browse and search the vault', icon: Archive, dest: 'library' },
                { label: 'Radio & Podcasts', hint: 'Talk radio, podcasts, old-time radio', icon: Headphones, dest: 'radio' },
                { label: 'News Walls', hint: 'YouTube and Rumble panels', icon: Radio, dest: 'news' },
              ] as const).map(({ label, hint, icon: Icon, dest }) => (
                <li key={label}>
                  <button type="button" onClick={() => onNavigate(dest)} className="flex w-full items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900/70 p-3 text-left hover:border-sky-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-300"><Icon className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-neutral-100">{label}</span><span className="block truncate text-[11px] text-neutral-500">{hint}</span></span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-neutral-600" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
