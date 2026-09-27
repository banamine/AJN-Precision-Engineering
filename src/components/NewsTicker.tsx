import { Clock, RefreshCw, Newspaper, ExternalLink } from "lucide-react";
import type { AjnNewsItem } from "../services/AjnRssService";
import { NewsEmptyState } from "./NewsEmptyState";

export function NewsTicker({ items, loading = false, error = null, onRefresh }: {
  items: AjnNewsItem[];
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
}) {
  if (loading && !items.length) {
    return <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 px-4 py-5 text-xs font-mono text-neutral-400">Loading AJN News…</div>;
  }
  if (!items.length) {
    return <NewsEmptyState title={error ? "News temporarily unavailable" : "No news headlines"} message={error || "Waiting for the next normalized RSS refresh."} />;
  }
  return (
    <section aria-labelledby="ajn-news-ticker-heading" className="rounded-xl border border-neutral-800 bg-neutral-900/70 overflow-hidden">
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <Newspaper className="h-4 w-4 text-sky-400" />
          <h2 id="ajn-news-ticker-heading" className="text-sm font-semibold">AJN News</h2>
          <span className="rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-mono text-emerald-400">RSS</span>
        </div>
        {onRefresh && <button type="button" onClick={onRefresh} disabled={loading} aria-label="Refresh news" className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-sky-300"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /></button>}
      </div>
      <div className="divide-y divide-neutral-800/80">
        {items.map((item) => (
          <article key={item.id} className="px-4 py-3">
            <div className="flex items-start gap-3">
              <Clock className="mt-1 h-3.5 w-3.5 shrink-0 text-neutral-600" />
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-mono uppercase tracking-wider text-sky-400">{item.sourceName || "AJN"}</div>
                <h3 className="mt-1 text-sm font-medium leading-5 text-neutral-100">{item.title}</h3>
                {item.description && <p className="mt-1 line-clamp-2 text-xs leading-5 text-neutral-500">{item.description}</p>}
              </div>
              {item.link && <a href={item.link} target="_blank" rel="noreferrer" aria-label={`Open ${item.title}`} className="shrink-0 text-neutral-500 hover:text-sky-300"><ExternalLink className="h-3.5 w-3.5" /></a>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
