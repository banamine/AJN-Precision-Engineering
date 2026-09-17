import { useEffect, useState } from 'react';
import { Check, Headphones, Tv } from 'lucide-react';
import { MediaType, PlayProgramCallback, RecentlyPlayedItem } from '../types';
import { getRecentlyPlayed, subscribeRecentlyPlayed } from '../use-recently-played';

interface RecentlyPlayedProps {
  onPlayProgram: PlayProgramCallback;
}

function mediaLabel(mediaType: MediaType): string {
  return mediaType === 'audio' ? 'Audio' : 'Video';
}

export function RecentlyPlayed({ onPlayProgram }: RecentlyPlayedProps) {
  const [items, setItems] = useState<RecentlyPlayedItem[]>(() => getRecentlyPlayed());

  useEffect(() => subscribeRecentlyPlayed(() => setItems(getRecentlyPlayed())), []);

  if (items.length === 0) return null;

  return (
    <section aria-labelledby="recently-played-heading" className="space-y-4 mt-10">
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/10 text-violet-400 border border-violet-500/20">
          <Tv className="h-4 w-4" />
        </div>
        <h2 id="recently-played-heading" className="text-lg font-semibold tracking-tight text-neutral-100">
          Recently Played
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
        {items.slice(0, 5).map((item) => (
          <button
            type="button"
            key={item.id}
            onClick={() => onPlayProgram(item.archivePath || item.src, item.title, item.subtitle, item.mediaType)}
            className="text-left flex flex-col justify-between rounded-lg border border-neutral-800 bg-neutral-900/50 overflow-hidden transition hover:border-neutral-700 hover:bg-neutral-900/80 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          >
            {item.thumbnailUrl ? (
              <div className="relative h-24 w-full bg-neutral-800">
                <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" />
              </div>
            ) : (
              <div className="relative h-24 w-full bg-gradient-to-br from-neutral-800 to-neutral-900 flex items-center justify-center">
                {item.mediaType === 'audio' ? (
                  <Headphones className="h-8 w-8 text-amber-600" />
                ) : (
                  <Tv className="h-8 w-8 text-sky-600" />
                )}
              </div>
            )}

            <div className="p-3 space-y-2 w-full">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-xs font-semibold text-neutral-100 line-clamp-2 flex-1">{item.title}</h3>
                {item.completed && <Check aria-label="Completed" className="h-4 w-4 text-emerald-500 shrink-0" />}
              </div>
              {item.subtitle && <p className="text-[11px] text-neutral-500 line-clamp-1">{item.subtitle}</p>}
              <div className="flex items-center justify-between pt-1">
                <span className="text-[10px] rounded px-1.5 py-0.5 bg-neutral-800 text-neutral-400">{mediaLabel(item.mediaType)}</span>
                {item.completed ? (
                  <span className="text-[10px] text-emerald-500 font-medium">✓ Completed</span>
                ) : (
                  <span className="text-[10px] text-neutral-500">Resume</span>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
