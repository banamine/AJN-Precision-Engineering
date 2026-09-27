import { Clock, ExternalLink, LoaderCircle, Newspaper, RefreshCw } from "lucide-react";
import type { AjnRssItem } from "../services/AjnRssService";
import { NewsEmptyState } from "./NewsEmptyState";

interface NewsTickerProps {
  items: AjnRssItem[];
  loading?: boolean;
  error?: string | null;
  lastUpdated?: string | null;
  onRefresh?: () => void;
}

function formatTime(value: string | null | undefined): string {
  if (!value) return "Time unavailable";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

export function NewsTicker({
  items,
  loading = false,
  error = null,
  lastUpdated = null,
  onRefresh,
}: NewsTickerProps) {
  if (loading && !items.length) {
    return (
      <section aria-label="AJN News" className="rounded-xl border border-neutral-800 bg-neutral-900/70 p-4">
        <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-neutral-400">
          <LoaderCircle className="h-4 w-4 animate-spin text-sky-400" />
          Loading AJN news
        </div>
      </section>
    );
  }

  if (!items.length) {
    return (
      <section aria-label="AJN News">
        <NewsEmptyState
          title={error ? "News temporarily unavailable" : "No news headlines"}
          message={error || "Waiting for the next normalized RSS refresh."}
          compact
        />
      </section>
    );
  }

  return (
    <section aria-labelledby="ajn-news-ticker-heading" className="rounded-xl border border-neutral-800 bg-neutral-900/70 overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Newspaper className="h-4 w-4 shrink-0 text-sky-400" />
          <h2 id="ajn-news-ticker-heading" className="truncate text-sm font-semibold text-neutral-100">
            AJN News Ticker
          </h2>
          <span className="rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-mono text-emerald-400">
            RSS
          </span>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="hidden text-[10px] font-mono text-neutral-500 sm:inline">
              Updated {formatTime(lastUpdated)}
            </span>
          )}
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              aria-label="Refresh news"
              title="Refresh news"
              className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-sky-300 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          )}
        </div>
      </div>

      <div className="divide-y divide-neutral-800/80">
        {items.map((item) => (
          <article key={item.id} className="px-4 py-3 transition hover:bg-neutral-800/30">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 shrink-0 text-neutral-600">
                <Clock className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-sky-400">
                    {item.sourceName || item.source || "AJN"}
                  </span>
                  {item.publishedAt && (
                    <span className="text-[10px] font-mono text-neutral-600">
                      {formatTime(item.publishedAt)}
                    </span>
                  )}
                </div>
                <h3 className="mt-1 text-sm font-medium leading-5 text-neutral-100">
                  {item.title}
                </h3>
                {item.description && (
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-neutral-500">
                    {item.description}
                  </p>
                )}
              </div>
              {item.link && (
                <a
                  href={item.link}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open ${item.title}`}
                  className="shrink-0 rounded p-1.5 text-neutral-500 hover:bg-neutral-800 hover:text-sky-300"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
