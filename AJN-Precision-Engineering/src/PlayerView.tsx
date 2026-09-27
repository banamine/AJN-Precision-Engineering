import { useState, useEffect } from 'react';
import {
  Play,
  Tv,
  Radio,
  Sparkles,
  Info,
  ShieldCheck,
  Disc3,
  Sliders,
  Maximize2,
  Volume2,
  Keyboard,
  ListVideo,
  Headphones,
} from 'lucide-react';
import MinimalPlayer from '../MinimalPlayer';
import { Destination, NowPlayingMedia, MediaType, PlayProgramCallback } from '../types';

interface PlayerViewProps {
  nowPlaying: NowPlayingMedia | null;
  onSelectProgram: PlayProgramCallback;
  onNavigate: (dest: Destination) => void;
}

const DEFAULT_FEATURED = [
  {
    title: 'NASA Apollo 11 Spaceflight Audio Highlights',
    category: 'Historic Aerospace Vault',
    archivePath: '/download/Apollo11AudioHighlights/apollo_11_audio_highlights_64kb.mp3',
    duration: '45 mins',
    badge: 'Radio Audio',
    mediaType: 'audio' as MediaType,
  },
  {
    title: 'Night of the Living Dead (Master Reel)',
    category: 'Public Domain Cinema Classics',
    archivePath: '/download/NightOfTheLivingDead/Night_of_the_Living_Dead_512kb.mp4',
    duration: '96 mins',
    badge: 'Video MP4',
    mediaType: 'video' as MediaType,
  },
  {
    title: 'Flash Gordon Conquers the Universe',
    category: 'Classic TV Series Vault',
    archivePath: '/download/FlashGordonConquersTheUniverse1940_Chapter1/FlashGordonConquersTheUniverse1940_Chapter1_512kb.mp4',
    duration: '20 mins',
    badge: 'Classic TV',
    mediaType: 'video' as MediaType,
  },
  {
    title: 'War of the Worlds — Mercury Theatre',
    category: 'Old Time Radio Audio Drama',
    archivePath: '/download/OTRR_Mercury_Theater_on_the_Air_Singles/Mercury_381030_WarOfTheWorlds.mp3',
    duration: '58 mins',
    badge: 'Radio Drama',
    mediaType: 'audio' as MediaType,
  },
];

export function PlayerView({ nowPlaying, onSelectProgram, onNavigate }: PlayerViewProps) {
  const [schedulePlaylist, setSchedulePlaylist] = useState<any[]>([])

  const logPlaybackEvent = (event: string, err?: any) => {
    if (!nowPlaying) return;
    const payload = {
      event: `playback/${event}`,
      timestamp: new Date().toISOString(),
      guideId: nowPlaying.guideId || null,
      channelId: nowPlaying.channelId || null,
      sourceId: nowPlaying.sourceId || null,
      programId: nowPlaying.programId || null,
      assetId: nowPlaying.assetId || null,
      archiveIdentifier: nowPlaying.archivePath ? nowPlaying.archivePath.split('/')[2] : null,
      mediaPath: nowPlaying.archivePath || nowPlaying.src || null,
      title: nowPlaying.title || null,
      ...(err ? { mediaErrorCode: err.code, mediaErrorMessage: err.message } : {})
    };
    console.log(`[Playback Diagnostics] ${payload.event}`, payload);
  };

  const handleProgramEnded = async () => {
    logPlaybackEvent('ended');
    if (!nowPlaying?.channelId) return;
    
    // Auto-advance to the next program in the channel schedule
    try {
      const res = await fetch('/api/schedule?guide=' + (nowPlaying.guideId || 'cable-tv'));
      const data = await res.json();
      const channel = (data.channels || []).find((c: any) => c.id === nowPlaying.channelId);
      if (channel && channel.programs?.length) {
        // Find current
        const currentIdx = channel.programs.findIndex((p: any) => (p.archivePath || p.mediaUrl) === nowPlaying.src);
        if (currentIdx !== -1) {
          const nextIdx = (currentIdx + 1) % channel.programs.length;
          const nextProg = channel.programs[nextIdx];
          if (nextProg) {
            onSelectProgram(
              nextProg.archivePath || nextProg.mediaUrl,
              nextProg.title,
              channel.name,
              nextProg.mediaType,
              channel.id,
              nowPlaying.guideId
            );
          }
        }
      }
    } catch (e) {
      console.error("Auto-advance failed", e);
    }
  };;

  useEffect(() => {
    // Fetch both video and audio schedules to populate player switcher
    Promise.all([
      fetch('/api/schedule?guide=cable-tv').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/schedule?guide=audio-podcasts').then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([videoData, audioData]) => {
        const progs: any[] = [];
        if (videoData && Array.isArray(videoData.channels)) {
          videoData.channels.slice(0, 3).forEach((ch: any) => {
            if (Array.isArray(ch.programs)) {
              ch.programs.slice(0, 2).forEach((p: any) => {
                progs.push({
                  title: p.title,
                  channelName: ch.name,
                  archivePath: p.archivePath,
                  mediaType: 'video' as MediaType,
                  duration: `${Math.round(((p.endHour ?? p.endTime ?? 2) - (p.startHour ?? p.startTime ?? 0)) * 60)} mins`,
                });
              });
            }
          });
        }
        if (audioData && Array.isArray(audioData.channels)) {
          audioData.channels.slice(0, 3).forEach((ch: any) => {
            if (Array.isArray(ch.programs)) {
              ch.programs.slice(0, 2).forEach((p: any) => {
                progs.push({
                  title: p.title,
                  channelName: ch.name,
                  archivePath: p.archivePath,
                  mediaType: 'audio' as MediaType,
                  duration: `${Math.round(((p.endHour ?? p.endTime ?? 2) - (p.startHour ?? p.startTime ?? 0)) * 60)} mins`,
                });
              });
            }
          });
        }
        if (progs.length > 0) setSchedulePlaylist(progs);
      })
      .catch(() => {});
  }, []);

  const isAudioActive = nowPlaying?.mediaType === 'audio' || nowPlaying?.archivePath?.endsWith('.mp3');

  return (
    <div className="space-y-8 pb-16">
      {/* ── Active Player Viewport ─────────────────────────────────────────── */}
      {nowPlaying ? (
        <div className="space-y-6">
          <div className="flex flex-col items-center justify-center relative">
            
  

            <MinimalPlayer 
              src={nowPlaying.src} 
              title={nowPlaying.title} 
              onProgramEnded={handleProgramEnded} 
              nowPlaying={nowPlaying} 
              onPlayEvent={() => logPlaybackEvent('play')}
              onPauseEvent={() => logPlaybackEvent('pause')}
              onErrorEvent={(err) => logPlaybackEvent('error', err)}
            />

            {(import.meta as any).env?.DEV && (
              <div className="absolute top-4 left-4 z-50 rounded-lg bg-black/80 p-3 text-[10px] font-mono text-emerald-400 border border-emerald-500/30 backdrop-blur-sm pointer-events-none shadow-lg">
                <div className="font-bold text-emerald-300 mb-1 border-b border-emerald-500/30 pb-1">Dev Diagnostics</div>
                <div>Prog ID: {nowPlaying.programId || 'unresolved'}</div>
                <div>Src ID: {nowPlaying.sourceId || 'unresolved'}</div>
                <div>Asset ID: {nowPlaying.assetId || 'unresolved'}</div>
                <div className="text-emerald-500/80 mt-1 pt-1 border-t border-emerald-500/20">
                  Guide: {nowPlaying.guideId || 'unresolved'}<br/>
                  Channel: {nowPlaying.channelId || 'unresolved'}
                </div>
              </div>
            )}
          </div>

          {/* Broadcast Metadata & Diagnostics Strip */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Stream Info Box */}
            <div className="lg:col-span-2 rounded-xl border border-neutral-800 bg-neutral-900/60 p-5 backdrop-blur space-y-3">
              <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
                <div className="flex items-center gap-2">
                  {isAudioActive ? <Headphones className="h-4 w-4 text-amber-400" /> : <Tv className="h-4 w-4 text-sky-400" />}
                  <h2 className="text-sm font-semibold text-neutral-100">
                    {isAudioActive ? 'Audio & Podcast Stream Information' : 'Broadcast Video Stream Information'}
                  </h2>
                </div>
                <span className={`rounded px-2 py-0.5 text-[11px] font-mono border ${
                  isAudioActive
                    ? 'bg-amber-950 text-amber-300 border-amber-800/60'
                    : 'bg-sky-950 text-sky-400 border-sky-800/60'
                }`}>
                  {isAudioActive ? 'Audio Mode Active' : 'Video Mode Active'}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-neutral-500 block">Title:</span>
                  <span className="font-medium text-neutral-200">{nowPlaying.title}</span>
                </div>
                {nowPlaying.subtitle && (
                  <div>
                    <span className="text-neutral-500 block">Category / Channel:</span>
                    <span className="font-medium text-neutral-200">{nowPlaying.subtitle}</span>
                  </div>
                )}
                <div>
                  <span className="text-neutral-500 block">Media Target Type:</span>
                  <span className="font-mono text-[11px] text-neutral-300 capitalize">
                    {isAudioActive ? 'Audio (MP3 / Stream)' : 'Video (MP4 / HLS)'}
                  </span>
                </div>
                <div>
                  <span className="text-neutral-500 block">Audio Graph Pipeline:</span>
                  <span className="text-emerald-400 font-medium">M1 Singleton + Limiter (-18 dBFS)</span>
                </div>
              </div>
            </div>

            {/* Keyboard Shortcuts Helper */}
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5 backdrop-blur space-y-3">
              <div className="flex items-center gap-2 border-b border-neutral-800 pb-3">
                <Keyboard className="h-4 w-4 text-neutral-400" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
                  Player Controls
                </h3>
              </div>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between text-neutral-400">
                  <span>Play / Pause</span>
                  <kbd className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[10px] text-neutral-300">
                    Space / K
                  </kbd>
                </div>
                <div className="flex justify-between text-neutral-400">
                  <span>Mute / Unmute</span>
                  <kbd className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[10px] text-neutral-300">
                    M
                  </kbd>
                </div>
                <div className="flex justify-between text-neutral-400">
                  <span>Skip -10s / +10s</span>
                  <kbd className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[10px] text-neutral-300">
                    ← / →
                  </kbd>
                </div>
                <div className="flex justify-between text-neutral-400">
                  <span>Fullscreen</span>
                  <kbd className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[10px] text-neutral-300">
                    F
                  </kbd>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ── Empty State: Choose a Broadcast ─────────────────────────────── */
        <div className="space-y-8">
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-8 text-center space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-400 border border-sky-500/20">
              <Tv className="h-7 w-7" />
            </div>
            <div className="max-w-md mx-auto space-y-1">
              <h1 className="text-xl font-semibold text-neutral-100">No Active Stream Loaded</h1>
              <p className="text-xs text-neutral-400">
                Select a broadcast channel or archive audio/video reel below to start the AJN Precision player.
              </p>
            </div>
            <div className="flex justify-center gap-3 pt-2">
              <button
                type="button"
                id="empty-player-guide-btn"
                onClick={() => onNavigate('tv-guide')}
                className="flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-sky-400 cursor-pointer"
              >
                <Tv className="h-3.5 w-3.5" />
                Browse TV & Audio Guide
              </button>
              <button
                type="button"
                id="empty-player-library-btn"
                onClick={() => onNavigate('library')}
                className="flex items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-800 px-4 py-2 text-xs font-medium text-neutral-200 transition hover:bg-neutral-700 cursor-pointer"
              >
                <Disc3 className="h-3.5 w-3.5" />
                Browse Library
              </button>
            </div>
          </div>

          {/* Quick Start Presets */}
          <div className="space-y-4">
            <h2 className="text-base font-semibold text-neutral-200">Recommended Broadcast Feeds</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {DEFAULT_FEATURED.map((item, idx) => (
                <div
                  key={idx}
                  className="flex flex-col justify-between rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 transition hover:border-neutral-700 hover:bg-neutral-900"
                >
                  <div className="space-y-2">
                    <span className="rounded bg-neutral-800 px-2 py-0.5 text-[10px] font-mono text-neutral-300">
                      {item.badge}
                    </span>
                    <h3 className="text-xs font-semibold text-neutral-100 line-clamp-2">{item.title}</h3>
                    <p className="text-[11px] text-neutral-400">{item.category}</p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-neutral-800 flex items-center justify-between">
                    <span className="text-[11px] text-neutral-500">{item.duration}</span>
                    <button
                      type="button"
                      onClick={() => onSelectProgram(item.archivePath, item.title, item.category, item.mediaType)}
                      className="flex items-center gap-1 rounded-lg bg-sky-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-sky-500 cursor-pointer"
                    >
                      <Play className="h-3 w-3 fill-current" />
                      Play
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Quick Channel Switcher / Program List ─────────────────────────── */}
      <div className="space-y-4 pt-4 border-t border-neutral-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ListVideo className="h-4 w-4 text-sky-400" />
            <h2 className="text-sm font-semibold text-neutral-100">Schedule Quick Switcher</h2>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('tv-guide')}
            className="text-xs text-sky-400 hover:text-sky-300"
          >
            Open Full Guide Grid →
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(schedulePlaylist.length > 0 ? schedulePlaylist.slice(0, 6) : DEFAULT_FEATURED).map((item, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => onSelectProgram(item.archivePath, item.title, item.channelName || item.category, item.mediaType)}
              className="group flex items-center justify-between rounded-lg border border-neutral-800/80 bg-neutral-900/40 p-3 text-left transition hover:border-neutral-700 hover:bg-neutral-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 cursor-pointer"
            >
              <div className="min-w-0 pr-3">
                <span className="text-[10px] font-mono text-neutral-400 block truncate">
                  {item.channelName || item.category}
                </span>
                <span className="text-xs font-medium text-neutral-200 group-hover:text-sky-300 truncate block">
                  {item.title}
                </span>
              </div>
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-neutral-800 text-neutral-300 group-hover:bg-sky-500 group-hover:text-white transition">
                <Play className="h-3.5 w-3.5 fill-current" />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

