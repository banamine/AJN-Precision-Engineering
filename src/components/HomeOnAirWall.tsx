// Home "Tonight on AJN" wall: four poster cards for what the 24/7 schedule has on air now. Shown only in the Dusk Marquee skin.
// Same schedule cache, tune-in and play callback as HomeLiveStrip. Nothing autoplays; a click plays. Failures say so and offer Try again.
import { useEffect, useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import { LazyThumb } from './LazyThumb';
import { bufferGaugeMetadata } from '../utils/bufferGauge';
import { loadSchedule } from '../guide/loadSchedule';
import { buildLiveRows } from '../guide/liveStrip';
import { tuneIn } from '../guide/liveTune';
import { ajnArtFor } from '../utils/ajnArt';
import { fmtHour, pickWall, type WallItem } from '../home/onAirWall';
import { useAjnSkin } from './ajn-platform-redesign/AppearanceProvider';
import type { MediaType, PlayProgramCallback, ScheduleChannel } from '../types';

const TV_GUIDE = 'cable-tv';
const hourNow = () => { const d = new Date(); return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; };

export function HomeOnAirWall({ onPlayProgram }: { onPlayProgram: PlayProgramCallback }) {
  const skin = useAjnSkin();
  const [channels, setChannels] = useState<readonly ScheduleChannel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [nowHour, setNowHour] = useState(hourNow);
  const active = skin === 'dusk';

  useEffect(() => {
    if (!active) return;
    let alive = true;
    setError(null);
    loadSchedule(TV_GUIDE).then((c) => { if (alive) setChannels(c); }).catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'schedule unavailable'); });
    return () => { alive = false; };
  }, [attempt, active]);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNowHour(hourNow()), 30_000);
    return () => window.clearInterval(id);
  }, [active]);

  const items = useMemo<WallItem[]>(() => (channels ? pickWall(buildLiveRows([{ guideId: TV_GUIDE, channels }], nowHour), nowHour) : []), [channels, nowHour]);
  if (!active) return null;

  const play = (it: WallItem) => {
    const r = it.row, p = r.program;
    if (!p) return;
    const t = tuneIn(p, r.sHour, r.eHour, nowHour);
    const mt: MediaType = p.mediaType || r.channel.mediaType || 'video';
    onPlayProgram(t.path, p.title, r.channel.name, mt, r.channel.id, p.guideId ?? r.guideId, p.id, p.sourceId ?? p.metadata?.sourceId, p.assetId ?? p.metadata?.assetId, t.startAtSeconds, bufferGaugeMetadata(p.metadata));
  };

  return (
    <section aria-labelledby="on-air-wall-heading" className="ajn-wall" data-testid="home-on-air-wall">
      <h2 id="on-air-wall-heading" className="ajn-wall__title">Tonight on AJN</h2>
      {error && !channels ? (
        <div role="alert" className="ajn-wall__note" data-testid="on-air-wall-error">
          Could not load what is on air ({error}).
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className="ck-key ck-key--sm ml-3 px-2">Try again</button>
        </div>
      ) : !channels ? (
        <div className="ajn-wall__grid" aria-label="Loading what is on air" data-testid="on-air-wall-loading">
          {Array.from({ length: 4 }, (_, i) => <div key={i} className="ajn-wall__card ajn-wall__card--skeleton animate-pulse" aria-hidden="true" />)}
        </div>
      ) : items.length === 0 ? (
        <p className="ajn-wall__note" data-testid="on-air-wall-empty">Nothing is on air right now.</p>
      ) : (
        <ul className="ajn-wall__grid" data-testid="on-air-wall-grid">
          {items.map((it) => {
            const r = it.row, p = r.program!;
            return (
              <li key={r.key} className="ajn-wall__item">
                <button type="button" onClick={() => play(it)} aria-label={`Play ${p.title} on ${r.channel.name}`} className="ajn-wall__card" data-testid="on-air-wall-card">
                  <span className="ajn-wall__poster">
                    <LazyThumb className="h-full w-full" title={p.title} input={{
                      path: p.archivePath ?? p.mediaUrl ?? null, guideId: r.guideId, channelId: r.channel.id, category: r.channel.group ?? null, mediaType: r.channel.mediaType, name: r.channel.name,
                      placeholder: ajnArtFor({ show: `${r.channel.name} ${r.channel.group ?? ''}`, mediaType: r.channel.mediaType, onlyAjn: true }),
                    }} />
                    <span className="ajn-wall__chip"><span aria-hidden="true" className="ajn-wall__dot" />On air</span>
                    <span className="ajn-wall__play" aria-hidden="true"><Play className="h-5 w-5" /></span>
                  </span>
                  <span className="ajn-wall__meta">
                    <span className="ajn-wall__channel">{r.channel.name}</span>
                    <span className="ajn-wall__show">{p.title}</span>
                    <span className="ajn-wall__bar" role="progressbar" aria-label="Programme progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(it.progress * 100)}>
                      <span style={{ width: `${Math.round(it.progress * 100)}%` }} />
                    </span>
                    <span className="ajn-wall__next">{it.next ? `Next ${fmtHour(it.next.sHour)} · ${it.next.title}` : 'Nothing scheduled next'}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
