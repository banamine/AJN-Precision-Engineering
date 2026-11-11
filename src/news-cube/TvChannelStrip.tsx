import React from 'react';
import { useTvHeadlines } from './useTvHeadlines';

export default function TvChannelStrip() {
  const { items, error, loading, refresh } = useTvHeadlines();
  return (
    <section aria-label="TV news channels" data-testid="tv-channel-strip" className="rounded-lg border border-neutral-700 bg-neutral-950/60 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-neutral-100">On the TV news channels</h2>
        <button type="button" onClick={() => void refresh()} className="min-h-11 rounded-md border border-neutral-600 px-3 text-sm hover:bg-neutral-800">Refresh</button>
      </div>
      {loading && !items && <p role="status" className="text-sm text-neutral-400">Loading channel captions from the Internet Archive…</p>}
      {error && <p role="alert" className="text-sm text-rose-300" data-testid="tv-strip-error">Could not load TV channels ({error}).</p>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {(items ?? []).map((it) => (
          <article key={it.network} className="rounded-md border border-neutral-800 p-3 text-sm" data-testid={`tv-card-${it.network}`}>
            <h3 className="font-semibold text-neutral-100">{it.network}</h3>
            {it.state === 'unavailable' ? (
              <p className="mt-1 text-neutral-400">Unavailable: {it.reason}</p>
            ) : (
              <>
                <p className="mt-1 text-xs text-neutral-400">
                  Caption excerpt, not a headline. From {it.programTitle}, {new Date(it.airedUtc).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}, {it.network}.
                </p>
                {it.sameTopicAs && it.sameTopicAs.length > 0 && <p className="mt-1 text-xs text-sky-300" data-testid="tv-same-topic">Similar topic on {it.sameTopicAs.join(', ')}{it.sharedTerms && it.sharedTerms.length ? ` (shared: ${it.sharedTerms.join(', ')})` : ''}. Vocabulary match, not verification.</p>}
                {it.lowSignal && <p className="mt-1 text-xs text-neutral-500" data-testid="tv-low-signal">No clear news segment found in this program; showing the best available.</p>}
                {it.stale && <p className="mt-1 text-xs text-amber-300" data-testid="tv-stale">Refresh failed ({it.staleReason}); showing the last captions retrieved. Broadcast time is unchanged.</p>}
                {it.excerptMinutes.map((m) => (
                  <p key={m.startSec} className="mt-2 text-neutral-200">{m.text.slice(0, 260)}{m.text.length > 260 ? '…' : ''}</p>
                ))}
                <a className="mt-2 inline-block text-sky-300 underline" target="_blank" rel="noreferrer"
                   href={`https://archive.org/details/${encodeURIComponent(it.identifier)}/start/${it.excerptMinutes[0].startSec}/end/${it.excerptMinutes[0].startSec + 60}`}>
                  Open this minute on archive.org
                </a>
              </>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
