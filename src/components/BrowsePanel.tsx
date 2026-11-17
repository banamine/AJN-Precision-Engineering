import { lazy, Suspense, useState } from 'react';
import { ArrowRight, Play } from 'lucide-react';
import type { Destination, PlayProgramCallback, Program, RecentlyPlayedItem } from '../types';

// On Now reuses the Home live strip (same schedule cache, categories and tune-in as the TV Guide).
// It is only loaded and mounted when its tab is opened.
const HomeLiveStrip = lazy(() => import('./HomeLiveStrip').then((m) => ({ default: m.HomeLiveStrip })));

type Tab = 'up-next' | 'on-now';
const TAB_KEY = 'ajn.player.browseTab.v1';
const readTab = (): Tab => { try { return window.localStorage.getItem(TAB_KEY) === 'on-now' ? 'on-now' : 'up-next'; } catch { return 'up-next'; } };
const writeTab = (t: Tab) => { try { window.localStorage.setItem(TAB_KEY, t); } catch { /* remembered only for this visit */ } };

interface Props {
  /** Programs that follow the current one on this channel (from the channel schedule). */
  upcoming: readonly Program[];
  /** Recently played items, newest first. The current item is already excluded by the caller. */
  recent: readonly RecentlyPlayedItem[];
  onSelectUpcoming: (program: Program) => void;
  onResumeRecent: (item: RecentlyPlayedItem) => void;
  onPlayProgram: PlayProgramCallback;
  onNavigate: (d: Destination) => void;
}

/** Compact tabbed browse area under the player: Up Next and On Now. */
export function BrowsePanel({ upcoming, recent, onSelectUpcoming, onResumeRecent, onPlayProgram, onNavigate }: Props) {
  const [tab, setTab] = useState<Tab>(readTab);
  const pick = (t: Tab) => { setTab(t); writeTab(t); };
  const tabBtn = (id: Tab, label: string) => (
    <button type="button" role="tab" id={`browse-tab-${id}`} aria-selected={tab === id} aria-controls={`browse-panel-${id}`} data-testid={`browse-tab-${id}`}
      onClick={() => pick(id)} className={`ck-key ck-key--sm px-3 text-xs${tab === id ? ' is-latched' : ''}`}>{label}</button>
  );

  return (
    <section aria-label="Browse" data-testid="player-browse-panel" className="space-y-3 rounded-xl border border-neutral-800 bg-neutral-900/50 p-3 sm:p-4">
      <div role="tablist" aria-label="Browse" className="flex items-center gap-1.5">
        {tabBtn('up-next', 'Up Next')}
        {tabBtn('on-now', 'On Now')}
      </div>

      {tab === 'up-next' ? (
        <div role="tabpanel" id="browse-panel-up-next" aria-labelledby="browse-tab-up-next" className="space-y-4">
          {upcoming.length === 0 ? (
            <p className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-3 py-3 text-xs text-neutral-400" data-testid="browse-up-next-empty">
              Nothing is queued after this on this channel. Try On Now to see what else is on air.
            </p>
          ) : (
            <ul className="divide-y divide-neutral-800 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/40" data-testid="browse-up-next-list">
              {upcoming.map((p, i) => (
                <li key={`${p.id}-${i}`} className="flex items-center gap-3 px-3 py-2">
                  <span className="w-5 shrink-0 text-center text-[10px] tabular-nums text-neutral-500">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-neutral-100" title={p.title}>{p.title}</p>
                    {p.description ? <p className="truncate text-xs text-neutral-400">{p.description}</p> : null}
                  </div>
                  <button type="button" onClick={() => onSelectUpcoming(p)} aria-label={`Play ${p.title}`} className="ck-key ck-key--sm shrink-0 gap-1 px-3 text-xs">
                    <Play className="h-3.5 w-3.5" aria-hidden="true" /> Play
                  </button>
                </li>
              ))}
            </ul>
          )}

          {recent.length > 0 && (
            <div className="space-y-2" data-testid="browse-recent">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Recently played</h3>
              <ul className="divide-y divide-neutral-800 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/40">
                {recent.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-neutral-100" title={r.title}>{r.title}</p>
                      {r.subtitle ? <p className="truncate text-xs text-neutral-400">{r.subtitle}</p> : null}
                    </div>
                    <button type="button" onClick={() => onResumeRecent(r)} aria-label={`Resume ${r.title}`} className="ck-key ck-key--sm shrink-0 gap-1 px-3 text-xs">
                      <Play className="h-3.5 w-3.5" aria-hidden="true" /> Resume
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex justify-end">
            <button type="button" onClick={() => onNavigate('tv-guide')} className="ck-key ck-key--sm gap-1 px-2 text-xs">
              Full guide <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : (
        <div role="tabpanel" id="browse-panel-on-now" aria-labelledby="browse-tab-on-now">
          <Suspense fallback={<div className="h-9 animate-pulse rounded-lg bg-neutral-900" aria-label="Loading live channels" />}>
            <HomeLiveStrip onPlayProgram={onPlayProgram} onNavigate={onNavigate} />
          </Suspense>
        </div>
      )}
    </section>
  );
}
