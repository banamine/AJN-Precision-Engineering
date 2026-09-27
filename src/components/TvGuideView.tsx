import { useState, useEffect } from 'react';
import { Tv, Clock, Calendar, Radio, Headphones } from 'lucide-react';
import EpgGuide from '../EpgGuide';
import { Guide, PlayProgramCallback } from '../types';
import { AjnResourcePanel } from './AjnResourcePanel';
import { RushEpisodePicker } from './RushEpisodePicker';

interface TvGuideViewProps {
  onSelectProgram: PlayProgramCallback;
}

const AJN_RESOURCE_GUIDE: Guide = {
  id: 'ajn-archive-special-feeds',
  name: 'AJN Archive & Special Feeds',
  type: 'video',
  enabled: true,
  description: 'Live AJN Audio/Video Resource Links: Alex, War Room, Sunday Live, Hourly Video, and Hourly Audio',
};

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
    AJN_RESOURCE_GUIDE,
  ]);
  const [selectedGuideId, setSelectedGuideId] = useState<string>('cable-tv');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/guides', { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data || !Array.isArray(data.guides)) return;
        const serverGuides = data.guides as Guide[];
        setGuides([...serverGuides.filter((guide) => guide.id !== AJN_RESOURCE_GUIDE.id), AJN_RESOURCE_GUIDE]);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      });
    return () => controller.abort();
  }, []);

  const currentGuide = guides.find((g) => g.id === selectedGuideId) || AJN_RESOURCE_GUIDE;
  const isAjnResourceGuide = selectedGuideId === AJN_RESOURCE_GUIDE.id;
  const dateFormatted = new Date().toLocaleDateString(undefined, {
    weekday: 'long', month: 'short', day: 'numeric',
  });

  return (
    <div className="space-y-6 pb-16">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-neutral-800 pb-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg border ${currentGuide.type === 'audio' ? 'bg-amber-500/10 text-amber-400 border-amber-500/25' : 'bg-sky-500/10 text-sky-400 border-sky-500/25'}`}>
              {currentGuide.type === 'audio' ? <Headphones className="h-4 w-4" /> : <Tv className="h-4 w-4" />}
            </div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-neutral-50">{currentGuide.name} Broadcast Grid</h1>
          </div>
          <p className="text-xs text-neutral-400">{currentGuide.description || 'Normalized 24-hour programming timeline with live sweep line. Click any segment to stream.'}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-300">
            <Calendar className="h-3.5 w-3.5 text-neutral-400" /><span>{dateFormatted}</span>
          </div>
          <div className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs ${currentGuide.type === 'audio' ? 'border-amber-500/30 bg-amber-950/40 text-amber-300' : 'border-sky-500/30 bg-sky-950/40 text-sky-300'}`}>
            <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" /><span className="font-mono font-medium">Live Grid Active</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-neutral-800/80 bg-neutral-900/60 p-2.5 backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-neutral-400 pl-2">Select Guide:</span>
          <div className="flex flex-wrap items-center gap-1.5 bg-neutral-950/80 p-1 rounded-lg border border-neutral-800">
            {guides.map((guide) => {
              const isSelected = guide.id === selectedGuideId;
              const isAudio = guide.type === 'audio';
              return (
                <button key={guide.id} type="button" id={`guide-tab-${guide.id}`} onClick={() => setSelectedGuideId(guide.id)} className={`flex items-center gap-2 rounded-md px-3.5 py-1.5 text-xs font-semibold transition cursor-pointer ${isSelected ? (isAudio ? 'bg-amber-500 text-neutral-950 shadow-sm' : 'bg-sky-500 text-white shadow-sm') : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60'}`}>
                  {isAudio ? <Radio className="h-3.5 w-3.5" /> : <Tv className="h-3.5 w-3.5" />}
                  <span>{guide.name}</span>
                  <span className={`text-[10px] font-mono uppercase px-1.5 py-0.2 rounded ${isSelected ? (isAudio ? 'bg-amber-600/30 text-neutral-950' : 'bg-sky-600/50 text-sky-100') : 'bg-neutral-800 text-neutral-400'}`}>{guide.type}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-neutral-400 pr-2">
          <Clock className="h-3.5 w-3.5 text-sky-400 shrink-0" /><span className="text-[11px]">Unified timeline contract • Single-owner Web Audio pipeline</span>
        </div>
      </div>

      {isAjnResourceGuide ? (
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-5 shadow-2xl">
          <AjnResourcePanel onPlayProgram={onSelectProgram} />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-xl shadow-2xl border border-neutral-800">
            <EpgGuide guideId={selectedGuideId} onSelectProgram={onSelectProgram} />
          </div>
          {selectedGuideId === 'audio-podcasts' && <RushEpisodePicker onPlay={onSelectProgram} />}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4"><div className="flex items-center gap-2 text-xs font-semibold text-neutral-200"><span className={`h-2.5 w-2.5 rounded-full ${currentGuide.type === 'audio' ? 'bg-amber-400' : 'bg-sky-400'}`} /><span>On Air Now (Active)</span></div><p className="mt-1.5 text-xs text-neutral-400">AJN resource entries are live source data when this guide is selected; other guides retain the canonical EPG grid.</p></div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4"><div className="flex items-center gap-2 text-xs font-semibold text-neutral-200"><span className="h-2.5 w-2.5 rounded-full bg-neutral-700" /><span>Upcoming / Archive</span></div><p className="mt-1.5 text-xs text-neutral-400">Archive entries remain available on demand through the existing playback pipeline.</p></div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4"><div className="flex items-center gap-2 text-xs font-semibold text-neutral-200"><span className="h-2.5 w-2.5 rounded-full bg-red-500" /><span>Source</span></div><p className="mt-1.5 text-xs text-neutral-400">Authoritative source: rss.alexjones.media</p></div>
      </div>
    </div>
  );
}
