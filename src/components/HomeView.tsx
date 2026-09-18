import { useEffect, useState } from 'react';
import {
  Play,
  Tv,
  Radio,
  FolderArchive,
  Search,
  Sparkles,
  Clock,
  ArrowRight,
  ShieldCheck,
  Disc3,
  Calendar,
  Headphones,
} from 'lucide-react';
import { Destination, NowPlayingMedia, MediaType, PlayProgramCallback } from '../types';

interface HomeViewProps {
  onNavigate: (dest: Destination) => void;
  onPlayProgram: PlayProgramCallback;
  nowPlaying: NowPlayingMedia | null;
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
};

const ARCHIVE_HIGHLIGHTS = [
  {
    id: 'highlight-1',
    title: 'Night of the Living Dead (1968 Master)',
    category: 'Public Domain Cinema',
    duration: '96 mins',
    archivePath: '/download/NightOfTheLivingDead/Night_of_the_Living_Dead_512kb.mp4',
    badge: 'Video MP4',
    mediaType: 'video' as MediaType,
    description: 'George Romero classic restored master print streamed via Internet Archive proxy.',
  },
  {
    id: 'highlight-2',
    title: 'Apollo 11 Flight Journal Audio Vault',
    category: 'NASA Spaceflight',
    duration: '45 mins',
    archivePath: '/download/Apollo11AudioHighlights/apollo_11_audio_highlights_64kb.mp3',
    badge: 'Radio Audio',
    mediaType: 'audio' as MediaType,
    description: 'Mission control communication recordings and flight director audio loops.',
  },
  {
    id: 'highlight-3',
    title: 'War of the Worlds — Orson Welles 1938',
    category: 'Historical Radio Drama',
    duration: '58 mins',
    archivePath: '/download/OTRR_Mercury_Theater_on_the_Air_Singles/Mercury_381030_WarOfTheWorlds.mp3',
    badge: 'Radio Drama',
    mediaType: 'audio' as MediaType,
    description: 'The iconic Halloween 1938 CBS broadcast with live sound design and voice acting.',
  },
];

export function HomeView({ onNavigate, onPlayProgram, nowPlaying }: HomeViewProps) {
  const [liveChannels, setLiveChannels] = useState<LiveChannelPreview[]>([
    {
      id: 'cable-news',
      name: 'Broadcast News Network',
      networkTag: 'NEWS',
      currentProgram: 'Special Report Continuous Feed',
      airTime: 'On Air Now',
      archivePath: '/download/FlashGordonConquersTheUniverse1940_Chapter1/FlashGordonConquersTheUniverse1940_Chapter1_512kb.mp4',
      mediaType: 'video',
      isLive: true,
    },
    {
      id: 'apollo-radio',
      name: 'NASA Mission Control Audio',
      networkTag: 'NASA',
      currentProgram: 'Apollo 11 Lunar Descent Flight Audio',
      airTime: 'On Air Now',
      archivePath: '/download/Apollo11AudioHighlights/apollo_11_audio_highlights_64kb.mp3',
      mediaType: 'audio',
      isLive: true,
    },
    {
      id: 'classic-cinema',
      name: 'Public Domain Cinema TV',
      networkTag: 'CINEMA',
      currentProgram: 'Classic Feature Film Broadcast',
      airTime: 'On Air Now',
      archivePath: '/download/NightOfTheLivingDead/Night_of_the_Living_Dead_512kb.mp4',
      mediaType: 'video',
      isLive: true,
    },
  ]);

  // Fetch actual schedule from server to populate live channel cards
  useEffect(() => {
    let mounted = true;
    Promise.all([
      fetch('/api/schedule?guide=cable-tv').then((res) => (res.ok ? res.json() : null)),
      fetch('/api/schedule?guide=audio-podcasts').then((res) => (res.ok ? res.json() : null)),
    ])
      .then(([tvData, audioData]) => {
        if (!mounted) return;
        const allChannels = [
          ...(tvData?.channels || []),
          ...(audioData?.channels || []),
        ];
        if (allChannels.length === 0) return;

        const nowHour = new Date().getHours() + new Date().getMinutes() / 60;
        const parsed = allChannels.slice(0, 3).map((ch: any) => {
          const matchingProg = ch.programs?.find(
            (p: any) => nowHour >= (p.startHour ?? p.startTime ?? 0) && nowHour < (p.endHour ?? p.endTime ?? 24)
          ) || ch.programs?.[0];
          return {
            id: ch.id,
            name: ch.name,
            networkTag: (ch.mediaType === 'audio' ? 'AUDIO' : 'TV'),
            currentProgram: matchingProg?.title || 'Continuous Broadcast Stream',
            airTime: matchingProg ? `${Math.floor(matchingProg.startHour ?? 0)}:00 - ${Math.floor(matchingProg.endHour ?? 24)}:00` : 'Live Feed',
            archivePath: matchingProg?.archivePath || matchingProg?.mediaUrl || '/download/NightOfTheLivingDead/Night_of_the_Living_Dead_512kb.mp4',
            mediaType: ch.mediaType || (matchingProg?.archivePath?.endsWith('.mp3') ? 'audio' : 'video'),
            isLive: true,
          };
        });
        setLiveChannels(parsed);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="space-y-10 pb-16">
      {nowPlaying ? (
        <section
          id="home-now-playing-hero"
          className="relative overflow-hidden rounded-2xl border border-sky-500/20 bg-gradient-to-b from-neutral-900 via-neutral-950 to-neutral-950 p-6 sm:p-8 shadow-2xl"
        >
          <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-sky-500/10 blur-3xl pointer-events-none" />
          <div className="relative z-10 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-8">
            <div className="space-y-4 max-w-2xl">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400 border border-emerald-500/20">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {nowPlaying.isLive ? 'LIVE' : 'NOW PLAYING'}
                </span>
                <span className="text-xs text-neutral-400">
                  {nowPlaying.mediaType === 'audio' ? 'Audio' : 'Video'}
                  {nowPlaying.channelName ? ` • ${nowPlaying.channelName}` : ''}
                </span>
              </div>
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight text-neutral-50 leading-tight">
                {nowPlaying.title}
              </h1>
              {nowPlaying.subtitle && (
                <p className="text-sm sm:text-base text-neutral-400 leading-relaxed max-w-xl">
                  {nowPlaying.subtitle}
                </p>
              )}
              <button
                type="button"
                id="home-now-playing-open-player"
                onClick={() => onNavigate('player')}
                className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-500/20 transition hover:bg-sky-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
              >
                <Play className="h-4 w-4 fill-current" />
                Open Player
              </button>
            </div>
            <div className="w-full lg:w-72 shrink-0 rounded-xl border border-neutral-800/80 bg-neutral-900/60 p-5 backdrop-blur">
              <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
                <span className="text-xs font-semibold text-neutral-200 uppercase tracking-wider">Playback Node</span>
                <span className="text-[11px] font-medium text-emerald-400">ACTIVE</span>
              </div>
              <div className="mt-3.5 space-y-2.5 text-xs">
                <div className="flex justify-between text-neutral-400"><span>Media:</span><span className="font-mono text-neutral-200">{nowPlaying.mediaType || 'unknown'}</span></div>
                <div className="flex justify-between text-neutral-400"><span>Guide:</span><span className="font-mono text-sky-400">{nowPlaying.guideId || 'n/a'}</span></div>
                <div className="flex justify-between text-neutral-400"><span>Source:</span><span className="font-mono text-neutral-200 truncate max-w-[150px]">{nowPlaying.sourceId || 'n/a'}</span></div>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section
          id="home-featured-hero"
          aria-labelledby="featured-heading"
          className="relative overflow-hidden rounded-2xl border border-neutral-800 bg-gradient-to-b from-neutral-900 via-neutral-950 to-neutral-950 p-6 sm:p-8 lg:p-10 shadow-2xl"
        >
          <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-sky-500/10 blur-3xl pointer-events-none" />
          <div className="relative z-10 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-8">
            <div className="max-w-2xl space-y-4">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/15 px-3 py-1 text-xs font-semibold text-sky-400 border border-sky-500/30">
                  <Sparkles className="h-3.5 w-3.5" />
                  {FEATURED_BROADCAST.tag}
                </span>
                <span className="inline-flex items-center gap-1 text-xs text-neutral-400">
                  <Clock className="h-3.5 w-3.5 text-neutral-500" />
                  {FEATURED_BROADCAST.duration}
                </span>
              </div>
              <h1 id="featured-heading" className="text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight text-neutral-50 leading-tight">
                {FEATURED_BROADCAST.title}
              </h1>
              <p className="text-sm sm:text-base text-neutral-400 leading-relaxed max-w-xl">{FEATURED_BROADCAST.description}</p>
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button type="button" id="hero-play-featured-btn" onClick={() => onPlayProgram(FEATURED_BROADCAST.archivePath, FEATURED_BROADCAST.title, FEATURED_BROADCAST.category, FEATURED_BROADCAST.mediaType)} className="flex items-center gap-2 rounded-xl bg-sky-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-500/20 transition hover:bg-sky-400">
                  <Play className="h-4 w-4 fill-current" /> Play Broadcast Now
                </button>
                <button type="button" onClick={() => onNavigate('tv-guide')} className="flex items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-800/80 px-4 py-2.5 text-sm font-medium text-neutral-200 transition hover:bg-neutral-700 hover:text-white">
                  <Tv className="h-4 w-4 text-sky-400" /> Open TV & Audio Guide Grid
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      <section aria-labelledby="recent-heading" className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 id="recent-heading" className="text-lg font-semibold tracking-tight text-neutral-100">Recently Played</h2>
            <p className="mt-1 text-xs text-neutral-500">Playback history and resume state will surface here when real history is available.</p>
          </div>
        </div>
        <div className="rounded-xl border border-dashed border-neutral-800 bg-neutral-950/40 p-6 text-sm text-neutral-500">
          No recently played items are available in this session yet.
        </div>
      </section>

      <section aria-labelledby="live-stations-heading" className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/20"><Radio className="h-4 w-4" /></div>
            <div>
              <h2 id="live-stations-heading" className="text-lg font-semibold tracking-tight text-neutral-100">Live Station Feeds</h2>
              <p className="mt-1 text-xs text-neutral-500">Current AJN channel and schedule sources.</p>
            </div>
          </div>
          <button type="button" onClick={() => onNavigate('tv-guide')} className="flex items-center gap-1 text-xs font-medium text-sky-400 hover:text-sky-300 transition">
            Full 24-Hour Guide Grid <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {liveChannels.map((channel) => (
            <div key={channel.id} className="group relative flex flex-col justify-between rounded-xl border border-neutral-800 bg-neutral-900/60 p-5 transition hover:border-sky-500/30 hover:bg-neutral-900">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className={`rounded px-2 py-0.5 font-mono text-[11px] font-semibold ${channel.mediaType === 'audio' ? 'bg-amber-950/80 text-amber-300 border border-amber-800/40' : 'bg-sky-950/80 text-sky-300 border border-sky-800/40'}`}>{channel.networkTag}</span>
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-400"><span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse" />{channel.airTime}</span>
                </div>
                <div>
                  <h3 className="text-base font-semibold text-neutral-100 group-hover:text-sky-300 transition">{channel.name}</h3>
                  <p className="mt-1 text-xs text-neutral-400 line-clamp-2">{channel.currentProgram}</p>
                </div>
              </div>
              <div className="mt-5 pt-4 border-t border-neutral-800/80 flex items-center justify-between">
                <span className="text-[11px] text-neutral-500 font-mono capitalize">{channel.mediaType || 'Video'} Stream</span>
                <button type="button" onClick={() => onPlayProgram(channel.archivePath, channel.currentProgram, channel.name, channel.mediaType)} className="flex items-center gap-1.5 rounded-lg bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 transition hover:bg-sky-600 hover:text-white">
                  <Play className="h-3.5 w-3.5 fill-current" /> Tune In
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="featured-highlights-heading" className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 id="featured-highlights-heading" className="text-lg font-semibold tracking-tight text-neutral-100">Featured & Highlights</h2>
            <p className="mt-1 text-xs text-neutral-500">Curated archive entries already wired to the existing playback path.</p>
          </div>
          <button type="button" onClick={() => onNavigate('library')} className="text-xs font-medium text-sky-400 hover:text-sky-300 transition">Open Library</button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {ARCHIVE_HIGHLIGHTS.map((item) => (
            <button key={item.id} type="button" onClick={() => onPlayProgram(item.archivePath, item.title, item.category, item.mediaType)} className="group text-left rounded-xl border border-neutral-800 bg-neutral-900/60 p-5 transition hover:border-sky-500/30 hover:bg-neutral-900">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase tracking-wide text-sky-400">{item.badge}</span>
                <Clock className="h-3.5 w-3.5 text-neutral-600" />
              </div>
              <h3 className="mt-3 text-base font-semibold text-neutral-100 group-hover:text-sky-300">{item.title}</h3>
              <p className="mt-1 text-xs text-neutral-400 line-clamp-3">{item.description}</p>
              <div className="mt-4 text-[11px] text-neutral-500">{item.category} • {item.duration}</div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
