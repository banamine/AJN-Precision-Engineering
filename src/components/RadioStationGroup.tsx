import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import type { PlayProgramCallback } from '../types';
import { registerLiveRadioMeter } from '../utils/mediaRoute';
import type { LiveRadioItem } from './LiveRadioDirectory';
import { RADIO_GROUPS, loadGroupSelection, saveGroupSelection, stepIndex, type RadioGroupDef } from '../utils/radioGroups';
import { getStationTheme } from '../utils/radioAccents';
import { rememberStationArt } from '../utils/stationArt';

interface Props {
  onPlay: PlayProgramCallback;
  /** Lets the dock show the station's picture in its "now playing" strip (same hook the directory uses). */
  onTuned?: (s: LiveRadioItem) => void;
  /** The station playing now (any station). When it belongs to the open group, the dropdown follows it. */
  activeId?: string;
  groups?: RadioGroupDef[];
}

const backBtn = 'flex h-9 min-w-9 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-lg bg-red-600 px-2.5 text-xs font-semibold text-white shadow-sm shadow-red-950/50 hover:bg-red-500 active:bg-red-700 disabled:cursor-default disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 touch-manipulation transition-colors';

const forwardBtn = 'flex h-9 min-w-9 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-lg bg-emerald-600 px-2.5 text-xs font-semibold text-white shadow-sm shadow-emerald-950/50 hover:bg-emerald-500 active:bg-emerald-700 disabled:cursor-default disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 touch-manipulation transition-colors';

const groupStepBtn = 'flex h-9 min-w-9 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-lg bg-neutral-800 px-2 text-xs font-medium text-neutral-100 hover:bg-neutral-700 disabled:cursor-default disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 touch-manipulation';

/** One dropdown + Back / Forward for a fixed set of related stations. The choice is remembered on this device until changed. */
export function RadioStationGroup({ onPlay, onTuned, activeId, groups = RADIO_GROUPS }: Props): ReactElement | null {
  const [sel, setSel] = useState(() => loadGroupSelection(groups));
  const [items, setItems] = useState<Record<string, LiveRadioItem>>({});
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const group = groups.find((g) => g.id === sel.groupId) ?? groups[0];

  // Fetch the open group's stations by id (one request). Ids the server does not list are simply not offered; nothing is invented.
  useEffect(() => {
    if (!group) return undefined;
    const controller = new AbortController();
    setState('loading');
    const ids = group.members.map((m) => m.id).join(',');
    fetch(`/api/live-radio/stations?ids=${encodeURIComponent(ids)}&pageSize=${group.members.length + 5}`, { signal: controller.signal })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<{ items: LiveRadioItem[] }>; })
      .then((j) => { rememberStationArt(j.items); setItems(Object.fromEntries(j.items.map((s) => [s.id, s]))); setState('ready'); })
      .catch(() => { if (!controller.signal.aborted) setState('error'); });
    return () => controller.abort();
  }, [group]);

  const available = useMemo(() => (group ? group.members.filter((m) => items[m.id]) : []), [group, items]);
  const current = sel.stationId ?? '';
  // The dropdown follows the station that is actually playing, when it is in this group.
  useEffect(() => {
    if (activeId && group?.members.some((m) => m.id === activeId) && activeId !== sel.stationId) {
      const next = { groupId: group.id, stationId: activeId };
      setSel(next); saveGroupSelection(next);
    }
  }, [activeId, group, sel.stationId]);

  const choose = useCallback((stationId: string) => {
    if (!group) return;
    const next = { groupId: group.id, stationId };
    setSel(next); saveGroupSelection(next);
    const s = items[stationId];
    if (!s) return;
    const where = [s.city, s.region].filter(Boolean).join(', ');
    if (s.corsVerified) registerLiveRadioMeter(s.id);
    onTuned?.(s);
    onPlay(s.streamUrl, s.name, where || (s.country === 'CA' ? 'Canada' : 'United States'), 'audio', s.id, 'audio-podcasts', s.programId);
  }, [group, items, onPlay, onTuned]);

  const step = (dir: 1 | -1) => {
    const i = stepIndex(available.findIndex((m) => m.id === current), available.length, dir);
    if (i >= 0) choose(available[i].id);
  };
  const stepGroup = (dir: 1 | -1) => {
    const gi = groups.findIndex((g) => g.id === sel.groupId);
    const g = groups[stepIndex(gi, groups.length, dir)];
    if (g) { const next = { groupId: g.id, stationId: null }; setSel(next); saveGroupSelection(next); }
  };

  if (!group) return null;
  const multi = groups.length > 1;
  const activeTheme = current ? getStationTheme(current, items[current]?.name, items[current]?.logo) : null;
  const activeItem = current ? items[current] : null;

  return (
    <div data-testid="radio-station-group" role="group" aria-label={`${group.title} stations`}
      className="mx-3 mb-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-neutral-800 bg-neutral-900/70 p-2">
      <div className="flex w-full items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-300/90">{group.title} · {available.length || group.members.length} stations</span>
        {activeTheme && (
          <span className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ backgroundColor: activeTheme.bgTint, color: activeTheme.color }}>
            <span>{activeTheme.iconEmoji}</span>
            <span>{activeTheme.shortTag}</span>
          </span>
        )}
      </div>
      {multi && <button type="button" className={groupStepBtn} onClick={() => stepGroup(-1)} aria-label="Previous group of stations" title="Previous group"><ChevronsLeft className="h-4 w-4" /></button>}
      <button type="button" className={backBtn} onClick={() => step(-1)} disabled={available.length < 2} aria-label="Back: previous station in this group"><ChevronLeft className="h-4 w-4" />Back</button>
      <span
        data-testid="station-channel-icon"
        aria-hidden="true"
        title={activeTheme ? `${activeTheme.label} icon` : 'Station channel'}
        style={{
          backgroundColor: activeTheme ? activeTheme.bgTint : 'rgba(255,255,255,0.05)',
          borderColor: activeTheme ? activeTheme.borderTint : '#404040',
          color: activeTheme?.color || '#ffffff',
          boxShadow: activeTheme ? `0 0 8px ${activeTheme.color}35` : 'none',
        }}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-base font-bold transition-all duration-200"
      >
        {activeItem?.logo ? (
          <img src={activeItem.logo} alt="" className="h-6 w-6 rounded object-contain" />
        ) : (
          <span>{activeTheme?.iconEmoji || '📻'}</span>
        )}
      </span>
      <select value={available.some((m) => m.id === current) ? current : ''} onChange={(e) => { if (e.target.value) choose(e.target.value); }}
        disabled={state !== 'ready' || available.length === 0} aria-label={`Choose a ${group.title} station`}
        style={{
          borderColor: activeTheme ? activeTheme.borderTint : undefined,
          boxShadow: activeTheme ? `0 0 0 1px ${activeTheme.color}30` : undefined,
        }}
        className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-2 text-xs text-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 transition-colors">
        <option value="">{state === 'loading' ? 'Loading stations…' : state === 'error' ? 'Stations unavailable' : 'Choose a station…'}</option>
        {available.map((m) => {
          const theme = getStationTheme(m.id, m.label, items[m.id]?.logo);
          return (
            <option key={m.id} value={m.id} style={{ color: theme.color, backgroundColor: '#171717' }}>
              {theme.iconEmoji} {m.label}
            </option>
          );
        })}
      </select>
      <button type="button" className={forwardBtn} onClick={() => step(1)} disabled={available.length < 2} aria-label="Forward: next station in this group">Forward<ChevronRight className="h-4 w-4" /></button>
      {multi && <button type="button" className={groupStepBtn} onClick={() => stepGroup(1)} aria-label="Next group of stations" title="Next group"><ChevronsRight className="h-4 w-4" /></button>}
      {available.length > 0 && (
        <div role="list" aria-label="Station channels" className="mt-1 flex w-full flex-wrap gap-1 border-t border-neutral-800/80 pt-1.5">
          {available.map((m) => {
            const theme = getStationTheme(m.id, m.label, items[m.id]?.logo);
            const isSelected = m.id === current;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => choose(m.id)}
                title={`Tune to ${m.label}`}
                aria-current={isSelected ? 'true' : undefined}
                style={{
                  borderColor: isSelected ? theme.color : `${theme.color}40`,
                  backgroundColor: isSelected ? theme.bgTint : 'rgba(23, 23, 23, 0.6)',
                  color: isSelected ? '#ffffff' : theme.color,
                  boxShadow: isSelected ? `0 0 8px ${theme.color}40` : 'none',
                }}
                className="flex cursor-pointer items-center gap-1 rounded-md border px-1.5 py-1 text-[10px] font-semibold transition-all duration-150 hover:scale-[1.03] active:scale-95 focus:outline-none focus-visible:ring-1 focus-visible:ring-white"
              >
                <span aria-hidden="true" className="text-xs">{theme.iconEmoji}</span>
                <span className="max-w-[85px] truncate">{theme.shortTag}</span>
              </button>
            );
          })}
        </div>
      )}
      {state === 'error' && <p className="w-full text-[11px] text-red-300">Could not load the station list. Check your connection and reopen Radio.</p>}
    </div>
  );
}
