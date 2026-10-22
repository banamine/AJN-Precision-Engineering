import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Play } from 'lucide-react';
import { ChannelLogo } from './ChannelLogo';
import { LazyThumb } from './LazyThumb';
import { getCachedLightSchedule, getCachedSchedule } from '../guide/scheduleCache';
import { loadSchedule } from '../guide/loadSchedule';
import { buildLiveRows, liveCategories, rowsForCategory, LIVE_ALL, type GuideChannels, type LiveStripRow } from '../guide/liveStrip';
import { tuneIn } from '../guide/liveTune';
import { saveFilterPrefs } from '../guide/filterPrefs';
import { ajnArtFor } from '../utils/ajnArt';
import type { Destination, MediaType, PlayProgramCallback, ScheduleChannel } from '../types';

const TV_GUIDE = 'cable-tv';
const AUDIO_GUIDE = 'audio-podcasts'; // ~20 MB: loaded only when the viewer asks for it (or it is already in the cache)
const cachedAudioSchedule = () => getCachedLightSchedule(AUDIO_GUIDE) ?? getCachedSchedule(AUDIO_GUIDE);
const ROWS_SHOWN = 8;
const MAX_CHIPS = 14;
const CAT_KEY = 'ajn.home.liveCat.v1';

const hourNow = () => { const d = new Date(); return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; };
const readCat = () => { try { return window.localStorage.getItem(CAT_KEY) || LIVE_ALL; } catch { return LIVE_ALL; } };
const writeCat = (v: string) => { try { window.localStorage.setItem(CAT_KEY, v); } catch { /* remembered only for this visit */ } };

interface Props { onPlayProgram: PlayProgramCallback; onNavigate: (d: Destination) => void }

/** Live page category strip: pick a category, see its channels with the ones on air right now first. Same schedule cache, helpers and tune-in as the TV Guide. */
export function HomeLiveStrip({ onPlayProgram, onNavigate }: Props) {
  const [guides, setGuides] = useState<GuideChannels[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<string>(readCat);
  const [nowHour, setNowHour] = useState(hourNow);
  const [attempt, setAttempt] = useState(0);
  const [audioWanted, setAudioWanted] = useState(() => !!cachedAudioSchedule());
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null); setAudioError(null);
    const wanted = audioWanted ? [TV_GUIDE, AUDIO_GUIDE] : [TV_GUIDE];
    if (audioWanted && !cachedAudioSchedule()) setAudioLoading(true);
    Promise.allSettled(wanted.map((g) => loadSchedule(g))).then((results) => {
      if (!alive) return;
      setAudioLoading(false);
      const ok: GuideChannels[] = [];
      results.forEach((r, i) => { if (r.status === 'fulfilled') ok.push({ guideId: wanted[i], channels: r.value }); });
      const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      const reason = failure ? (failure.reason instanceof Error ? failure.reason.message : 'schedule unavailable') : null;
      if (ok.length === 0) { setError(reason); return; }
      if (reason && audioWanted && !ok.some((g) => g.guideId === AUDIO_GUIDE)) setAudioError(reason);
      setGuides(ok);
    });
    return () => { alive = false; };
  }, [attempt, audioWanted]);

  useEffect(() => {
    const id = window.setInterval(() => setNowHour(hourNow()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const rows = useMemo(() => (guides ? buildLiveRows(guides, nowHour) : []), [guides, nowHour]);
  const cats = useMemo(() => liveCategories(rows), [rows]);
  // A remembered category that no longer exists falls back to All once the lineup has loaded.
  const active = category === LIVE_ALL || cats.some((c) => c.id === category) ? category : LIVE_ALL;
  const { shown, total } = useMemo(() => rowsForCategory(rows, active, ROWS_SHOWN), [rows, active]);
  const onAirTotal = useMemo(() => rows.filter((r) => (active === LIVE_ALL || r.categoryId === active) && r.onAir).length, [rows, active]);

  const pick = useCallback((id: string) => { setCategory(id); writeCat(id); }, []);

  const play = (r: LiveStripRow) => {
    if (!r.program) return;
    const p = r.program;
    const t = tuneIn(p, r.sHour, r.eHour, nowHour);
    const mt: MediaType = p.mediaType || r.channel.mediaType || (r.guideId === AUDIO_GUIDE ? 'audio' : 'video');
    onPlayProgram(t.path, p.title, r.channel.name, mt, r.channel.id, p.guideId ?? r.guideId, p.id, p.sourceId ?? p.metadata?.sourceId, p.assetId ?? p.metadata?.assetId, t.startAtSeconds);
  };

  const openInGuide = () => {
    const mine = rows.filter((r) => active === LIVE_ALL || r.categoryId === active);
    const counts = new Map<string, number>();
    mine.forEach((r) => counts.set(r.guideId, (counts.get(r.guideId) ?? 0) + 1));
    const guideId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? TV_GUIDE;
    if (active !== LIVE_ALL) saveFilterPrefs(guideId, { category: active, onNow: false });
    window.dispatchEvent(new CustomEvent('ajn:select-guide', { detail: { guideId } }));
    window.dispatchEvent(new CustomEvent('ajn:guide-filter', { detail: { guideId, category: active } }));
    onNavigate('tv-guide');
  };

  return (
    <section aria-labelledby="live-strip-heading" className="space-y-3" data-testid="home-live-strip">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 id="live-strip-heading" className="text-lg font-semibold tracking-tight text-neutral-100">Browse Live by Category</h2>
          <p className="text-xs text-neutral-500">Pick a category. Channels on air right now come first.</p>
        </div>
      </div>

      {error && !guides ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-200" data-testid="live-strip-error">
          Could not load the channel list ({error}).
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className="rounded border border-red-700/70 px-2 py-0.5 text-red-100 hover:bg-red-900/40 cursor-pointer">Try again</button>
        </div>
      ) : !guides ? (
        <div className="h-9 animate-pulse rounded-lg bg-neutral-900" aria-label="Loading categories" data-testid="live-strip-loading" />
      ) : (
        <>
          <div role="group" aria-label="Filter live channels by category" className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]" data-testid="live-strip-chips">
            {[{ id: LIVE_ALL, label: 'All', count: rows.length, onAir: rows.filter((r) => r.onAir).length }, ...cats.slice(0, MAX_CHIPS)].map((c) => (
              <button key={c.id} type="button" aria-pressed={active === c.id} data-category={c.id} onClick={() => pick(c.id)}
                className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${active === c.id ? 'border-sky-500/60 bg-sky-500/20 text-sky-100' : 'border-neutral-700 text-neutral-300 hover:bg-neutral-800'}`}>
                {c.label}
                <span className="tabular-nums text-[10px] text-neutral-400">{c.onAir > 0 ? <><span className="text-emerald-400">{c.onAir}</span>/{c.count}</> : c.count}</span>
              </button>
            ))}
            {!guides.some((g) => g.guideId === AUDIO_GUIDE) && (
              <button type="button" disabled={audioLoading} onClick={() => setAudioWanted(true)} data-testid="live-strip-load-audio"
                className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-dashed border-amber-500/50 px-3 py-1 text-xs font-medium text-amber-200 transition hover:bg-amber-500/10 disabled:cursor-wait disabled:opacity-60">
                {audioLoading ? 'Loading audio…' : '+ Audio & Music'}
              </button>
            )}
          </div>
          {audioError && <p role="alert" className="text-xs text-red-300" data-testid="live-strip-audio-error">Could not load audio channels ({audioError}). <button type="button" onClick={() => setAttempt((n) => n + 1)} className="underline cursor-pointer">Try again</button></p>}

          {shown.length === 0 ? (
            <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-3 py-3 text-xs text-neutral-400" data-testid="live-strip-empty">
              No channels in this category yet.
              <button type="button" onClick={() => pick(LIVE_ALL)} className="ml-3 rounded border border-neutral-700 px-2 py-0.5 text-neutral-200 hover:bg-neutral-800 cursor-pointer">Show all</button>
            </div>
          ) : (
            <ul className="divide-y divide-neutral-800 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/40" data-testid="live-strip-rows">
              {shown.map((r) => (
                <li key={r.key} data-on-air={r.onAir} className={`flex items-center gap-3 px-3 py-2 ${r.onAir ? '' : 'opacity-60'}`}>
                  <ChannelLogo logo={r.channel.logo} name={r.channel.name} fallback={
                    <LazyThumb title={r.channel.name} input={{
                      path: r.program?.archivePath ?? r.program?.mediaUrl ?? r.channel.programs[0]?.archivePath ?? r.channel.programs[0]?.mediaUrl ?? null,
                      guideId: r.guideId, channelId: r.channel.id, category: r.channel.group ?? null, mediaType: r.channel.mediaType, name: r.channel.name,
                      placeholder: ajnArtFor({ show: `${r.channel.name} ${r.channel.group ?? ''}`, mediaType: r.channel.mediaType, onlyAjn: true }),
                    }} />
                  } />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-neutral-100" title={r.channel.name}>{r.channel.name}</span>
                      {r.onAir
                        ? <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-emerald-300">On air</span>
                        : <span className="shrink-0 rounded bg-neutral-800 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-neutral-400">Off air</span>}
                    </div>
                    <p className="truncate text-xs text-neutral-400">{r.program ? r.program.title : 'Nothing scheduled right now'}</p>
                  </div>
                  <button type="button" disabled={!r.onAir} onClick={() => play(r)} aria-label={`Play ${r.channel.name}`}
                    className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-lg bg-sky-500 px-3 text-xs font-semibold text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500">
                    <Play className="h-3.5 w-3.5" aria-hidden="true" /> Play
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center justify-between text-xs text-neutral-500">
            <span data-testid="live-strip-count">{total === 0 ? '' : `Showing ${shown.length} of ${total} · ${onAirTotal} on air now`}</span>
            <button type="button" onClick={openInGuide} data-testid="live-strip-open-guide" className="inline-flex cursor-pointer items-center gap-1 rounded border border-neutral-700 px-2 py-1 text-neutral-200 hover:bg-neutral-800">
              See all in Guide <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
        </>
      )}
    </section>
  );
}
