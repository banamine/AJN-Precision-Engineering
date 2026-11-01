import { useState } from 'react';
import { Play, Trash2, X, Bookmark, History as HistoryIcon } from 'lucide-react';
import type { Destination } from '../types';
import type { WatchLaterItem } from '../utils/watchLater';

interface WatchLaterViewProps {
  entries: WatchLaterItem[];
  onPlay: (entry: WatchLaterItem) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onNavigate: (dest: Destination) => void;
}

const fmtPos = (s: number) => {
  const t = Math.floor(s); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

/** Things saved to finish later: saved by hand, or automatically once half was played and it was not finished. Local only. */
export function WatchLaterView({ entries, onPlay, onRemove, onClear, onNavigate }: WatchLaterViewProps) {
  const [confirmClear, setConfirmClear] = useState(false);
  return (
    <section aria-labelledby="watch-later-heading" data-testid="watch-later-view" className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Bookmark className="h-6 w-6 text-sky-400" aria-hidden="true" />
          <div>
            <h1 id="watch-later-heading" className="text-xl font-semibold text-neutral-100">Watch Later</h1>
            <p className="text-xs text-neutral-400">Saved on this device only. Half-played items are added automatically and removed when you finish them.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => onNavigate('history')} className="flex items-center gap-1.5 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:border-sky-500/50 hover:text-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
            <HistoryIcon className="h-4 w-4" aria-hidden="true" /> History
          </button>
          {entries.length > 0 && (confirmClear ? (
            <span className="flex items-center gap-2 text-xs text-neutral-300">
              Clear all {entries.length}?
              <button type="button" onClick={() => { setConfirmClear(false); onClear(); }} className="rounded-lg border border-rose-500/60 px-3 py-1.5 text-rose-300 hover:bg-rose-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400">Yes, clear</button>
              <button type="button" onClick={() => setConfirmClear(false)} className="rounded-lg border border-neutral-700 px-3 py-1.5 hover:bg-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">Cancel</button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmClear(true)} className="flex items-center gap-1.5 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:border-rose-500/50 hover:text-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400">
              <Trash2 className="h-4 w-4" aria-hidden="true" /> Clear all
            </button>
          ))}
        </div>
      </header>

      {entries.length === 0 ? (
        <p data-testid="watch-later-empty" className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-6 text-sm text-neutral-400">
          Nothing saved yet. Use the Watch Later button in the player, or play something past the halfway mark and stop.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-800 rounded-lg border border-neutral-800">
          {entries.map((e) => {
            const pct = e.durationSeconds && e.durationSeconds > 0 ? Math.min(100, Math.round((e.progressSeconds / e.durationSeconds) * 100)) : null;
            return (
              <li key={e.id} data-testid="watch-later-row" className="flex items-center gap-3 p-3">
                <button type="button" onClick={() => onPlay(e)} aria-label={`Play ${e.title}${e.progressSeconds >= 5 ? `, resume at ${fmtPos(e.progressSeconds)}` : ''}`}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-sky-300 hover:bg-sky-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
                  <Play className="h-5 w-5" aria-hidden="true" />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-neutral-100">{e.title}</p>
                  <p className="truncate text-xs text-neutral-400">
                    {[e.subtitle, e.progressSeconds >= 5 ? `Resume at ${fmtPos(e.progressSeconds)}${pct !== null ? ` (${pct}%)` : ''}` : null, e.reason === 'auto-half' ? 'Added automatically at halfway' : 'Saved by you'].filter(Boolean).join(' · ')}
                  </p>
                  {pct !== null && (
                    <div className="mt-1 h-1 w-full overflow-hidden rounded bg-neutral-800" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Played so far">
                      <div className="h-full bg-sky-500" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
                <button type="button" onClick={() => onRemove(e.id)} aria-label={`Remove ${e.title} from Watch Later`}
                  className="shrink-0 rounded-full p-2 text-neutral-400 hover:bg-neutral-800 hover:text-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400">
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
