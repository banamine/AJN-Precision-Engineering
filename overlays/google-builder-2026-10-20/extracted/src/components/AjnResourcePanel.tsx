import { useMemo, useState } from 'react';
import { Headphones, Play, RefreshCw, Tv } from 'lucide-react';
import type { PlayProgramCallback } from '../types';
import type { AjnFeedItem } from '../services/ajnFeeds';
import { useAjnFeeds } from '../hooks/useAjnFeeds';
import { labelAjnItem } from '../utils/ajnLabels';
import { ShowArt } from './ShowArt';
import { ajnArtFor } from '../utils/ajnArt';
import { ClassicRadioTheatreShelf } from './ClassicRadioTheatreShelf';

interface Props {
  onPlayProgram: PlayProgramCallback;
  className?: string;
}

const COLLAPSED = 6;
const EXPANDED = 12;

function byNewest(a: AjnFeedItem, b: AjnFeedItem): number {
  const aTime = Date.parse(a.publishedAt || '');
  const bTime = Date.parse(b.publishedAt || '');
  return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
}

function ResourceCard({ item, onPlayProgram }: { key?: string; item: AjnFeedItem; onPlayProgram: PlayProgramCallback }) {
  const label = labelAjnItem(item);
  const title = label ? label.show : item.title;
  const detail = label ? [label.detail, label.dateLabel].join(' · ') : (Number.isFinite(Date.parse(item.publishedAt || '')) ? new Date(item.publishedAt!).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '');
  const Icon = item.mediaType === 'audio' ? Headphones : Tv;
  return (
    <li>
      <button
        type="button"
        onClick={() => onPlayProgram(item.url!, label ? `${label.show} · ${label.detail}` : item.title, item.feedId, item.mediaType, undefined, `ajn-${item.feedId}`, item.id)}
        aria-label={`Play ${title}${detail ? `, ${detail}` : ''}`}
        className="group flex w-full items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-2.5 text-left transition hover:border-sky-500/40 hover:bg-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
      >
        <ShowArt label={title} mediaType={item.mediaType} src={item.thumbnailUrl || ajnArtFor({ feedId: item.feedId, show: label?.show ?? item.title, mediaType: item.mediaType })} className="h-14 w-24 shrink-0 rounded-lg" iconOnly />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-neutral-100">{title}</span>
          <span className="block truncate text-xs text-neutral-400">{detail || ' '}</span>
          <span className="mt-0.5 inline-flex items-center gap-1 font-mono text-[10px] text-neutral-600"><Icon className="h-3 w-3" aria-hidden="true" />{item.feedId}</span>
        </span>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-neutral-300 transition group-hover:bg-sky-600 group-hover:text-white"><Play className="ml-0.5 h-3.5 w-3.5 fill-current" /></span>
      </button>
    </li>
  );
}

function Group({ title, icon: Icon, items, total, onPlayProgram }: { title: string; icon: typeof Tv; items: AjnFeedItem[]; total: number; onPlayProgram: PlayProgramCallback }) {
  const [more, setMore] = useState(false);
  const shown = items.slice(0, more ? EXPANDED : COLLAPSED);
  if (items.length === 0) return null;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-neutral-300"><Icon className="h-4 w-4 text-sky-400" aria-hidden="true" />{title}<span className="font-mono text-[11px] font-normal text-neutral-600">{total}</span></h3>
        {items.length > COLLAPSED && <button type="button" onClick={() => setMore((m) => !m)} className="text-xs font-medium text-sky-400 hover:text-sky-300">{more ? 'Show fewer' : `Show more`}</button>}
      </div>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((item) => <ResourceCard key={`${item.feedId}:${item.id}`} item={item} onPlayProgram={onPlayProgram} />)}
      </ul>
    </div>
  );
}

export function AjnResourcePanel({ onPlayProgram, className = '' }: Props) {
  const feeds = useAjnFeeds();
  const catalog = feeds.data?.catalog ?? null;
  const lastCheckedAt = feeds.checkedAt;
  const loading = feeds.status === 'loading';

  const { video, audio, count } = useMemo(() => {
    const all = feeds.data?.items ?? [];
    return {
      video: all.filter((i) => i.mediaType === 'video').sort(byNewest),
      audio: all.filter((i) => i.mediaType === 'audio').sort(byNewest),
      count: all.length,
    };
  }, [feeds.data]);

  let error: string | null = feeds.error;
  if (feeds.data) {
    const failures = feeds.data.failures;
    if (feeds.data.items.length === 0 && failures > 0) error = 'AJN resource feeds are currently unavailable.';
    else if (failures > 0) error = `${failures} AJN resource feed${failures === 1 ? '' : 's'} unavailable; showing available items.`;
  }

  return (
    <section aria-labelledby="ajn-resource-heading" className={`space-y-5 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-sky-500/20 bg-sky-500/10 text-sky-400"><Tv className="h-4 w-4" /></div>
            <h2 id="ajn-resource-heading" className="text-lg font-semibold tracking-tight text-neutral-100">AJN Shows &amp; Feeds</h2>
          </div>
          <p className="mt-1 text-xs text-neutral-500">Newest shows from the AJN feeds. Titles and dates are read from each file name.</p>
        </div>
        <button
          type="button"
          onClick={() => void feeds.reload()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"
          disabled={feeds.refreshing}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${feeds.refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {loading && <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5 text-xs text-neutral-400">Loading AJN resource feeds…</div>}
      {error && <div className="rounded-xl border border-red-900/50 bg-red-950/20 p-5 text-xs text-red-300">AJN resource feed unavailable: {error}</div>}
      {!loading && !error && count === 0 && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5 text-xs text-neutral-400">AJN feeds are reachable, but no playable items were returned.</div>
      )}

      <Group title="Video" icon={Tv} items={video} total={video.length} onPlayProgram={onPlayProgram} />
      <Group title="Audio" icon={Headphones} items={audio} total={audio.length} onPlayProgram={onPlayProgram} />
      <ClassicRadioTheatreShelf onPlayProgram={onPlayProgram} />

      {catalog && (
        <div className="flex items-center justify-between gap-3 font-mono text-[10px] text-neutral-600">
          <span>Source: {catalog.source}</span>
          {lastCheckedAt && <span>Last checked: {new Date(lastCheckedAt).toLocaleTimeString()}</span>}
        </div>
      )}
    </section>
  );
}
