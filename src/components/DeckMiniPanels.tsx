/* The mini panels for the deck card: Now playing, Up next, Daily Digest, Alerts. Small, condensed, one at a time (MiniRotator).
 * Uses the same data as the big sections (persistent player, the deck's own schedule, the digest store, the last alert check). It starts nothing on its own. */
import { useMemo, type ReactElement } from 'react';
import { Pause, Play } from 'lucide-react';
import type { NowPlayingMedia } from '../types';
import { MiniRotator, type MiniPanel } from './MiniRotator';
import type { useScheduleController } from '../hooks/useScheduleController';
import { usePersistentMedia } from '../hooks/usePersistentMedia';
import { useDigest } from '../hooks/useDigest';
import { useAlertHits } from '../utils/alertHitsStore';
import { podcastArtFor, initialsOf } from '../utils/podcastArt';
import { formatClock, formatDuration } from '../utils/roundRobinSchedule';
import { markRows, DAYPART_SPAN } from '../utils/listenDayparts';

type Controller = ReturnType<typeof useScheduleController>;
const clock = (s: number): string => { const t = Math.max(0, Math.floor(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

function NowPanel({ nowPlaying, onOpenPlayer }: { nowPlaying?: NowPlayingMedia | null; onOpenPlayer?: () => void }): ReactElement {
  const m = usePersistentMedia(nowPlaying?.mediaType, nowPlaying ? `${nowPlaying.src}|${nowPlaying.mediaType}` : undefined, Boolean(nowPlaying));
  const art = nowPlaying ? podcastArtFor(nowPlaying.channelId) ?? nowPlaying.thumbnailUrl : undefined;
  if (!nowPlaying) return <p className="m-0 text-slate-400">Nothing playing. Pick a show or a station.</p>;
  return (
    <div className="flex h-full flex-col justify-between gap-1">
      <div className="flex min-w-0 items-center gap-2">
        <span aria-hidden="true" className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#d4af37]/30 bg-[#0d1629] font-serif text-sm font-bold text-[#e9c964]">
          {art ? <img src={art} alt="" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} /> : null}
          <b>{initialsOf(nowPlaying.subtitle || nowPlaying.title)}</b>
        </span>
        <span className="min-w-0"><strong data-testid="mini-now-title" className="line-clamp-2 text-[13px] text-white" title={nowPlaying.title}>{nowPlaying.title}</strong><small className="block truncate text-[#e9c964]">{nowPlaying.subtitle ?? ''}</small></span>
      </div>
      <div className="flex items-center gap-1">
        <button type="button" data-testid="mini-back15" aria-label="Back 15 seconds" disabled={!m.attached} onClick={() => m.seek(Math.max(0, m.currentTime - 15))} className="ck-key ck-key--sm min-h-[38px]">-15s</button>
        <button type="button" data-testid="mini-play" aria-label={m.paused ? 'Play' : 'Pause'} disabled={!m.attached} onClick={m.toggle} className="ck-key ck-key--sm is-latched min-h-[38px] min-w-[48px]">{m.paused ? <Play size={14} fill="currentColor" /> : <Pause size={14} fill="currentColor" />}</button>
        <button type="button" data-testid="mini-fwd30" aria-label="Forward 30 seconds" disabled={!m.attached} onClick={() => m.seek(m.currentTime + 30)} className="ck-key ck-key--sm min-h-[38px]">+30s</button>
        <span className="ml-auto font-mono tabular-nums text-slate-300">{clock(m.currentTime)}{m.duration > 0 ? ` / ${clock(m.duration)}` : ' · live'}</span>
      </div>
      {onOpenPlayer && <button type="button" data-testid="mini-open-player" onClick={onOpenPlayer} className="ck-key ck-key--sm min-h-[34px] self-start px-3 text-[11px] font-bold uppercase tracking-wider">Open full player ›</button>}
    </div>
  );
}

function NextPanel({ c }: { c: Controller }): ReactElement {
  const rows = c.upcoming.slice(0, 3);
  const markers = useMemo(() => markRows(rows.map((r) => r.startUtcMs), Date.now()), [rows]);
  if (rows.length === 0) return <p className="m-0 text-slate-400">Nothing scheduled yet.</p>;
  const m0 = markers[0];
  return (
    <div className="flex h-full flex-col gap-1">
      <div className="truncate text-[10px] font-bold uppercase tracking-wider text-[#e9c964]">{[m0?.day, m0?.daypart ? `${m0.daypart} · ${DAYPART_SPAN[m0.daypart]} MT` : ''].filter(Boolean).join(' · ') || 'Up next'}</div>
      {rows.map((r, i) => (
        <button key={`${r.track.programId}-${i}`} type="button" data-testid={`mini-next-${i}`} disabled={r.failed} onClick={() => c.pickUpcoming(i)} className="ck-key ck-key--row ck-key--sm min-h-[30px] min-w-0 gap-2 !py-0.5 text-[11px]">
          <span className="shrink-0 font-mono tabular-nums text-[#22D3EE]">{formatClock(r.startUtcMs)}</span>
          <span className="min-w-0 flex-1 truncate">{r.failed ? `${r.track.title} · skipped` : r.track.title}</span>
          <span className="shrink-0 font-mono tabular-nums">{formatDuration(r.track.durationSeconds)}</span>
        </button>
      ))}
    </div>
  );
}

function DigestPanel(): ReactElement {
  const news = useDigest();
  const items = (news.data?.digest?.top ?? []).slice(0, 2);
  if (items.length === 0) return <p className="m-0 text-slate-400">{news.phase === 'loading' ? 'Loading news…' : 'No digest stories right now.'}</p>;
  return (
    <ul className="m-0 flex h-full list-none flex-col gap-1 p-0">
      {items.map((it) => (
        <li key={it.id} className="min-h-0 flex-1"><a href={it.url} target="_blank" rel="noopener noreferrer" className="block rounded-md border border-white/10 bg-white/5 px-2 py-1 hover:border-[#d4af37]/60">
          <span className="block truncate font-mono text-[9px] uppercase tracking-widest text-slate-400">{it.source}</span>
          <span className="line-clamp-2 text-xs font-bold leading-tight text-white" title={it.title}>{it.title}</span>
        </a></li>
      ))}
    </ul>
  );
}

function AlertsPanel(): ReactElement {
  const hits = useAlertHits().filter((h) => !h.archive);
  if (hits.length === 0) return <p className="m-0 text-slate-400">No new alert hits. Rules live in Find &amp; save.</p>;
  return (
    <div className="flex h-full flex-col gap-1">
      <div className="text-[10px] font-bold uppercase tracking-wider text-[#e9c964]">{hits.length} new {hits.length === 1 ? 'hit' : 'hits'}</div>
      {hits.slice(0, 3).map((h) => <div key={h.id} className="min-w-0 rounded-md border border-white/10 bg-white/5 px-2 py-1"><span className="font-bold text-[#e9c964]">{h.term}</span><span className="block truncate text-[11px] text-slate-200">{h.showName}</span></div>)}
    </div>
  );
}

export function DeckMiniPanels({ c, nowPlaying, onOpenPlayer }: { c: Controller; nowPlaying?: NowPlayingMedia | null; onOpenPlayer?: () => void }): ReactElement {
  const fresh = useAlertHits().some((h) => !h.archive);
  const panels: MiniPanel[] = [
    { key: 'now', label: 'Now playing', content: <NowPanel nowPlaying={nowPlaying} onOpenPlayer={onOpenPlayer} /> },
    { key: 'next', label: 'Up next', content: <NextPanel c={c} /> },
    { key: 'digest', label: 'Daily Digest', content: <DigestPanel /> },
    { key: 'alerts', label: 'Alerts', content: <AlertsPanel />, badge: fresh },
  ];
  return <MiniRotator panels={panels} />;
}
