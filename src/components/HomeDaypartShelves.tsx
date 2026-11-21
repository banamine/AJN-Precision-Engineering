// Home daypart shelves (Dusk skin only): Morning / Afternoon / Primetime / Late Night snap rows built from the real cable-tv schedule.
// The shelf matching the clock comes first. Same schedule cache and play callback as the rest of Home. Honest loading / error / empty states.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { LazyThumb } from './LazyThumb';
import { bufferGaugeMetadata } from '../utils/bufferGauge';
import { loadSchedule } from '../guide/loadSchedule';
import { tuneIn } from '../guide/liveTune';
import { ajnArtFor } from '../utils/ajnArt';
import { buildShelves, edgesOf, type Shelf, type ShelfItem } from '../home/daypartShelves';
import { fmtHour } from '../home/onAirWall';
import { useAjnSkin } from './ajn-platform-redesign/AppearanceProvider';
import type { MediaType, PlayProgramCallback, ScheduleChannel } from '../types';

const TV_GUIDE = 'cable-tv';
const hourNow = () => { const d = new Date(); return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; };
const calm = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const STATUS_LABEL = { 'on-air': 'On air', aired: 'Aired', upcoming: '' } as const;

function ShelfRow({ shelf, nowHour, onPlay }: { shelf: Shelf; nowHour: number; onPlay: (it: ShelfItem) => void }) {
  const ref = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ atStart: true, atEnd: true });
  const measure = useCallback(() => {
    const el = ref.current;
    if (el) setEdges(edgesOf(el.scrollLeft, el.clientWidth, el.scrollWidth));
  }, []);
  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure, shelf.items.length]);
  const by = (dir: number) => ref.current?.scrollBy({ left: dir * Math.max(240, (ref.current?.clientWidth ?? 600) * 0.8), behavior: calm() ? 'auto' : 'smooth' });

  return (
    <section className="ajn-shelf" aria-labelledby={`shelf-${shelf.id}`} data-testid={`daypart-shelf-${shelf.id}`} data-shelf-now={shelf.isNow ? 'true' : 'false'}>
      <header className="ajn-shelf__head">
        <h3 id={`shelf-${shelf.id}`} className="ajn-shelf__title">{shelf.label}</h3>
        {shelf.isNow && <span className="ajn-shelf__now">Now</span>}
        <span className="ajn-shelf__range">{shelf.range}</span>
        <span className="ajn-shelf__arrows">
          <button type="button" aria-label={`Scroll ${shelf.label} back`} disabled={edges.atStart} onClick={() => by(-1)} data-testid={`shelf-prev-${shelf.id}`}><ChevronLeft size={18} aria-hidden="true" /></button>
          <button type="button" aria-label={`Scroll ${shelf.label} forward`} disabled={edges.atEnd} onClick={() => by(1)} data-testid={`shelf-next-${shelf.id}`}><ChevronRight size={18} aria-hidden="true" /></button>
        </span>
      </header>
      {shelf.items.length === 0 ? (
        <p className="ajn-shelf__empty" data-testid={`shelf-empty-${shelf.id}`}>Nothing scheduled in this window.</p>
      ) : (
        <ul ref={ref} className="ajn-shelf__row" aria-label={`${shelf.label} programmes`} onScroll={measure}>
          {shelf.items.map((it) => (
            <li key={it.key} className="ajn-shelf__cell">
              <button type="button" className="ajn-shelf__card" onClick={() => onPlay(it)} data-status={it.status} aria-label={`Play ${it.program.title} on ${it.channel.name}, ${it.status === 'on-air' ? 'on air now' : fmtHour(it.sHour)}`}>
                <span className="ajn-shelf__thumb">
                  <LazyThumb className="h-full w-full" title={it.program.title} input={{
                    path: it.program.archivePath ?? it.program.mediaUrl ?? null, guideId: it.channel.guideId, channelId: it.channel.id, category: it.channel.group ?? null, mediaType: it.channel.mediaType, name: it.channel.name,
                    placeholder: ajnArtFor({ show: `${it.channel.name} ${it.channel.group ?? ''}`, mediaType: it.channel.mediaType, onlyAjn: true }),
                  }} />
                  <span className="ajn-shelf__time">{it.status === 'on-air' ? STATUS_LABEL['on-air'] : `${STATUS_LABEL[it.status] ? `${STATUS_LABEL[it.status]} ` : ''}${fmtHour(it.sHour)}`}</span>
                </span>
                <span className="ajn-shelf__show">{it.program.title}</span>
                <span className="ajn-shelf__channel">{it.channel.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function HomeDaypartShelves({ onPlayProgram }: { onPlayProgram: PlayProgramCallback }) {
  const skin = useAjnSkin();
  const active = skin === 'dusk';
  const [channels, setChannels] = useState<readonly ScheduleChannel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [nowHour, setNowHour] = useState(hourNow);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    setError(null);
    loadSchedule(TV_GUIDE).then((c) => { if (alive) setChannels(c); }).catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'schedule unavailable'); });
    return () => { alive = false; };
  }, [attempt, active]);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNowHour(hourNow()), 60_000);
    return () => window.clearInterval(id);
  }, [active]);
  const shelves = useMemo(() => (channels ? buildShelves(channels, nowHour) : []), [channels, nowHour]);
  if (!active) return null;

  const play = (it: ShelfItem) => {
    const p = it.program;
    const mt: MediaType = p.mediaType || it.channel.mediaType || 'video';
    const sourceId = p.sourceId ?? p.metadata?.sourceId, assetId = p.assetId ?? p.metadata?.assetId;
    if (it.status === 'on-air') {
      const t = tuneIn(p, it.sHour, it.eHour, nowHour);
      onPlayProgram(t.path, p.title, it.channel.name, mt, it.channel.id, p.guideId ?? it.channel.guideId, p.id, sourceId, assetId, t.startAtSeconds, bufferGaugeMetadata(p.metadata));
      return;
    }
    onPlayProgram(p.archivePath || p.mediaUrl, p.title, it.channel.name, mt, it.channel.id, p.guideId ?? it.channel.guideId, p.id, sourceId, assetId, undefined, bufferGaugeMetadata(p.metadata));
  };

  return (
    <section aria-labelledby="dayparts-heading" className="ajn-shelves" data-testid="home-daypart-shelves">
      <h2 id="dayparts-heading" className="ajn-wall__title">Around the clock</h2>
      {error && !channels ? (
        <div role="alert" className="ajn-wall__note" data-testid="shelves-error">
          Could not load the schedule ({error}).
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className="ck-key ck-key--sm ml-3 px-2">Try again</button>
        </div>
      ) : !channels ? (
        <div className="ajn-wall__card ajn-wall__card--skeleton animate-pulse" aria-label="Loading the schedule" data-testid="shelves-loading" />
      ) : (
        shelves.map((s) => <ShelfRow key={s.id} shelf={s} nowHour={nowHour} onPlay={play} />)
      )}
    </section>
  );
}
