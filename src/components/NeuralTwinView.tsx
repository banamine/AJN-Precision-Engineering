/* App Health Neural Twin, inside the Engineering & Diagnostics console. Read-only: it looks at the page and the data files;
 * it never changes the player. Parts with no real signal say "Not wired" instead of showing a made-up value. */
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { EDGES, LOBES, NEURONS, type LobeId } from '../neural/topology';
import { nodeEdges } from '../neural/sceneMath';
import { readAll, probeDigest, captureFrame, type DigestProbe, type FrameProbe, type MediaLike, type TelemetryEnv, type Reading } from '../neural/telemetry';
import { useJingle, jingleStore } from '../utils/jingleStore';
import { readSharedQuery } from '../hooks/useSharedSearch';
import newsRss from '../data/newsRssSources.json';
import fmData from '../data/fmBroadcastChannels.json';
import podcastSources from '../data/podcastSources.json';

const NeuralScene = lazy(() => import('./NeuralScene').then((m) => ({ default: m.NeuralScene })));
const STATE_STYLE: Record<Reading['state'], string> = { live: 'text-emerald-300 border-emerald-500/40', idle: 'text-neutral-300 border-neutral-700', static: 'text-sky-300 border-sky-500/40', unwired: 'text-neutral-500 border-neutral-800' };
const STATE_LABEL: Record<Reading['state'], string> = { live: 'LIVE', idle: 'IDLE', static: 'DATA', unwired: 'NOT WIRED' };

function pickMedia(tag: 'audio' | 'video'): MediaLike | null {
  if (typeof document === 'undefined') return null;
  const els = [...document.querySelectorAll<HTMLMediaElement>(tag)];
  return els.find((e) => !e.paused) ?? els[0] ?? null;
}

export function NeuralTwinView() {
  const jingle = useJingle();
  const [tick, setTick] = useState(0);
  const [digest, setDigest] = useState<DigestProbe | null>(null);
  const [checking, setChecking] = useState(false);
  const [frame, setFrame] = useState<{ probe: FrameProbe; dataUrl?: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [lobe, setLobe] = useState<LobeId | 'all'>('all');
  const [autoOrbit, setAutoOrbit] = useState(false);
  const [concerts, setConcerts] = useState<number | null>(null);

  useEffect(() => { const t = window.setInterval(() => setTick((x) => x + 1), 1000); return () => window.clearInterval(t); }, []);
  useEffect(() => { let off = false; import('../data/concertPoolsManifest.json').then((m) => { if (!off) setConcerts((m.default as unknown as { pools: { concerts: unknown[] }[] }).pools.reduce((s, p) => s + p.concerts.length, 0)); }).catch(() => undefined); return () => { off = true; }; }, []);
  // a frame of the video being watched, every 30 s, only while it plays (never for other stations)
  useEffect(() => {
    const grab = () => { const v = pickMedia('video') as HTMLVideoElement | null; if (v && !v.paused) setFrame(captureFrame(v, () => document.createElement('canvas'), Date.now)); };
    const t = window.setInterval(grab, 30_000); return () => window.clearInterval(t);
  }, []);
  const check = useCallback(async () => { setChecking(true); setDigest(await probeDigest(fetch.bind(window), Date.now, () => performance.now())); setChecking(false); }, []);

  const readings = useMemo(() => {
    void tick;
    const feeds = (newsRss as unknown as { feeds: { collectedByDigest: boolean }[] }).feeds;
    let q = ''; try { q = readSharedQuery(window.sessionStorage); } catch { /* storage blocked */ }
    const env: TelemetryEnv = {
      audio: pickMedia('audio'), video: pickMedia('video'), jingle, sharedQuery: q,
      counts: { concerts, fm: (fmData as unknown as { broadcasts: unknown[] }).broadcasts.length, rssFeeds: feeds.length, rssCollected: feeds.filter((f) => f.collectedByDigest).length, podcastFeeds: (podcastSources as unknown as { sources: unknown[] }).sources.length },
      digest, frame: frame?.probe ?? null, now: Date.now(),
    };
    return readAll(env);
  }, [tick, jingle, digest, frame, concerts]);

  const byId = new Map(readings.map((r) => [r.id, r]));
  const sel = NEURONS.find((n) => n.id === selected) ?? null;
  const selReading = sel ? byId.get(sel.id) : null;
  const liveCount = readings.filter((r) => r.state === 'live').length;

  return (
    <section data-testid="neural-twin" className="space-y-4 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div><h2 className="text-lg font-semibold text-neutral-50">App Health Neural Twin</h2>
          <p className="text-xs text-neutral-400">{NEURONS.length} parts in {LOBES.length} groups. The map shows how the app is wired; only a part with a real signal lights up or sends a dot. {liveCount} live right now.</p></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" data-testid="neural-check-digest" onClick={check} disabled={checking} className="ck-key ck-key--sm">{checking ? 'Checking…' : 'Check digest now'}</button>
          <button type="button" data-testid="neural-jingle" aria-pressed={jingle.on} onClick={() => jingleStore.setOn(!jingle.on)} className={`ck-key ck-key--sm ${jingle.on ? 'is-latched' : ''}`}>Buffer jingle {jingle.on ? 'on' : 'off'}</button>
        </div>
      </header>
      <div data-testid="neural-controls" className="flex flex-wrap items-center gap-1.5">
        <button type="button" data-testid="lobe-all" aria-pressed={lobe === 'all'} onClick={() => setLobe('all')} className={`ck-key ck-key--sm ${lobe === 'all' ? 'is-latched' : ''}`}>All</button>
        {LOBES.map((l) => (
          <button key={l.id} type="button" data-testid={`lobe-${l.id}`} aria-pressed={lobe === l.id} onClick={() => setLobe(lobe === l.id ? 'all' : l.id)} className={`ck-key ck-key--sm ${lobe === l.id ? 'is-latched' : ''}`}><span aria-hidden className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: l.color }} />{l.label}</button>
        ))}
        <button type="button" data-testid="neural-auto-orbit" aria-pressed={autoOrbit} onClick={() => setAutoOrbit((x) => !x)} className={`ck-key ck-key--sm ml-auto ${autoOrbit ? 'is-latched' : ''}`}>Auto-orbit: {autoOrbit ? 'on' : 'off'}</button>
      </div>
      <Suspense fallback={<div className="h-[460px] md:h-[580px] rounded-xl border border-neutral-800 p-4 text-sm text-neutral-500">Loading 3D map…</div>}>
        <NeuralScene readings={readings} selected={selected} onSelect={setSelected} lobe={lobe} autoOrbit={autoOrbit} />
      </Suspense>
      {sel && selReading && (
        <div data-testid="neural-inspector" className="rounded-xl border border-neutral-700 bg-neutral-950 p-3 text-sm">
          <div className="flex items-center justify-between gap-2"><strong className="text-neutral-50">{sel.label}</strong><span className={`rounded border px-1.5 text-[10px] ${STATE_STYLE[selReading.state]}`}>{STATE_LABEL[selReading.state]}</span></div>
          <p className="text-xs text-neutral-400">{sel.role}</p><p className="font-mono text-[11px] text-neutral-500">{sel.file}</p>
          <p className="mt-2 text-neutral-200">{selReading.headline}</p>
          <ul className="mt-1 space-y-0.5 text-xs text-neutral-400">{selReading.details.map((d) => <li key={d}>{d}</li>)}</ul>
          <div data-testid="neural-connections" className="mt-2 border-t border-neutral-800 pt-2">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Connections</p>
            <ul className="space-y-0.5">
              {nodeEdges(sel.id, EDGES).map((c) => { const other = NEURONS.find((n) => n.id === c.otherId); const src = byId.get(c.isSource ? sel.id : c.otherId); const active = src?.state === 'live' && !!src.payload; return (
                <li key={`${c.otherId}-${c.kind}-${c.isSource}`}><button type="button" onClick={() => setSelected(c.otherId)} className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-0.5 text-left text-xs hover:bg-neutral-800/60">
                  <span className="truncate text-neutral-200">{c.isSource ? '→' : '←'} {other?.label ?? c.otherId} <span className="text-neutral-500">· {c.kind}</span></span>
                  <span className={`shrink-0 text-[10px] ${active ? 'text-emerald-300' : 'text-neutral-500'}`}>{active ? 'active now' : 'connected'}</span>
                </button></li>); })}
            </ul>
          </div>
          {sel.id === 'tracker-tv' && frame?.dataUrl && <img alt="Latest captured video frame" src={frame.dataUrl} className="mt-2 h-20 rounded border border-neutral-800" />}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {LOBES.map((lobe) => (
          <div key={lobe.id} className="rounded-xl border border-neutral-800 p-3">
            <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold text-neutral-200"><span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: lobe.color }} />{lobe.label}</h3>
            <ul className="space-y-1">
              {NEURONS.filter((n) => n.lobe === lobe.id).map((n) => { const r = byId.get(n.id)!; return (
                <li key={n.id}><button type="button" onClick={() => setSelected(n.id === selected ? null : n.id)} aria-pressed={n.id === selected} data-testid={`neuron-${n.id}`}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-neutral-800/60"><span className="truncate text-neutral-200">{n.label}</span><span className={`shrink-0 rounded border px-1 text-[9px] ${STATE_STYLE[r.state]}`}>{STATE_LABEL[r.state]}</span></button></li>); })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
