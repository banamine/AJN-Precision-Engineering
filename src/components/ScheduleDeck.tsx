import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { NowPlayingMedia, PlayProgramCallback } from '../types';
import { RadioSpectrum } from './RadioSpectrum';
import { useScheduleController } from '../hooks/useScheduleController';
import { buildMusicPools, loadConcertPools, loadFmPools, loadPodcastPools } from '../utils/scheduleCatalog';
import { formatClock, formatDuration, formatRepeat, loopSeconds, DAY_MS, type SchedPool, type ScheduleBank } from '../utils/roundRobinSchedule';

interface Props { bank: ScheduleBank; onPlayProgram: PlayProgramCallback; nowPlaying?: NowPlayingMedia | null; playingNow?: boolean }
export const GENRE_KEYS_MAX = 8;
const ROW_LABELS = ['Next', 'Later', 'Then'] as const;
const BANK_LABEL: Record<ScheduleBank, string> = { music: 'Music channels', concerts: 'Live concerts', fm: 'FM broadcasts', podcasts: 'Podcasts' };

/** Spectrum & 24-Hour Schedule Deck: the right-hand Head Unit panel while Archive Music is selected. */
export function ScheduleDeck({ bank, onPlayProgram, nowPlaying, playingNow }: Props): ReactElement {
  const musicPools = useMemo(() => buildMusicPools(), []);
  const [loaded, setLoaded] = useState<Partial<Record<ScheduleBank, SchedPool[]>>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    if (bank === 'music' || loaded[bank]) return;
    let alive = true; setLoadError(null);
    (bank === 'concerts' ? loadConcertPools() : bank === 'podcasts' ? loadPodcastPools() : loadFmPools()).then((p) => { if (alive) setLoaded((l) => ({ ...l, [bank]: p })); })
      .catch((e: unknown) => { if (alive) setLoadError(e instanceof Error ? e.message : 'could not load the list'); });
    return () => { alive = false; };
  }, [bank, loaded]);
  const pools: SchedPool[] | null = bank === 'music' ? musicPools : loaded[bank] ?? null;

  const [chosen, setChosen] = useState<Partial<Record<ScheduleBank, string>>>({});
  const pool = useMemo(() => {
    if (!pools || !pools.length) return null;
    const want = chosen[bank] ?? (bank === 'music' ? pools.find((p) => p.id === nowPlaying?.channelId)?.id ?? pools.find((p) => p.items[0]?.tracks.every((t) => t.durationSeconds))?.id : undefined);
    return pools.find((p) => p.id === want) ?? pools[0];
  }, [pools, chosen, bank, nowPlaying?.channelId]);

  const c = useScheduleController(pool, onPlayProgram, nowPlaying?.programId, true);
  // Direct-tune genre keys: pick a real pool and start it. The controller follows `pool`, so tune once it has switched.
  const [tuneWanted, setTuneWanted] = useState<string | null>(null);
  useEffect(() => { if (tuneWanted && pool?.id === tuneWanted) { setTuneWanted(null); c.tune(); } }, [tuneWanted, pool?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const directTune = (id: string): void => { if (pool?.id === id) c.tune(); else { setChosen((s) => ({ ...s, [bank]: id })); setTuneWanted(id); } };
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => { const id = window.setInterval(() => setNowMs(Date.now()), 1000); return () => window.clearInterval(id); }, []);

  const total = pool ? loopSeconds(pool, nowMs) : null;
  const repeat = c.clockEligible && total !== null && total < DAY_MS / 1000 ? `Repeats every ${formatRepeat(total)}${c.now ? ` · Cycle ${c.now.cycle}` : ''}` : null;
  const status = !c.tuned ? 'SCHEDULE PREVIEW' : c.mode === 'off-schedule' ? 'OFF SCHEDULE' : c.mode === 'shuffle' ? 'SHUFFLE'
    : c.seekStatus === 'pending' ? 'TUNING…' : c.seekStatus === 'fallback-zero' ? 'PLAYING FROM 0:00 · SEEK UNAVAILABLE' : 'ON AIR · UTC SYNCED';
  const dur = c.now?.track.durationSeconds; const pct = dur ? Math.min(100, Math.max(0, (c.elapsedSec / dur) * 100)) : 0;
  const windowLabel = c.now && c.now.startUtcMs !== null && c.now.endUtcMs !== null ? `${formatClock(c.now.startUtcMs)} – ${formatClock(c.now.endUtcMs)}` : null;

  return (
    <div data-testid="schedule-deck" className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-widest">
        <span className="text-[#E06D3B]">Spectrum · 24h schedule</span>
        <div role="group" aria-label="Schedule mode" className="flex gap-1">
          <button type="button" data-testid="schedule-mode-clock" aria-pressed={c.mode !== 'shuffle'} disabled={!c.clockEligible} onClick={() => c.setMode('clock24h')}
            className="ck-key ck-key--sm">24h Clock</button>
          <button type="button" data-testid="schedule-mode-shuffle" aria-pressed={c.mode === 'shuffle'} onClick={() => c.setMode('shuffle')}
            className="ck-key ck-key--sm">Shuffle</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
        {pools && pools.length > 1 ? (
          <select aria-label={`${BANK_LABEL[bank]} pool`} data-testid="schedule-pool" value={pool?.id ?? ''} onChange={(e) => setChosen((s) => ({ ...s, [bank]: e.currentTarget.value }))}
            className="min-h-[40px] min-w-0 max-w-full flex-1 rounded-md border border-white/15 bg-black/40 px-2 text-xs text-white focus-visible:ring-2 focus-visible:ring-[var(--ajn-accent)]">
            {pools.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        ) : <span className="min-w-0 flex-1 truncate">{pool?.label ?? BANK_LABEL[bank]}</span>}
        {c.tuned && c.mode === 'off-schedule' && <button type="button" data-testid="schedule-return-live" onClick={c.returnToLive} className="ck-key ck-key--sm is-latched">Return to live</button>}
        {!c.tuned && pool && <button type="button" data-testid="schedule-tune" onClick={c.tune} className="ck-key ck-key--sm">{c.mode === 'shuffle' ? 'Play shuffle' : 'Tune live'}</button>}
      </div>
      {pools && pools.length > 1 && (
        <div role="group" aria-label={`${BANK_LABEL[bank]} direct tune`} data-testid="schedule-genre-keys" className="flex flex-wrap gap-1">
          {pools.slice(0, GENRE_KEYS_MAX).map((p) => (
            <button key={p.id} type="button" data-testid="schedule-genre-key" aria-pressed={pool?.id === p.id && c.tuned} title={`Tune ${p.label}`} onClick={() => directTune(p.id)} className="ck-key ck-key--sm max-w-[10rem] truncate text-[11px]">{p.label}</button>
          ))}
        </div>
      )}
      {!pool && <p role="status" className="text-xs text-slate-300">{loadError ? `${BANK_LABEL[bank]} unavailable: ${loadError}` : pools ? `${BANK_LABEL[bank]}: nothing to schedule yet.` : `Loading ${BANK_LABEL[bank].toLowerCase()}…`}</p>}
      {pool && !c.clockEligible && <p className="text-[11px] text-amber-300">Shuffle only · durations not in {bank === 'music' ? 'snapshot' : 'manifest'}</p>}
      {repeat && <p className="text-[11px] tabular-nums text-slate-300">{repeat}</p>}

      <div className="relative overflow-hidden rounded-xl">
        <RadioSpectrum className="!h-28" playing={Boolean(playingNow)} />
        <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/85 via-black/45 to-black/25 p-3">
          {c.now ? (<>
            <div role="status" aria-live="polite" className="font-mono text-[10px] font-bold uppercase tracking-widest text-[#E06D3B]">{status}</div>
            <div className="truncate text-sm font-bold text-white sm:text-base" title={c.now.track.title}>{c.now.track.title}</div>
            <div className="flex min-w-0 items-center gap-2 text-[11px] text-slate-200">
              <span className="min-w-0 flex-1 truncate">{c.now.track.subtitle}</span>
              {windowLabel && <span className="shrink-0 font-mono tabular-nums text-[#22D3EE]">{windowLabel}</span>}
              <span className="shrink-0 font-mono tabular-nums">{formatDuration(c.elapsedSec)} / {formatDuration(dur)}</span>
            </div>
            <div className="mt-1 h-0.5 w-full bg-white/15"><div className="h-full bg-[#E06D3B] transition-[width] duration-200 motion-reduce:transition-none" style={{ width: `${pct}%` }} /></div>
          </>) : <div className="text-xs text-slate-200">{pool ? 'Nothing scheduled.' : ''}</div>}
        </div>
      </div>
      {c.note && <p role="status" data-testid="schedule-note" className="text-[11px] text-amber-300">{c.note}</p>}

      <ol aria-label="Up next" className="flex flex-col gap-1.5">
        {c.upcoming.map((r, i) => (
          <li key={`${r.track.programId}-${i}`}>
            <button type="button" data-testid={`schedule-next-${i}`} onClick={() => c.pickUpcoming(i)} disabled={r.failed}
              className="ck-key ck-key--row ck-key--sm min-h-[44px] min-w-0 gap-2 text-xs">
              <span className="w-10 shrink-0 text-[10px] font-bold uppercase tracking-wider text-slate-400">{ROW_LABELS[i]}</span>
              <span className="shrink-0 font-mono tabular-nums text-[#22D3EE]">{formatClock(r.startUtcMs)}</span>
              <span className="min-w-0 flex-1 truncate">{r.failed ? `${r.track.title} · Failed to load — skipped` : r.track.title}</span>
              <span className="shrink-0 font-mono tabular-nums">{formatDuration(r.track.durationSeconds)}</span>
            </button>
          </li>
        ))}
      </ol>
      {c.aired.length > 0 && (
        <ul aria-label="Recently aired" className="text-[11px] text-slate-400">
          {c.aired.slice(0, 3).map((a) => <li key={`${a.programId}-${a.airedAtUtcMs}`} className="flex min-w-0 gap-2"><span className="shrink-0 font-mono tabular-nums">{formatClock(a.airedAtUtcMs)}</span><span className="min-w-0 truncate">{a.title} · {a.subtitle}</span></li>)}
        </ul>
      )}
    </div>
  );
}
