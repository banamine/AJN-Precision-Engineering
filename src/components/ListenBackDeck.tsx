import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import type { Destination, NowPlayingMedia, PlayProgramCallback } from '../types';
import { AvSyncControls } from './AvSyncControls';
import { usePersistentMedia } from '../hooks/usePersistentMedia';
import { formatClock } from '../utils/ajnRadioBrowse';
import type { RadioEntry } from '../utils/ajnRadioCatalog';
import { AJN_CHANNEL_LABELS } from '../utils/ajnClassify';
import { AJN_SYNC_CHANNEL, loadEntries } from '../hooks/useAvSync';
import { baseIdOf } from '../utils/avSync';

/** Listen Back: AJN's own hourly broadcast archives (audio), each marked when a paired video exists.
 *  Playing starts the audio; the AV Sync switch under the head unit then offers WATCH VIDEO / mini player at the same playhead. */
export const LB_PAGE = 6;
export function pageSlice<T>(items: readonly T[], page: number, size = LB_PAGE): T[] { return items.slice(page * size, page * size + size); }
export function lastPage(n: number, size = LB_PAGE): number { return Math.max(0, Math.ceil(n / size) - 1); }

interface ViewProps {
  entries: readonly RadioEntry[] | null; error: string | null; videoOnly: boolean; page: number; playingBase: string | null;
  onToggleVideo: () => void; onPage: (dir: 1 | -1) => void; onPlay: (e: RadioEntry) => void;
  /** Transport + AV Sync, supplied by the wrapper (they need the live player). Omitted in static renders. */
  controls?: ReactElement | null;
}
export function ListenBackDeckView({ entries, error, videoOnly, page, playingBase, onToggleVideo, onPage, onPlay, controls }: ViewProps): ReactElement {
  const shown = useMemo(() => (entries ?? []).filter((e) => !videoOnly || e.videoUrl), [entries, videoOnly]);
  const withVideo = (entries ?? []).filter((e) => e.videoUrl).length;
  const rows = pageSlice(shown, page);
  const last = lastPage(shown.length);
  return (
    <div data-testid="listen-back-deck" className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-widest">
        <span className="text-[#E06D3B]">Listen back · hourly archives</span>
        <button type="button" className="ck-key ck-key--sm" data-testid="listen-back-video-only" aria-pressed={videoOnly} onClick={onToggleVideo}>With video</button>
      </div>
      {error && <p role="alert" className="text-xs text-amber-300">Archives unavailable ({error}).</p>}
      {!error && !entries && <p role="status" className="text-xs text-slate-300">Loading broadcast archives…</p>}
      {entries && <p data-testid="listen-back-count" className="text-[11px] text-slate-300">{entries.length.toLocaleString()} archived hours · {withVideo.toLocaleString()} with video</p>}
      {entries && rows.length === 0 && <p className="text-xs text-slate-300">{videoOnly ? 'No archived hours have a paired video.' : 'No archived hours found.'}</p>}
      <ol aria-label="Archived hours" className="flex flex-col gap-1.5">
        {rows.map((e) => (
          <li key={e.id}>
            <button type="button" data-testid="listen-back-row" aria-current={playingBase === e.id ? 'true' : undefined} onClick={() => onPlay(e)} className="ck-key ck-key--row ck-key--sm min-h-[44px] min-w-0 gap-2 text-xs">
              <span className="shrink-0 font-mono text-[10px] text-slate-400">{e.airDate ?? 'undated'}</span>
              <span className="min-w-0 flex-1 truncate">{e.title}</span>
              {e.videoUrl && <span className="shrink-0 rounded border border-[#E06D3B] px-1 font-mono text-[9px] text-[#F9A56D]">VIDEO</span>}
            </button>
          </li>
        ))}
      </ol>
      {shown.length > LB_PAGE && (
        <div className="flex items-center gap-2">
          <button type="button" className="ck-key ck-key--sm" disabled={page <= 0} onClick={() => onPage(-1)} aria-label="Newer archived hours">‹ Newer</button>
          <span className="flex-1 text-center font-mono text-[10px] tabular-nums text-slate-400">{page + 1} / {last + 1}</span>
          <button type="button" className="ck-key ck-key--sm" disabled={page >= last} onClick={() => onPage(1)} aria-label="Older archived hours">Older ›</button>
        </div>
      )}
      {controls}
    </div>
  );
}

interface Props { onPlayProgram: PlayProgramCallback; nowPlaying?: NowPlayingMedia | null; onNavigate?: (destination: Destination) => void }
export function ListenBackDeck({ onPlayProgram, nowPlaying, onNavigate }: Props): ReactElement {
  const [entries, setEntries] = useState<RadioEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [videoOnly, setVideoOnly] = useState(false);
  const [page, setPage] = useState(0);
  useEffect(() => {
    let live = true;
    loadEntries().then((l) => { if (live) setEntries(l); }).catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : 'could not load'); });
    return () => { live = false; };
  }, []);
  const shownAll = (entries ?? []).filter((e) => !videoOnly || e.videoUrl);
  const total = shownAll.length;
  const playingBase = nowPlaying?.channelId === AJN_SYNC_CHANNEL ? baseIdOf(nowPlaying.programId) : null;
  const idx = playingBase ? shownAll.findIndex((e) => e.id === playingBase) : -1;
  const older = idx >= 0 ? shownAll[idx + 1] : undefined; // list is newest first
  const newer = idx > 0 ? shownAll[idx - 1] : undefined;
  const play = (e: RadioEntry): void => onPlayProgram(e.audioUrl, e.title, AJN_CHANNEL_LABELS[e.channel], 'audio', AJN_SYNC_CHANNEL, AJN_SYNC_CHANNEL, e.id);
  const media = usePersistentMedia(nowPlaying?.mediaType, nowPlaying ? `${nowPlaying.src}|${nowPlaying.mediaType}` : undefined, Boolean(nowPlaying));
  const playingEntry = idx >= 0 ? shownAll[idx] : (entries ?? []).find((e) => e.id === playingBase);
  const controls = (
    <div data-testid="listen-back-controls" className="mt-auto flex flex-col gap-2 border-t border-white/10 pt-2">
      {nowPlaying && playingBase && <div className="min-w-0 truncate text-[11px] text-slate-200" data-testid="listen-back-now">{nowPlaying.title}</div>}
      <div className="flex items-center gap-2">
        <button type="button" className="ck-key ck-key--icon" aria-label="Newer hour" disabled={!newer} onClick={() => newer && play(newer)}><SkipBack size={16} fill="currentColor" /></button>
        <button type="button" className="ck-key ck-key--icon" data-testid="listen-back-play" aria-label={media.paused ? 'Play' : 'Pause'} disabled={!nowPlaying || !media.attached} onClick={media.toggle}>{media.paused ? <Play size={18} fill="currentColor" /> : <Pause size={18} fill="currentColor" />}</button>
        <button type="button" className="ck-key ck-key--icon" aria-label="Older hour" disabled={!older} onClick={() => older && play(older)}><SkipForward size={16} fill="currentColor" /></button>
        <span className="font-mono text-[10px] tabular-nums text-slate-300" data-testid="listen-back-elapsed">{nowPlaying ? formatClock(media.currentTime) : '0:00'}</span>
        <input aria-label="Seek" type="range" className="min-w-0 flex-1" min={0} max={media.duration > 0 ? Math.floor(media.duration) : 1} value={media.duration > 0 ? Math.floor(media.currentTime) : 0}
          disabled={!nowPlaying || media.duration <= 0} onChange={(ev) => media.seek(Number(ev.target.value))} />
        <span className="font-mono text-[10px] tabular-nums text-slate-300">{media.duration > 0 ? formatClock(media.duration) : '—'}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2" data-testid="listen-back-av">
        <AvSyncControls nowPlaying={nowPlaying} onPlay={onPlayProgram} onNavigate={onNavigate} variant="deck" />
        {playingBase && playingEntry && !playingEntry.videoUrl && <span className="text-[11px] text-slate-400" data-testid="listen-back-no-video">No video was published for this hour.</span>}
        {nowPlaying && onNavigate && <button type="button" className="ck-key ck-key--sm" onClick={() => onNavigate('player')}>Full player</button>}
      </div>
    </div>
  );
  return (
    <ListenBackDeckView entries={entries} error={error} videoOnly={videoOnly} page={Math.min(page, lastPage(total))}
      playingBase={playingBase} controls={controls}
      onToggleVideo={() => { setVideoOnly((v) => !v); setPage(0); }}
      onPage={(d) => setPage((p) => Math.max(0, Math.min(lastPage(total), p + d)))}
      onPlay={play} />
  );
}
