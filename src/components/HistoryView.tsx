import { useEffect, useMemo, useState } from 'react';
import { Play, Trash2, X, History as HistoryIcon, Heart } from 'lucide-react';
import type { HistoryEntry } from '../utils/historyStore';
import { filterHistory, groupByDay } from '../utils/historyStore';
import { SyncPanel } from './SyncPanel';
import type { CloudSyncApi } from '../hooks/useCloudSync';

interface HistoryViewProps {
  entries: HistoryEntry[];
  onPlay: (entry: HistoryEntry) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  isFavorite: (id: string) => boolean;
  sync?: CloudSyncApi;
}

const fmtClock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const fmtPos = (s: number) => { const t = Math.floor(s); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`; };

/** Chronological list of everything played, newest first, grouped by day. Distinct from Home's 5-item "Recently Played". */
export function HistoryView({ entries, onPlay, onRemove, onClear, isFavorite, sync }: HistoryViewProps) {
  const [q, setQ] = useState('');
  const [type, setType] = useState<'all' | 'audio' | 'video'>('all');
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearedCount, setClearedCount] = useState<number | null>(null);
  const filtered = useMemo(() => filterHistory(entries, q, type), [entries, q, type]);
  const groups = useMemo(() => groupByDay(filtered, Date.now()), [filtered]);
  useEffect(() => {
    if (clearedCount === null) return;
    const timer = window.setTimeout(() => setClearedCount(null), 5000);
    return () => window.clearTimeout(timer);
  }, [clearedCount]);

  const clearHistory = () => {
    const removed = entries.length;
    if (removed > 0) setClearedCount(removed);
    setConfirmClear(false);
    onClear();
  };

  return (
    <div className="space-y-5" data-testid="history-view">
      {clearedCount !== null && clearedCount > 0 && (
        <div
          role="status"
          aria-live="polite"
          data-testid="history-cleared"
          className="flex items-center justify-between gap-3 rounded-xl border border-emerald-800/60 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200 motion-reduce:transition-none"
        >
          <span>History cleared ({clearedCount} items removed).</span>
          <button
            type="button"
            aria-label="Dismiss history cleared message"
            onClick={() => setClearedCount(null)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-emerald-200 hover:bg-emerald-900/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-neutral-800 pb-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-neutral-50"><HistoryIcon className="h-6 w-6 text-sky-400" aria-hidden="true" /> History</h1>
          <p className="mt-1 text-sm text-neutral-400">Everything you've played on this device, newest first. {entries.length > 0 && <span data-testid="history-count">{entries.length} item{entries.length === 1 ? '' : 's'}</span>}</p>
        </div>
        {entries.length > 0 && (confirmClear ? (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-neutral-300">Clear all history?</span>
            <button type="button" data-testid="history-clear-confirm" onClick={clearHistory} className="rounded-lg bg-red-500 px-3 py-1.5 font-semibold text-white hover:bg-red-400">Yes, clear</button>
            <button type="button" onClick={() => setConfirmClear(false)} className="rounded-lg border border-neutral-700 px-3 py-1.5 text-neutral-200 hover:bg-neutral-800">Cancel</button>
          </div>
        ) : (
          <button type="button" data-testid="history-clear" onClick={() => setConfirmClear(true)} className="flex items-center gap-1.5 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:border-red-500/50 hover:text-red-300"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Clear history</button>
        ))}
      </div>

      {sync && <SyncPanel sync={sync} />}

      {entries.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter history…" aria-label="Filter history" data-testid="history-filter"
            className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-sky-500 focus:outline-none sm:max-w-xs" />
          {(['all', 'video', 'audio'] as const).map((t) => (
            <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(t)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize ${type === t ? 'bg-sky-500 text-white' : 'border border-neutral-700 text-neutral-300 hover:bg-neutral-800'}`}>{t}</button>
          ))}
        </div>
      )}

      {entries.length === 0 ? (
        <div data-testid="history-empty" className="rounded-xl border border-dashed border-neutral-800 bg-neutral-950/40 p-8 text-center text-sm text-neutral-500">No history yet. Anything you start from the Guide, Library, Radio or Search shows up here.</div>
      ) : filtered.length === 0 ? (
        <div data-testid="history-no-match" className="rounded-xl border border-dashed border-neutral-800 p-6 text-center text-sm text-neutral-500">No history matches.</div>
      ) : groups.map((g) => (
        <section key={g.key} aria-label={g.label} className="space-y-2" data-testid="history-group">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{g.label}</h2>
          <ul className="space-y-2">
            {g.entries.map((e) => (
              <li key={e.id} data-testid="history-item" className="flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900/70 p-2 hover:border-sky-500/40">
                <button type="button" onClick={() => onPlay(e)} className="group flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
                  <span className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-neutral-800">
                    {e.thumbnailUrl && <img src={e.thumbnailUrl} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" onError={(ev) => { (ev.currentTarget as HTMLImageElement).style.display = 'none'; }} />}
                    <Play className="relative h-4 w-4 fill-current text-sky-300 drop-shadow" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-neutral-100 group-hover:text-sky-300">{e.title}</span>
                    <span className="block truncate text-[11px] text-neutral-500">
                      {e.mediaType === 'audio' ? 'Audio' : 'Video'}{e.subtitle ? ` · ${e.subtitle}` : ''} · {fmtClock(e.playedAt)}{e.plays > 1 ? ` · played ${e.plays}×` : ''}{e.progressSeconds >= 5 && !e.isLive ? ` · resumes at ${fmtPos(e.progressSeconds)}` : ''}
                    </span>
                  </span>
                  {isFavorite(e.id) && <Heart className="h-4 w-4 shrink-0 fill-rose-500 text-rose-500" aria-label="Favorite" />}
                </button>
                <button type="button" aria-label={`Remove ${e.title} from history`} onClick={() => onRemove(e.id)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-800 hover:text-red-300"><X className="h-4 w-4" aria-hidden="true" /></button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
