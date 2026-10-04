import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Headphones, Play, RefreshCw, Tv } from 'lucide-react';
import type { PlayProgramCallback } from '../types';
import { loadAjnFeeds } from '../services/ajnFeeds';
import { buildRadioCatalog, type RadioEntry, type RadioFeedItem } from '../utils/ajnRadioCatalog';
import { AJN_CHANNEL_LABELS } from '../utils/ajnClassify';

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

interface Props { onPlayProgram: PlayProgramCallback }

function renderEntry(entry: RadioEntry, onPlayProgram: PlayProgramCallback) {
  const label = AJN_CHANNEL_LABELS[entry.channel];
  return (
    <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4" data-testid="radio-entry">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-neutral-100 truncate">{entry.title}</h3>
        {entry.needsReview && <p className="mt-1 text-[11px] text-amber-400">Date not verified from filename</p>}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPlayProgram(entry.audioUrl, entry.title, label, 'audio', `ajn-radio`, `ajn-radio`, entry.id)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-sky-600 hover:text-white"
        >
          <Headphones className="h-3.5 w-3.5" /> Listen
        </button>
        {entry.videoUrl && (
          <button
            type="button"
            onClick={() => onPlayProgram(entry.videoUrl!, entry.title, label, 'video', `ajn-radio`, `ajn-radio`, `${entry.id}:video`)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-800"
          >
            <Tv className="h-3.5 w-3.5" /> Watch Video
          </button>
        )}
      </div>
    </li>
  );
}

function Section({ title, entries, onPlayProgram }: { title: string; entries: RadioEntry[]; onPlayProgram: PlayProgramCallback }) {
  return (
    <section aria-label={title} className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight text-neutral-100">{title}</h2>
      {entries.length === 0
        ? <div className="rounded-xl border border-dashed border-neutral-800 p-5 text-xs text-neutral-500">No {title} episodes in the current feeds.</div>
        : <ul className="space-y-2">{entries.map(entry => renderEntry(entry, onPlayProgram))}</ul>}
    </section>
  );
}

export function RadioView({ onPlayProgram }: Props) {
  const [items, setItems] = useState<RadioFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    controller.current?.abort();
    const ctl = new AbortController();
    controller.current = ctl;
    setLoading(true);
    setError(null);
    try {
      const { items: feedItems, failures } = await loadAjnFeeds(ctl.signal);
      if (ctl.signal.aborted) return;
      setItems(feedItems.filter(i => i.url).map(i => ({ id: i.id, title: i.title, url: i.url!, mediaType: i.mediaType, publishedAt: i.publishedAt })));
      if (feedItems.length === 0 && failures > 0) setError('AJN feeds are currently unavailable.');
      else if (failures > 0) setError(`${failures} AJN feed${failures === 1 ? '' : 's'} unavailable; showing available episodes.`);
    } catch (err) {
      if (!ctl.signal.aborted) setError(err instanceof Error ? err.message : 'Unable to load AJN feeds');
    } finally {
      if (!ctl.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_INTERVAL_MS);
    return () => { window.clearInterval(timer); controller.current?.abort(); };
  }, [load]);

  const catalog = useMemo(() => buildRadioCatalog(items), [items]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-4 py-8" id="ajn-radio-view">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-100">AJN Radio</h1>
          <p className="mt-1 text-xs text-neutral-500">Episodes from the AJN feeds. Watch Video appears only when the matching hourly video exists.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>
      {error && <div role="alert" className="rounded-xl border border-red-900/50 bg-red-950/20 p-4 text-xs text-red-300">{error}</div>}
      {loading && items.length === 0 && !error && <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5 text-xs text-neutral-400">Loading AJN feeds…</div>}
      {(!loading || items.length > 0) && (
        <>
          <Section title={AJN_CHANNEL_LABELS['ajn-radio']} entries={catalog.radio} onPlayProgram={onPlayProgram} />
          <Section title={AJN_CHANNEL_LABELS['ajn-exclusive']} entries={catalog.exclusive} onPlayProgram={onPlayProgram} />
        </>
      )}
    </div>
  );
}
