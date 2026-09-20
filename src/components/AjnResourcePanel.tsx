import { useEffect, useRef, useState } from 'react';
import { Headphones, Play, RefreshCw, Tv } from 'lucide-react';
import type { MediaType, PlayProgramCallback } from '../types';

type AjnFeedId = 'Alex' | 'WarRoom' | 'SundayLive' | 'AJNHourlyVideo' | 'AJNHourlyAudio';

interface AjnResource {
  id: AjnFeedId;
  name: string;
  htmlUrl: string;
  rssUrl: string;
  mediaType: MediaType;
}

interface AjnResourceCatalog {
  source: string;
  resources: AjnResource[];
}

interface AjnFeedItem {
  id: string;
  title: string;
  description?: string;
  publishedAt?: string;
  url?: string;
  thumbnailUrl?: string;
  mediaType: MediaType;
  feedId: AjnFeedId;
  metadata?: Record<string, string>;
}

interface Props {
  onPlayProgram: PlayProgramCallback;
}

function mediaTypeFromUrl(url: string, fallback: MediaType): MediaType {
  const normalized = url.split('?')[0].split('#')[0].toLowerCase();
  if (/\.(mp4|m4v|webm|mov|mkv|m3u8)$/.test(normalized)) return 'video';
  if (/\.(mp3|aac|m4a|ogg|oga|opus|wav|flac)$/.test(normalized)) return 'audio';
  return fallback;
}

export function AjnResourcePanel({ onPlayProgram }: Props) {
  const [catalog, setCatalog] = useState<AjnResourceCatalog | null>(null);
  const [items, setItems] = useState<AjnFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestController = useRef<AbortController | null>(null);

  const load = async () => {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    const { signal } = controller;

    setLoading(true);
    setError(null);
    try {
      const refreshToken = Date.now();
      const catalogResponse = await fetch(`/api/ajn/resources?refresh=${refreshToken}`, { signal, cache: 'no-store' });
      if (!catalogResponse.ok) throw new Error(`Resource catalog HTTP ${catalogResponse.status}`);
      const nextCatalog = (await catalogResponse.json()) as AjnResourceCatalog;
      setCatalog(nextCatalog);

      const results = await Promise.allSettled(
        nextCatalog.resources.map(async (resource) => {
          const response = await fetch(`/api/ajn/resources/${resource.id}?refresh=${refreshToken}`, { signal, cache: 'no-store' });
          if (!response.ok) throw new Error(`${resource.id} HTTP ${response.status}`);
          const feed = await response.json();
          return (feed.items || []) as AjnFeedItem[];
        })
      );

      if (signal.aborted) return;

      const feeds = results
        .filter((result): result is PromiseFulfilledResult<AjnFeedItem[]> => result.status === 'fulfilled')
        .flatMap((result) => result.value)
        .filter((item) => item.url)
        .map((item) => ({ ...item, mediaType: mediaTypeFromUrl(item.url!, item.mediaType) }));
      const failures = results.filter((result) => result.status === 'rejected');

      const videoItems = feeds
        .filter((item) => item.mediaType === 'video')
        .sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')))
        .slice(0, 6);
      const audioItems = feeds
        .filter((item) => item.mediaType === 'audio')
        .sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')))
        .slice(0, 6);

      setItems([...videoItems, ...audioItems]);

      if (feeds.length === 0 && failures.length > 0) {
        setError('AJN resource feeds are currently unavailable.');
      } else if (failures.length > 0) {
        setError(`${failures.length} AJN resource feed${failures.length === 1 ? '' : 's'} unavailable; showing available items.`);
      }
    } catch (err) {
      if (signal.aborted) return;
      setError(err instanceof Error ? err.message : 'Unable to load AJN resources');
    } finally {
      if (!signal.aborted) setLoading(false);
      if (requestController.current === controller) requestController.current = null;
    }
  };

  useEffect(() => {
    void load();
    return () => {
      requestController.current?.abort();
      requestController.current = null;
    };
  }, []);

  return (
    <section aria-labelledby="ajn-resource-heading" className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/20">
              <Tv className="h-4 w-4" />
            </div>
            <h2 id="ajn-resource-heading" className="text-lg font-semibold tracking-tight text-neutral-100">
              AJN Audio / Video Resources
            </h2>
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            Live resource feeds from the AJN resource source; normalized by the server before playback.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"
          disabled={loading}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {loading && <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5 text-xs text-neutral-400">Loading AJN resource feeds…</div>}
      {error && <div className="rounded-xl border border-red-900/50 bg-red-950/20 p-5 text-xs text-red-300">AJN resource feed unavailable: {error}</div>}

      {!loading && !error && items.length === 0 && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5 text-xs text-neutral-400">AJN feeds are reachable, but no playable items were returned.</div>
      )}

      {items.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {items.map((item) => (
            <article key={`${item.feedId}:${item.id}`} className="group rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 hover:border-neutral-700">
              <div className="flex items-center justify-between gap-2">
                <span className="rounded px-2 py-0.5 font-mono text-[10px] font-semibold text-sky-300 bg-sky-950/70 border border-sky-800/40">
                  {item.feedId}
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] text-neutral-500">
                  {item.mediaType === 'audio' ? <Headphones className="h-3 w-3" /> : <Tv className="h-3 w-3" />}
                  {item.mediaType}
                </span>
              </div>
              <h3 className="mt-3 text-sm font-semibold text-neutral-100 line-clamp-2">{item.title}</h3>
              {item.description && <p className="mt-1.5 text-xs text-neutral-500 line-clamp-2">{item.description}</p>}
              <button
                type="button"
                onClick={() => {
                  onPlayProgram(
                    item.url!,
                    item.title,
                    item.description || item.feedId,
                    item.mediaType,
                    'ajn-resource',
                    'ajn-archive',
                    item.metadata?.archiveIdentifier || item.metadata?.guid || item.id,
                    `ajn-rss-${item.feedId.toLowerCase()}`,
                    item.metadata?.archiveIdentifier || item.metadata?.guid || item.id,
                    {
                      feedId: item.feedId,
                      publishedAt: item.publishedAt,
                      archiveIdentifier: item.metadata?.archiveIdentifier || item.metadata?.guid || item.id,
                    },
                  );
                }}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-sky-600 hover:text-white"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                Play
              </button>
            </article>
          ))}
        </div>
      )}

      {catalog && <p className="text-[10px] text-neutral-600 font-mono">Source: {catalog.source}</p>}
    </section>
  );
}
