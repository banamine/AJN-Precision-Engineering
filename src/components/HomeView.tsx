import { useEffect, useState } from 'react';
import { Play, Tv, Radio, Sparkles, Clock, ArrowRight, Archive, Headphones } from 'lucide-react';
import { Destination, NowPlayingMedia, MediaType, PlayProgramCallback, RecentlyPlayedItem } from '../types';

interface HomeViewProps {
  onNavigate: (dest: Destination) => void;
  onPlayProgram: PlayProgramCallback;
  nowPlaying: NowPlayingMedia | null;
  recentlyPlayed: RecentlyPlayedItem[];
  onResumeRecentlyPlayed: (item: RecentlyPlayedItem) => void;
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
}

const FEATURED_BROADCAST = {
  title: 'NASA Apollo 11 Spaceflight Audio Highlights',
  category: 'Historic Aerospace Vault',
  description: 'Original transmission feeds from the Apollo 11 lunar landing mission, processed through the AJN precision audio bridge.',
  archivePath: '/download/Apollo11AudioHighlights/apollo_11_audio_highlights_64kb.mp3',
  duration: '45 mins',
  tag: 'Curated Feature',
  mediaType: 'audio' as MediaType,
  image: 'https://archive.org/download/daily-highlights/Classic%20Archive.png',
};

const PROGRAM_COLLECTIONS = [
  {
    title: 'Special Coverage',
    description: 'Archive reports, breaking coverage and preserved broadcast material.',
    image: 'https://dn720602.ca.archive.org/0/items/daily-highlights/Special%20Report.png',
    accent: 'text-sky-300',
    badge: 'SPECIAL REPORT',
    action: 'library' as Destination,
  },
  {
    title: 'Classic Archive',
    description: 'Classic television, cinema and historical programs.',
    image: 'https://archive.org/download/daily-highlights/Classic%20Archive.png',
    accent: 'text-amber-300',
    badge: 'CLASSIC TV',
    action: 'library' as Destination,
  },
  {
    title: 'Emergency Broadcast',
    description: 'Continuous-access emergency and special broadcast presentation.',
    image: 'https://archive.org/download/daily-highlights/Emergency%20Broadcast.png',
    accent: 'text-rose-300',
    badge: 'EMERGENCY',
    action: 'tv-guide' as Destination,
  },
];

const ARCHIVE_HIGHLIGHTS = [
  { id: 'highlight-1', title: 'Night of the Living Dead (1968 Master)', category: 'Public Domain Cinema', duration: '96 mins', archivePath: '/download/NightOfTheLivingDead/Night_of_the_Living_Dead_512kb.mp4', badge: 'VIDEO MP4', mediaType: 'video' as MediaType, description: 'Classic cinema restored master streamed through the existing Archive playback path.' },
  { id: 'highlight-2', title: 'Apollo 11 Flight Journal Audio Vault', category: 'NASA Spaceflight', duration: '45 mins', archivePath: '/download/Apollo11AudioHighlights/apollo_11_audio_highlights_64kb.mp3', badge: 'RADIO AUDIO', mediaType: 'audio' as MediaType, description: 'Mission control communication recordings and flight director audio loops.' },
  { id: 'highlight-3', title: 'War of the Worlds — Orson Welles 1938', category: 'Historical Radio Drama', duration: '58 mins', archivePath: '/download/OTRR_Mercury_Theater_on_the_Air_Singles/Mercury_381030_WarOfTheWorlds.mp3', badge: 'RADIO DRAMA', mediaType: 'audio' as MediaType, description: 'The historic CBS broadcast with live sound design and voice acting.' },
];

export function HomeView({ onNavigate, onPlayProgram, nowPlaying, recentlyPlayed, onResumeRecentlyPlayed }: HomeViewProps) {
  const [liveChannels, setLiveChannels] = useState<LiveChannelPreview[]>([]);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      fetch('/api/schedule?guide=cable-tv').then((res) => (res.ok ? res.json() : null)),
      fetch('/api/schedule?guide=audio-podcasts').then((res) => (res.ok ? res.json() : null)),
    ]).then(([tvData, audioData]) => {
      if (!mounted) return;
      const allChannels = [...(tvData?.channels || []), ...(audioData?.channels || [])];
      const nowHour = new Date().getHours() + new Date().getMinutes() / 60;
      setLiveChannels(allChannels.slice(0, 3).map((ch: any) => {
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
        };
      }).filter((channel: LiveChannelPreview) => channel.archivePath));
    }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  return (
    <div className="space-y-10 pb-16">
      <section className="relative isolate overflow-hidden rounded-2xl border border-sky-500/20 bg-neutral-950 shadow-2xl">
        <img src={nowPlaying?.image || FEATURED_BROADCAST.image} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover opacity-20" />
        <div className="absolute inset-0 bg-gradient-to-r from-neutral-950 via-neutral-950/90 to-neutral-950/55" />
        <div className="relative z-10 min-h-[330px] flex flex-col justify-end p-6 sm:p-8 lg:p-10">
          <div className="max-w-3xl space-y-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300 border border-emerald-500/20">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {nowPlaying?.isLive ? 'LIVE NOW' : nowPlaying ? 'NOW PLAYING' : FEATURED_BROADCAST.tag}
              </span>
              <span className="text-xs text-neutral-400">{nowPlaying?.mediaType === 'audio' ? 'Audio' : 'Video'} • AJN Cloud TV</span>
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight text-neutral-50 leading-tight">
              {nowPlaying?.title || FEATURED_BROADCAST.title}
            </h1>
            <p className="max-w-2xl text-sm sm:text-base text-neutral-300 leading-relaxed">
              {nowPlaying?.subtitle || FEATURED_BROADCAST.description}
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              {nowPlaying ? (
                <button type="button" onClick={() => onNavigate('player')} className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-500/20 hover:bg-sky-400">
                  <Play className="h-4 w-4 fill-current" /> Open Player
                </button>
              ) : (
                <button type="button" onClick={() => onPlayProgram(FEATURED_BROADCAST.archivePath, FEATURED_BROADCAST.title, FEATURED_BROADCAST.category, FEATURED_BROADCAST.mediaType)} className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-500/20 hover:bg-sky-400">
                  <Play className="h-4 w-4 fill-current" /> Play Broadcast Now
                </button>
              )}
              <button type="button" onClick={() => onNavigate('tv-guide')} className="inline-flex items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-900/80 px-4 py-2.5 text-sm font-medium text-neutral-200 hover:bg-neutral-800">
                <Tv className="h-4 w-4 text-sky-400" /> Open Guide
              </button>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="collections-heading" className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 id="collections-heading" className="text-lg font-semibold tracking-tight text-neutral-100">AJN Programs</h2>
            <p className="mt-1 text-xs text-neutral-500">Visual entry points into the archive and broadcast catalog.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PROGRAM_COLLECTIONS.map((collection) => (
            <button key={collection.title} type="button" onClick={() => onNavigate(collection.action)} className="group relative min-h-[190px] overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 text-left">
              <img src={collection.image} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover opacity-55 transition duration-500 group-hover:scale-105 group-hover:opacity-70" loading="lazy" />
              <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/65 to-transparent" />
              <div className="relative flex h-full min-h-[190px] flex-col justify-end p-5">
                <span className={`text-[10px] font-mono font-semibold tracking-[0.18em] ${collection.accent}`}>{collection.badge}</span>
                <h3 className="mt-2 text-xl font-semibold text-white">{collection.title}</h3>
                <p className="mt-1 max-w-sm text-xs leading-relaxed text-neutral-300">{collection.description}</p>
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-sky-300">Explore <ArrowRight className="h-3.5 w-3.5" /></span>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby="recent-heading" className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 id="recent-heading" className="text-lg font-semibold tracking-tight text-neutral-100">Recently Played</h2>
            <p className="mt-1 text-xs text-neutral-500">Your last five AJN selections, with real playback position available for resume.</p>
          </div>
          {recentlyPlayed.length > 0 && <span className="text-[11px] font-mono text-neutral-600">{recentlyPlayed.length}/5</span>}
        </div>
        {recentlyPlayed.length === 0 ? (
          <div className="rounded-xl border border-dashed border-neutral-800 bg-neutral-950/40 p-6 text-sm text-neutral-500">No recently played items are available yet. Start a program and it will appear here.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {recentlyPlayed.map((item) => (
              <button key={item.id} type="button" onClick={() => onResumeRecentlyPlayed(item)} className="group overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/70 text-left hover:border-sky-500/30 hover:bg-neutral-900">
                <div className="relative h-24 overflow-hidden bg-neutral-950">
                  <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 to-neutral-800" />
                  <div className="absolute inset-0 flex items-center justify-center"><span className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/40 text-sky-300"><Play className="h-4 w-4 fill-current" /></span></div>
                </div>
                <div className="p-3">
                  <div className="flex items-center justify-between gap-2"><span className="text-[10px] font-mono uppercase tracking-wide text-sky-400">{item.mediaType}</span><span className="text-[10px] text-neutral-600">Resume</span></div>
                  <h3 className="mt-2 text-sm font-semibold text-neutral-100 line-clamp-3 group-hover:text-sky-300">{item.title}</h3>
                  {item.subtitle && <p className="mt-1 text-[11px] text-neutral-500 line-clamp-2">{item.subtitle}</p>}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="live-stations-heading" className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/20"><Radio className="h-4 w-4" /></div>
            <div><h2 id="live-stations-heading" className="text-lg font-semibold tracking-tight text-neutral-100">Live Station Feeds</h2><p className="mt-1 text-xs text-neutral-500">Current AJN channel and schedule sources.</p></div>
          </div>
          <button type="button" onClick={() => onNavigate('tv-guide')} className="flex items-center gap-1 text-xs font-medium text-sky-400 hover:text-sky-300">Full Guide <ArrowRight className="h-3.5 w-3.5" /></button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {liveChannels.map((channel) => (
            <div key={channel.id} className="group rounded-xl border border-neutral-800 bg-neutral-900/60 p-5 hover:border-sky-500/30">
              <div className="flex items-center justify-between"><span className={`rounded px-2 py-0.5 font-mono text-[11px] font-semibold ${channel.mediaType === 'audio' ? 'bg-amber-950/80 text-amber-300 border border-amber-800/40' : 'bg-sky-950/80 text-sky-300 border border-sky-800/40'}`}>{channel.networkTag}</span><span className="text-[11px] text-sky-400">{channel.airTime}</span></div>
              <h3 className="mt-4 text-base font-semibold text-neutral-100 group-hover:text-sky-300">{channel.name}</h3>
              <p className="mt-1 text-xs text-neutral-400 line-clamp-2">{channel.currentProgram}</p>
              <div className="mt-5 flex items-center justify-between border-t border-neutral-800/80 pt-4"><span className="text-[11px] text-neutral-500">{channel.mediaType === 'audio' ? 'Audio Stream' : 'Video Stream'}</span><button type="button" onClick={() => onPlayProgram(channel.archivePath, channel.currentProgram, channel.name, channel.mediaType)} className="flex items-center gap-1.5 rounded-lg bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-sky-600 hover:text-white"><Play className="h-3.5 w-3.5 fill-current" /> Tune In</button></div>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="featured-highlights-heading" className="space-y-4">
        <div className="flex items-center justify-between">
          <div><h2 id="featured-highlights-heading" className="text-lg font-semibold tracking-tight text-neutral-100">Featured & Highlights</h2><p className="mt-1 text-xs text-neutral-500">Archive entries wired to the existing playback path.</p></div>
          <button type="button" onClick={() => onNavigate('library')} className="text-xs font-medium text-sky-400 hover:text-sky-300">Open Library</button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {ARCHIVE_HIGHLIGHTS.map((item) => (
            <button key={item.id} type="button" onClick={() => onPlayProgram(item.archivePath, item.title, item.category, item.mediaType)} className="group text-left rounded-xl border border-neutral-800 bg-neutral-900/60 p-5 hover:border-sky-500/30 hover:bg-neutral-900">
              <div className="flex items-center justify-between"><span className="text-[11px] font-mono uppercase tracking-wide text-sky-400">{item.badge}</span><Clock className="h-3.5 w-3.5 text-neutral-600" /></div>
              <h3 className="mt-3 text-base font-semibold text-neutral-100 group-hover:text-sky-300">{item.title}</h3>
              <p className="mt-1 text-xs text-neutral-400 line-clamp-3">{item.description}</p>
              <div className="mt-4 text-[11px] text-neutral-500">{item.category} • {item.duration}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
        <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-500">
          <Archive className="h-4 w-4 text-sky-400" />
          <span>Archive library</span><span>•</span><Headphones className="h-4 w-4 text-amber-400" /><span>AJN audio resources</span><span>•</span><Tv className="h-4 w-4 text-sky-400" /><span>TV & Audio Guide</span>
        </div>
      </section>
    </div>
  );
}
