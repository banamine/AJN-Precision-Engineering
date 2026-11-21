import React from 'react';
import { budgetLine, canAccept, fmtMS, type ChipState } from '../utils/podcastAdSkip';
import type { AdSkipView } from '../hooks/usePodcastAdSkip';

const KIND_LABEL = { pre: 'Opening ads', mid: 'Ad break', post: 'Closing ads' } as const;
const SOURCE_NOTE = { map: "From this show's ad map. The end point is an estimate: use -15s / +15s to adjust.", learned: 'Learned from where you skipped before. The end point is an estimate.' } as const;

function chipText(c: ChipState): string {
  const lead = c.inside ? `${KIND_LABEL[c.kind]} now` : `${KIND_LABEL[c.kind]} in ${fmtMS(Math.max(0, c.startsIn))}`;
  return `${lead} (est.)`;
}

/** Full player: the prompt + the ad-seconds line, under the skip row. */
export function AdSkipPanel({ view, onAccept, onDismiss, onMode }: { view: AdSkipView; onAccept: () => void; onDismiss: () => void; onMode: (m: 'ask' | 'off') => void }) {
  const line = budgetLine(view.budget);
  const mapNote = view.mapState === 'error' ? 'Ad map unavailable right now' : null;
  return (
    <div data-testid="adskip" className="mt-1 flex flex-col items-center gap-1">
      {view.chip && (
        <div data-testid="adskip-chip" role="group" aria-label={KIND_LABEL[view.chip.kind]} title={SOURCE_NOTE[view.chip.source]}
          className="flex items-center gap-2 rounded-lg border border-amber-300/50 bg-amber-300/15 px-2 py-1 text-xs text-amber-100">
          <span data-testid="adskip-text" className="font-semibold tabular-nums">{chipText(view.chip)}</span>
          <button type="button" data-testid="adskip-accept" onClick={onAccept} disabled={!canAccept(view.chip)} title={canAccept(view.chip) ? undefined : 'Available when the break is about to start'}
            className="inline-flex h-9 min-w-[5.5rem] items-center justify-center rounded-md bg-amber-300 px-2.5 text-xs font-bold tabular-nums text-black transition hover:bg-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 active:scale-95 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-amber-300">
            Skip +{fmtMS(view.chip.skipSeconds)}
          </button>
          <button type="button" data-testid="adskip-dismiss" onClick={onDismiss} aria-label="Not an ad break: do not ask again for this one" title="Not an ad break"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/20 text-sm font-bold text-neutral-100 hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">✕</button>
        </div>
      )}
      <div data-testid="adskip-budget" className="flex flex-wrap items-center justify-center gap-x-2 font-mono text-[11px] text-neutral-400">
        {line && <span data-testid="adskip-line">{line}</span>}
        {mapNote && <span data-testid="adskip-map-note" className="text-amber-200/80">{mapNote}</span>}
        <button type="button" data-testid="adskip-mode" onClick={() => onMode(view.mode === 'ask' ? 'off' : 'ask')} aria-pressed={view.mode === 'ask'}
          className="rounded px-1.5 py-0.5 text-[11px] font-bold text-neutral-200 underline decoration-dotted underline-offset-2 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
          Ad prompts: {view.mode === 'ask' ? 'Ask' : 'Off'}
        </button>
      </div>
    </div>
  );
}

/** Bottom dock: just the prompt, small, in the time row. */
export function AdSkipDockChip({ chip, onAccept, onDismiss }: { chip: ChipState; onAccept: () => void; onDismiss: () => void }) {
  return (
    <span data-testid="dock-adskip" role="group" aria-label={KIND_LABEL[chip.kind]} title={SOURCE_NOTE[chip.source]} className="flex items-center gap-1">
      <button type="button" data-testid="dock-adskip-accept" onClick={onAccept} disabled={!canAccept(chip)}
        className="inline-flex h-6 disabled:opacity-40 items-center rounded bg-amber-300 px-1.5 font-mono text-[10px] font-bold tabular-nums leading-none text-black active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
        Skip ad +{fmtMS(chip.skipSeconds)}
      </button>
      <button type="button" data-testid="dock-adskip-dismiss" onClick={onDismiss} aria-label="Not an ad break" title="Not an ad break"
        className="inline-flex h-6 w-6 items-center justify-center rounded border border-white/20 text-[10px] font-bold text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">✕</button>
    </span>
  );
}
