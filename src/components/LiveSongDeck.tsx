import { useEffect, useRef, useState, type ReactElement } from 'react';
import { RadioSpectrum } from './RadioSpectrum';
import { NewsCarousel } from './NewsCarousel';
import { useLiveRadioNowPlaying, type LiveRadioNowPlaying } from '../hooks/useLiveRadioNowPlaying';

/** Live Radio panel of the Head Unit: spectrum + the station's own song text (now playing, recently played).
 *  Live streams have no schedule, so nothing is scheduled or invented: no feed, no song, or an old feed is said plainly. */
export interface HeardSong { artist: string; title: string; atMs: number }
export const HEARD_MAX = 50;
const keyOf = (s: { artist: string; title: string }): string => `${s.artist.trim().toLowerCase()}|${s.title.trim().toLowerCase()}`;
/** Pure: appends the current song to the session log only when it differs from the newest entry. Bounded, newest first. */
export function appendHeard(log: readonly HeardSong[], cur: { artist: string; title: string } | null, atMs: number): HeardSong[] {
  if (!cur || !cur.title.trim()) return log as HeardSong[];
  if (log[0] && keyOf(log[0]) === keyOf(cur)) return log as HeardSong[];
  return [{ artist: cur.artist, title: cur.title, atMs }, ...log].slice(0, HEARD_MAX);
}
const clock = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

interface ViewProps { np: LiveRadioNowPlaying; stationTitle?: string; hasStation: boolean; playing: boolean; heard: readonly HeardSong[] }
export function LiveSongDeckView({ np, stationTitle, hasStation, playing, heard }: ViewProps): ReactElement {
  const c = np.current;
  let status: string; let line1 = ''; let line2 = '';
  if (!hasStation) { status = 'NO STATION'; line1 = 'Tune a live station'; line2 = 'Press a preset or turn the knob.'; }
  else if (np.state === 'loading') { status = 'CHECKING SONG FEED…'; line1 = stationTitle ?? ''; }
  else if (np.state === 'unsupported') { status = 'NO SONG TEXT'; line1 = stationTitle ?? ''; line2 = 'This station does not send song text.'; }
  else if (np.state === 'none') { status = 'ON AIR · NO SONG'; line1 = 'No song right now'; line2 = 'Talk, news or an ad break.'; }
  else if (np.state === 'error' && !c) { status = 'SONG FEED UNAVAILABLE'; line1 = stationTitle ?? ''; line2 = np.reason ?? ''; }
  else { status = np.state === 'stale' ? 'LAST SONG · FEED OLD' : 'ON AIR · SONG FEED'; line1 = c?.title ?? ''; line2 = c?.artist ?? ''; }
  const fromFeed = np.recent.length > 0;
  const rows: { key: string; text: string; when: string | null }[] = fromFeed
    ? np.recent.slice(0, 5).map((r, i) => ({ key: `${keyOf(r)}-${i}`, text: `${r.artist ? `${r.artist} – ` : ''}${r.title}`, when: r.playedLabel }))
    : heard.slice(1, 6).map((h) => ({ key: `${keyOf(h)}-${h.atMs}`, text: `${h.artist ? `${h.artist} – ` : ''}${h.title}`, when: clock(h.atMs) }));
  return (
    <div data-testid="live-song-deck" data-state={hasStation ? np.state : 'none-selected'} className="flex h-full flex-col gap-2">
      <div className="text-[10px] font-bold uppercase tracking-widest text-[#E06D3B]">Spectrum · live song feed</div>
      {hasStation && stationTitle && <div className="min-w-0 truncate text-[11px] text-slate-300">{stationTitle}</div>}
      <div className="relative overflow-hidden rounded-xl">
        <RadioSpectrum className="!h-28" playing={playing} />
        <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/85 via-black/45 to-black/25 p-3">
          <div role="status" aria-live="polite" data-testid="live-song-status" className="font-mono text-[10px] font-bold uppercase tracking-widest text-[#E06D3B]">{status}</div>
          {line1 && <div data-testid="live-song-title" className="truncate text-sm font-bold text-white sm:text-base" title={line1}>{line1}</div>}
          {line2 && <div data-testid="live-song-artist" className="truncate text-[11px] text-slate-200">{line2}</div>}
          {np.refreshFailed && c && <div className="text-[10px] text-amber-300">Couldn't refresh · showing last known</div>}
        </div>
      </div>
      {rows.length > 0 && (
        <ul aria-label={fromFeed ? 'Recently played' : 'Heard since you tuned in'} data-testid="live-song-recent" className="divide-y divide-white/10 text-xs text-slate-300">
          {rows.map((r) => (
            <li key={r.key} className="flex min-h-[32px] min-w-0 items-center gap-2">
              <span className="min-w-0 flex-1 truncate">{r.text}</span>
              {r.when && <span className="shrink-0 font-mono text-[10px] tabular-nums text-slate-400">{r.when}</span>}
            </li>
          ))}
        </ul>
      )}
      {hasStation && (np.state === 'unsupported' || np.state === 'none' || (np.state === 'error' && !c)) && <NewsCarousel />}
      {hasStation && np.state !== 'unsupported' && <p className="text-[10px] text-slate-500">Song text comes from the station's own feed, refreshed every 30 s.</p>}
    </div>
  );
}

interface Props { stationId: string | null | undefined; stationTitle?: string; playing: boolean }
export function LiveSongDeck({ stationId, stationTitle, playing }: Props): ReactElement {
  const np = useLiveRadioNowPlaying(stationId);
  const [heard, setHeard] = useState<HeardSong[]>([]);
  const lastStation = useRef<string | null | undefined>(stationId);
  useEffect(() => {
    if (lastStation.current !== stationId) { lastStation.current = stationId; setHeard([]); }
    if (np.state === 'ok') setHeard((h) => appendHeard(h, np.current, Date.now()));
  }, [stationId, np.state, np.current?.artist, np.current?.title]); // eslint-disable-line react-hooks/exhaustive-deps
  return <LiveSongDeckView np={np} stationTitle={stationTitle} hasStation={Boolean(stationId)} playing={playing} heard={heard} />;
}
