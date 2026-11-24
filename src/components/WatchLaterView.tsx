import { useState } from 'react';
import { PlayerWidgets, type WidgetSpec } from './PlayerWidget';
import { Play, Trash2, X, Bookmark, History as HistoryIcon, GripVertical, ChevronUp, ChevronDown } from 'lucide-react';
import type { Destination } from '../types';
import type { WatchLaterItem } from '../utils/watchLater';

interface WatchLaterViewProps {
  entries: WatchLaterItem[];
  onPlay: (entry: WatchLaterItem) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  /** Drop `fromId` where `toId` is (drag and drop). */
  onMove: (fromId: string, toId: string) => void;
  /** One step up (-1) or down (1), for the keyboard and the arrow buttons. */
  onNudge: (id: string, dir: -1 | 1) => void;
  onNavigate: (dest: Destination) => void;
}

const fmtPos = (s: number) => {
  const t = Math.floor(s); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

/** Things saved to finish later: saved by hand, or automatically once half was played and it was not finished. Local only. */
export function WatchLaterView({ entries, onPlay, onRemove, onClear, onMove, onNudge, onNavigate }: WatchLaterViewProps) {
  const [confirmClear, setConfirmClear] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const endDrag = () => { setDragId(null); setOverId(null); };
  return (
    <section aria-labelledby="watch-later-heading" data-testid="watch-later-view" className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Bookmark className="h-6 w-6 text-[var(--ajn-accent)]" aria-hidden="true" />
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
        <div className="space-y-0">
          <PlayerWidgets tab="watch-later" widgets={(() => {
            const renderList = (list: typeof entries) => (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="watch-later-grid">
          {list.map((e) => {
            const pct = e.durationSeconds && e.durationSeconds > 0 ? Math.min(100, Math.round((e.progressSeconds / e.durationSeconds) * 100)) : null;
            const dur = e.durationSeconds && e.durationSeconds > 0 ? fmtPos(e.durationSeconds) : (e.duration || null);
            const tags = [e.mediaType === 'audio' ? 'Audio' : e.mediaType ? 'Video' : null, e.channelName || e.subtitle || null].filter(Boolean) as string[];
            return (
              <li key={e.id} data-testid="watch-later-row" draggable
                onDragStart={(ev) => { setDragId(e.id); ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', e.id); }}
                onDragOver={(ev) => { if (dragId && dragId !== e.id) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; if (overId !== e.id) setOverId(e.id); } }}
                onDrop={(ev) => { ev.preventDefault(); if (dragId && dragId !== e.id) onMove(dragId, e.id); endDrag(); }}
                onDragEnd={endDrag}
                data-dragging={dragId === e.id ? 'true' : undefined} data-drop-target={overId === e.id && dragId !== e.id ? 'true' : undefined}
                className={`flex flex-col gap-3 rounded-xl border bg-[var(--ajn-surface)] p-3 ${overId === e.id && dragId !== e.id ? 'border-[var(--ajn-accent)] ring-2 ring-[var(--ajn-accent)]/40' : 'border-[var(--ajn-border)]'} ${dragId === e.id ? 'opacity-50' : ''}`}>
                <div className="-mb-1 flex items-center justify-between text-neutral-500">
                  <span title="Drag to reorder" className="flex cursor-grab items-center gap-1 text-[11px] active:cursor-grabbing"><GripVertical className="h-4 w-4" aria-hidden="true" />Drag to reorder</span>
                  <span className="flex items-center gap-1">
                    <button type="button" onClick={() => onNudge(e.id, -1)} aria-label={`Move ${e.title} up`} className="rounded p-1 hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ajn-accent)]"><ChevronUp className="h-4 w-4" aria-hidden="true" /></button>
                    <button type="button" onClick={() => onNudge(e.id, 1)} aria-label={`Move ${e.title} down`} className="rounded p-1 hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ajn-accent)]"><ChevronDown className="h-4 w-4" aria-hidden="true" /></button>
                  </span>
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={() => onPlay(e)} tabIndex={-1} aria-hidden="true" className="relative h-[72px] w-[104px] shrink-0 overflow-hidden rounded-lg bg-[var(--ajn-card)]">
                    {e.thumbnailUrl && <img src={e.thumbnailUrl} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" onError={(ev) => { (ev.currentTarget as HTMLImageElement).style.display = 'none'; }} />}
                    <span className="absolute inset-0 flex items-center justify-center"><Play className="h-6 w-6 fill-current text-white drop-shadow" /></span>
                    {dur && <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[11px] text-white">{dur}</span>}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-semibold text-neutral-100">{e.title}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {tags.map((t) => <span key={t} className="max-w-full truncate rounded-full border border-[var(--ajn-border)] px-2 py-0.5 text-[11px] text-neutral-300">{t}</span>)}
                    </div>
                    <p className="mt-1.5 truncate text-xs text-neutral-400">
                      {[e.progressSeconds >= 5 ? `Resume at ${fmtPos(e.progressSeconds)}${pct !== null ? ` (${pct}%)` : ''}` : null, e.reason === 'auto-half' ? 'Added automatically at halfway' : 'Saved by you'].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </div>
                {pct !== null && (
                  <div className="h-1 w-full overflow-hidden rounded bg-[var(--ajn-border)]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Played so far">
                    <div className="h-full bg-[var(--ajn-accent)]" style={{ width: `${pct}%` }} />
                  </div>
                )}
                <div className="mt-auto grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => onPlay(e)} aria-label={`Play ${e.title}${e.progressSeconds >= 5 ? `, resume at ${fmtPos(e.progressSeconds)}` : ''}`}
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-[var(--ajn-border)] bg-[var(--ajn-card)] px-3 py-2 text-sm font-semibold text-neutral-100 hover:border-[var(--ajn-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ajn-accent)]">
                    <Play className="h-4 w-4 fill-current" aria-hidden="true" /> Play
                  </button>
                  <button type="button" onClick={() => onRemove(e.id)} aria-label={`Remove ${e.title} from Watch Later`}
                    className="flex items-center justify-center gap-1.5 rounded-lg bg-[var(--ajn-accent)] px-3 py-2 text-sm font-semibold text-[var(--ajn-accent-text)] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ajn-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ajn-bg)]">
                    <X className="h-4 w-4" aria-hidden="true" /> Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
            );
            const resume = entries.filter((e) => e.progressSeconds >= 5);
            const rest = entries.filter((e) => e.progressSeconds < 5);
            const out: WidgetSpec[] = [];
            if (resume.length) out.push({ key: 'resume', title: `Resume · ${resume.length}`, defaultOpenWide: true, defaultOpenNarrow: true, content: renderList(resume) });
            if (rest.length) out.push({ key: 'saved', title: `Saved · ${rest.length}`, defaultOpenWide: true, defaultOpenNarrow: !resume.length, content: renderList(rest) });
            return out;
          })()} />
        </div>
      )}
    </section>
  );
}
