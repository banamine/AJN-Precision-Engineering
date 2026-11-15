import React, { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useTvChyrons, type ChyronStory } from './useTvChyrons';
import { ChannelTags, StoryDrawer, fmtAgo, fmtUtc, variantFor } from './chyronUi';

const FACES = ['Top', 'CNN', 'FOX', 'MS NOW', 'BBC', 'Same story'] as const;
type Face = (typeof FACES)[number];
const STALE_WARN_MS = 45 * 60_000;

/** Cable-news headline ticker + 6-face board, fed by /api/tv-chyrons (Internet Archive Third Eye on-screen text). */
export default function HeadlinesBoard() {
  const { data, error, loading, refresh } = useTvChyrons({ hours: 24, limit: 120 });
  const [face, setFace] = useState<Face>('Top');
  const [open, setOpen] = useState<{ story: ChyronStory; channel?: string } | null>(null);
  const now = Date.now();
  const items = data?.items ?? [];

  const shown = useMemo(() => {
    if (face === 'Top') return items.slice(0, 6);
    if (face === 'Same story') return items.filter((s) => s.channels.length >= 2).slice(0, 6);
    return items.filter((s) => s.channels.includes(face)).slice(0, 6);
  }, [items, face]);
  const ticker = items.slice(0, 14);
  const age = data?.generatedAt ? now - Date.parse(data.generatedAt) : null;
  const behind = data?.status === 'stale' || (age !== null && age > STALE_WARN_MS);

  return (
    <section aria-label="Cable news headlines" data-testid="headlines-board" className="space-y-3 rounded-lg border border-neutral-700 bg-neutral-950/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-neutral-100">Cable news headlines · last 24 h</h2>
        <div className="flex items-center gap-2">
          <span data-testid="headlines-fresh" className={`text-xs ${behind ? 'text-amber-300' : 'text-neutral-400'}`}>
            {data?.generatedAt ? (behind ? `Data is ${fmtAgo(Date.parse(data.generatedAt), now).replace(' ago', '')} old - feed may be behind` : `Updated ${fmtAgo(Date.parse(data.generatedAt), now)}`) : loading ? 'Loading…' : 'No data'}
          </span>
          <button type="button" onClick={() => void refresh()} aria-label="Refresh headlines" className="flex h-9 w-9 items-center justify-center rounded-md border border-neutral-600 hover:bg-neutral-800"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
        </div>
      </div>

      {(error || data?.status === 'stale') && (
        <p role="alert" data-testid="headlines-error" className="rounded border border-amber-700/50 bg-amber-950/30 p-2 text-xs text-amber-200">
          Headline feed unavailable{data?.generatedAt ? ` - showing last good snapshot from ${fmtUtc(Date.parse(data.generatedAt))}` : ''} ({error ?? data?.staleReason}).
        </p>
      )}

      {ticker.length > 0 && (
        <div className="group overflow-hidden rounded border border-neutral-800 bg-neutral-900" data-testid="headlines-ticker">
          <style>{`@keyframes ajn-tick{from{transform:translateX(0)}to{transform:translateX(-50%)}}.ajn-tick{animation:ajn-tick 90s linear infinite}.group:hover .ajn-tick,.group:focus-within .ajn-tick{animation-play-state:paused}@media (prefers-reduced-motion:reduce){.ajn-tick{animation:none}.ajn-tick-clone{display:none}}`}</style>
          <div className="ajn-tick flex w-max gap-6 py-2 pl-3">
            {[0, 1].map((copy) => (
              <div key={copy} className={`flex gap-6 ${copy ? 'ajn-tick-clone' : ''}`} aria-hidden={copy ? true : undefined}>
                {ticker.map((s) => (
                  <button key={`${copy}-${s.id}`} type="button" tabIndex={copy ? -1 : 0} onClick={() => setOpen({ story: s })} className="flex items-center gap-2 whitespace-nowrap text-left text-xs text-neutral-200 hover:text-sky-300">
                    <ChannelTags channels={s.channels} /><span className="font-serif font-bold">{s.text}</span><span className="font-mono text-neutral-500">{fmtUtc(s.tsMs)}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <div role="tablist" aria-label="Headline faces" className="flex flex-wrap gap-1.5">
        {FACES.map((f) => (
          <button key={f} role="tab" aria-selected={face === f} type="button" onClick={() => setFace(f)} className={`min-h-9 rounded-md border px-3 text-xs ${face === f ? 'border-orange-500 bg-orange-500/15 text-orange-200' : 'border-neutral-700 text-neutral-300 hover:bg-neutral-800'}`}>{f}</button>
        ))}
      </div>

      {shown.length === 0 && !loading && (
        <p className="rounded border border-neutral-800 p-4 text-sm text-neutral-400" data-testid="headlines-empty">
          {data ? (face === 'Top' || face === 'Same story' ? 'No headlines in the last 24 h.' : `No headlines in the last 24 h for ${face}`) : 'Headlines could not be loaded.'}
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((s) => {
          const ch = FACES.includes(face) && face !== 'Top' && face !== 'Same story' ? face : undefined;
          const v = variantFor(s, ch);
          return (
            <button key={s.id} type="button" onClick={() => setOpen({ story: s, channel: ch })} data-testid="headline-card" className="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 text-left hover:border-sky-500/50">
              <div className="flex items-center justify-between gap-2"><ChannelTags channels={ch ? [ch] : s.channels} /><span className="font-mono text-[10px] text-neutral-400">{fmtUtc(v.tsMs)} · {fmtAgo(v.tsMs, now)}</span></div>
              <p className="font-serif text-sm font-bold leading-snug text-neutral-100">{v.text}</p>
              <p className="font-mono text-[10px] text-neutral-500">{v.program}</p>
            </button>
          );
        })}
      </div>
      {open && <StoryDrawer story={open.story} focusChannel={open.channel} onClose={() => setOpen(null)} />}
    </section>
  );
}
