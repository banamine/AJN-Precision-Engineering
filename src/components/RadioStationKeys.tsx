import { useEffect, useState, type ReactElement } from 'react';
import type { PlayProgramCallback } from '../types';
import { registerLiveRadioMeter } from '../utils/mediaRoute';
import { RADIO_GROUPS } from '../utils/radioGroups';
import { rememberStationArt } from '../utils/stationArt';
import type { LiveRadioItem } from './LiveRadioDirectory';

interface Props {
  onPlay: PlayProgramCallback;
  onTuned?: (channelId: string, logo?: string) => void;
  /** The station playing now; its key shows as latched. */
  activeId?: string;
}

/** One press-and-play key for every station in the fixed groups (Classic Hits 109 family and AJN Live), so none needs the dropdown. Stations the server does not list get no key; nothing is invented. */
export function RadioStationKeys({ onPlay, onTuned, activeId }: Props): ReactElement {
  const [items, setItems] = useState<Record<string, LiveRadioItem>>({});
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    const controller = new AbortController();
    const ids = RADIO_GROUPS.flatMap((g) => g.members.map((m) => m.id));
    fetch(`/api/live-radio/stations?ids=${encodeURIComponent(ids.join(','))}&pageSize=${ids.length + 5}`, { signal: controller.signal })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<{ items: LiveRadioItem[] }>; })
      .then((j) => { rememberStationArt(j.items); setItems(Object.fromEntries(j.items.map((s) => [s.id, s]))); setState('ready'); })
      .catch(() => { if (!controller.signal.aborted) setState('error'); });
    return () => controller.abort();
  }, []);

  const tune = (s: LiveRadioItem): void => {
    const where = [s.city, s.region].filter(Boolean).join(', ');
    if (s.corsVerified) registerLiveRadioMeter(s.id);
    onTuned?.(s.id, s.logo);
    onPlay(s.streamUrl, s.name, where || (s.country === 'CA' ? 'Canada' : 'United States'), 'audio', s.id, 'audio-podcasts', s.programId);
  };

  return (
    <div data-testid="radio-station-keys" className="mt-3 space-y-2">
      {state === 'loading' && <p role="status" className="text-[11px] text-slate-300">Loading station keys…</p>}
      {state === 'error' && <p role="status" className="text-[11px] text-amber-300">Station keys unavailable right now.</p>}
      {state === 'ready' && RADIO_GROUPS.map((g) => {
        const present = g.members.filter((m) => items[m.id]);
        if (!present.length) return null;
        return (
          <div key={g.id} role="group" aria-label={`${g.title} stations`}>
            <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-[#E06D3B]">{g.title}</div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {present.map((m) => (
                <button key={m.id} type="button" data-testid="radio-station-key" aria-pressed={activeId === m.id} title={`Tune ${m.label}`} onClick={() => tune(items[m.id])}
                  className={`ck-key ck-key--sm min-w-0 !justify-start truncate text-left text-[11px] ${activeId === m.id ? 'is-latched' : ''}`}>
                  <span className="min-w-0 truncate">{m.label}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
