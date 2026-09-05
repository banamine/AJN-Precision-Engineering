import { useState, useEffect } from 'react';
import {
  Tv,
  Clock,
  Filter,
  Calendar,
  Sparkles,
  Info,
  ChevronRight,
  Radio,
  Layers,
  Headphones,
} from 'lucide-react';
import EpgGuide from '../EpgGuide';
import { Guide, MediaType, PlayProgramCallback } from '../types';

interface TvGuideViewProps {
  onSelectProgram: PlayProgramCallback;
}

export function TvGuideView({ onSelectProgram }: TvGuideViewProps) {
  const [guides, setGuides] = useState<Guide[]>([
    {
      id: 'cable-tv',
      name: 'Cable TV',
      type: 'video',
      enabled: true,
      description: '24-Hour Broadcast Television & Classic Cinema',
    },
    {
      id: 'audio-podcasts',
      name: 'Audio & Podcasts',
      type: 'audio',
      enabled: true,
      description: 'Radio streams, historic aerospace vaults, audio dramas, and podcasts',
    },
  ]);
  const [selectedGuideId, setSelectedGuideId] = useState<string>('cable-tv');

  useEffect(() => {
    fetch('/api/guides')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.guides) && data.guides.length > 0) {
          setGuides(data.guides);
        }
      })
      .catch(() => {});
  }, []);

  const currentGuide = guides.find((g) => g.id === selectedGuideId) || guides[0];
  const now = new Date();
  const dateFormatted = now.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className="space-y-6 pb-16">
      {/* ── Dual-Guide Header & Mode Switcher ──────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-neutral-800 pb-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg border ${
              currentGuide.type === 'audio'
                ? 'bg-amber-500/10 text-amber-400 border-amber-500/25'
                : 'bg-sky-500/10 text-sky-400 border-sky-500/25'
            }`}>
              {currentGuide.type === 'audio' ? <Headphones className="h-4 w-4" /> : <Tv className="h-4 w-4" />}
            </div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-neutral-50">
              {currentGuide.name} Broadcast Grid
            </h1>
          </div>
          <p className="text-xs text-neutral-400">
            {currentGuide.description || 'Normalized 24-hour programming timeline with live sweep line. Click any segment to stream.'}
          </p>
        </div>

        {/* Date and Live indicator */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-300">
            <Calendar className="h-3.5 w-3.5 text-neutral-400" />
            <span>{dateFormatted}</span>
          </div>

          <div className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs ${
            currentGuide.type === 'audio'
              ? 'border-amber-500/30 bg-amber-950/40 text-amber-300'
              : 'border-sky-500/30 bg-sky-950/40 text-sky-300'
          }`}>
            <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
            <span className="font-mono font-medium">Live Grid Active</span>
          </div>
        </div>
      </div>

        {/* ── Dual-Guide Selector Switcher Tabs ─────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-neutral-800/80 bg-neutral-900/60 p-2.5 backdrop-blur">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-neutral-400 pl-2">Select Guide:</span>
            <div className="flex items-center gap-1.5 bg-neutral-950/80 p-1 rounded-lg border border-neutral-800">
              {guides.length === 0 ? (
                <span className="text-xs text-neutral-500 px-3 py-1.5">Loading...</span>
              ) : guides.map((g) => {
              const isSelected = g.id === selectedGuideId;
              const isAudio = g.type === 'audio';
              return (
                <button
                  key={g.id}
                  type="button"
                  id={`guide-tab-${g.id}`}
                  onClick={() => setSelectedGuideId(g.id)}
                  className={`flex items-center gap-2 rounded-md px-3.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
                    isSelected
                      ? isAudio
                        ? 'bg-amber-500 text-neutral-950 shadow-sm'
                        : 'bg-sky-500 text-white shadow-sm'
                      : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60'
                  }`}
                >
                  {isAudio ? <Radio className="h-3.5 w-3.5" /> : <Tv className="h-3.5 w-3.5" />}
                  <span>{g.name}</span>
                  <span className={`text-[10px] font-mono uppercase px-1.5 py-0.2 rounded ${
                    isSelected
                      ? isAudio
                        ? 'bg-amber-600/30 text-neutral-950'
                        : 'bg-sky-600/50 text-sky-100'
                      : 'bg-neutral-800 text-neutral-400'
                  }`}>
                    {g.type}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-neutral-400 pr-2">
          <Clock className="h-3.5 w-3.5 text-sky-400 shrink-0" />
          <span className="text-[11px] text-neutral-400">
            Unified timeline contract • Single-owner Web Audio pipeline
          </span>
        </div>
      </div>

      {/* ── Canonical EpgGuide Grid ───────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl shadow-2xl border border-neutral-800">
        <EpgGuide guideId={selectedGuideId} onSelectProgram={onSelectProgram} />
      </div>

      {/* ── Guide Notes & Legend ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-neutral-200">
            <span className={`h-2.5 w-2.5 rounded-full ${currentGuide.type === 'audio' ? 'bg-amber-400' : 'bg-sky-400'}`} />
            <span>On Air Now (Active)</span>
          </div>
          <p className="mt-1.5 text-xs text-neutral-400">
            Highlighted {currentGuide.type === 'audio' ? 'amber' : 'sky'} program blocks denote currently airing segments based on system clock.
          </p>
        </div>

        <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-neutral-200">
            <span className="h-2.5 w-2.5 rounded-full bg-neutral-700" />
            <span>Upcoming / Archive</span>
          </div>
          <p className="mt-1.5 text-xs text-neutral-400">
            Dark blocks represent earlier broadcasts or upcoming segments available on-demand.
          </p>
        </div>

        <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-neutral-200">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
            <span>Red Time Sweeper</span>
          </div>
          <p className="mt-1.5 text-xs text-neutral-400">
            Updates every 30 seconds to show the exact current hour across the entire 24h timeline.
          </p>
        </div>
      </div>
    </div>
  );
}

