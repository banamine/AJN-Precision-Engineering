import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { ChyronStory, ChyronVariant } from './useTvChyrons';

const TAG: Record<string, string> = { CNN: 'bg-red-900/80', FOX: 'bg-blue-900/80', 'MS NOW': 'bg-teal-900/80', BBC: 'bg-violet-900/80' };
export const fmtUtc = (ms: number): string => `${new Date(ms).toISOString().slice(11, 16)} UTC`;
export const fmtUtcDateTime = (ms: number): string => `${new Date(ms).toISOString().slice(0, 10)} ${fmtUtc(ms)}`;
export function fmtAgo(ms: number, now: number): string {
  const m = Math.max(0, Math.floor((now - ms) / 60_000));
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 48 * 60 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`;
}
/** The wording this channel used for the story, or the story's best wording. */
export const variantFor = (s: ChyronStory, channel?: string): ChyronVariant =>
  (channel && s.variants.find((v) => v.channel === channel)) || s.variants.find((v) => v.text === s.text) || s.variants[0];

export function ChannelTags({ channels }: { channels: string[] }) {
  return <span className="flex flex-wrap gap-1">{channels.map((c) => <span key={c} className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold text-white ${TAG[c] ?? 'bg-neutral-700'}`}>{c}</span>)}</span>;
}

type Caption = { state: 'loading' } | { state: 'none' } | { state: 'error'; message: string } | { state: 'ok'; text: string; label: string };

/** Detail panel. Caption text is fetched from the existing /api/captions routes for the chosen broadcast minute. */
export function StoryDrawer({ story, focusChannel, onClose }: { story: ChyronStory; focusChannel?: string; onClose: () => void }) {
  const primary = variantFor(story, focusChannel);
  const [caption, setCaption] = useState<Caption>({ state: 'loading' });
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); before?.focus?.(); };
  }, [onClose]);

  useEffect(() => {
    const ac = new AbortController();
    setCaption({ state: 'loading' });
    (async () => {
      try {
        const id = encodeURIComponent(primary.identifier);
        const planRes = await fetch(`/api/captions/plan?id=${id}`, { signal: ac.signal });
        const plan = await planRes.json().catch(() => null);
        if (!planRes.ok) throw new Error(plan?.retryAfter ? `Archive is busy, try again in ${plan.retryAfter}s.` : plan?.error || `Captions HTTP ${planRes.status}`);
        if (plan.source === 'none') { setCaption({ state: 'none' }); return; }
        const start = Math.floor(primary.startSec / 60) * 60;
        const sliceRes = await fetch(`/api/captions/slice?id=${id}&src=${encodeURIComponent(plan.source)}&start=${start}`, { signal: ac.signal });
        const slice = await sliceRes.json().catch(() => null);
        if (!sliceRes.ok) throw new Error(slice?.retryAfter ? `Archive is busy, try again in ${slice.retryAfter}s.` : slice?.error || `Captions HTTP ${sliceRes.status}`);
        const text = (slice.cues ?? []).map((c: { text: string }) => c.text).join(' ').replace(/\s+/g, ' ').trim();
        setCaption(text ? { state: 'ok', text: text.slice(0, 700), label: plan.label ?? 'captions' } : { state: 'none' });
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return;
        setCaption({ state: 'error', message: e instanceof Error ? e.message : 'Captions could not be loaded.' });
      }
    })();
    return () => ac.abort();
  }, [primary.identifier, primary.startSec]);

  return (
    <div className="fixed inset-0 z-[80]" data-testid="story-drawer">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Headline details" tabIndex={-1}
        className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto border-l border-neutral-700 bg-neutral-900 p-5 focus:outline-none">
        <div className="flex items-center justify-between gap-3">
          <ChannelTags channels={story.channels} />
          <button type="button" onClick={onClose} aria-label="Close headline details" className="flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-700 text-neutral-200 hover:bg-neutral-800"><X className="h-4 w-4" /></button>
        </div>
        <h3 className="font-serif text-lg font-bold leading-snug text-neutral-100">{primary.text}</h3>
        <p className="font-mono text-[11px] text-neutral-400">First seen {fmtUtcDateTime(story.tsMs)} · {primary.program}</p>
        <ul className="space-y-2" aria-label="Wording by channel">
          {story.variants.map((v) => (
            <li key={`${v.channel}-${v.tsMs}`} className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-2.5">
              <div className="flex items-center justify-between gap-2"><ChannelTags channels={[v.channel]} /><span className="font-mono text-[10px] text-neutral-400">{fmtUtc(v.tsMs)} · {v.program}</span></div>
              <p className="mt-1.5 font-serif text-sm font-bold text-neutral-200">{v.text}</p>
            </li>
          ))}
        </ul>
        <section className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3 text-sm text-neutral-300" aria-live="polite">
          <h4 className="mb-1 font-mono text-[10px] font-bold uppercase text-sky-400">Captions · {primary.channel} · {primary.program}</h4>
          {caption.state === 'loading' && <p className="text-neutral-400">Loading captions from the Internet Archive…</p>}
          {caption.state === 'none' && <p className="text-neutral-400">No caption text is available for this minute.</p>}
          {caption.state === 'error' && <p role="alert" className="text-rose-300">Captions unavailable: {caption.message}</p>}
          {caption.state === 'ok' && <><p className="leading-relaxed">{caption.text}</p><p className="mt-1 text-[11px] text-neutral-500">Source: {caption.label}</p></>}
        </section>
      </div>
    </div>
  );
}
