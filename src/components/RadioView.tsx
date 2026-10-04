import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowDownRight, AudioLines, Headphones, Pause, Play, RefreshCw, Search, SkipBack, SkipForward, Tv, X } from 'lucide-react';
import type { Destination, NowPlayingMedia, PlayProgramCallback, RecentlyPlayedItem } from '../types';
import { AvSyncControls } from './AvSyncControls';
import { loadAjnFeeds } from '../services/ajnFeeds';
import { buildRadioCatalog, type RadioEntry, type RadioFeedItem } from '../utils/ajnRadioCatalog';
import { AJN_CHANNEL_LABELS, formatAirDate, type AjnChannel } from '../utils/ajnClassify';
import { filterEntries, formatClock, isPlayingEntry, neighbour, showChips, showInitials, showKey, showLabel, typeChips, typeKey, typeLabel, type RadioFilter, type RadioSort } from '../utils/ajnRadioBrowse';
import { usePersistentMedia } from '../hooks/usePersistentMedia';
import { useDigest } from '../hooks/useDigest';
import { DailyBriefing, NewsTicker } from './DailyBriefing';
import '../radio.css';

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const PAGE_SIZE = 24;
const CHANNELS: AjnChannel[] = ['ajn-radio', 'ajn-exclusive'];

interface Props {
  /** Plays through the one persistent player. The caller should keep the viewer on this page. */
  onPlayProgram: PlayProgramCallback;
  nowPlaying?: NowPlayingMedia | null;
  recentlyPlayed?: readonly RecentlyPlayedItem[];
  onNavigate?: (destination: Destination) => void;
}

const NO_FILTER: RadioFilter = { show: null, type: null, query: '', sort: 'newest' };

function NowPlayingPanel({ nowPlaying, playingEntry, list, onPlayEntry, onPlayProgram, onNavigate }: {
  nowPlaying: NowPlayingMedia | null; playingEntry: RadioEntry | null; list: readonly RadioEntry[]; onPlayEntry: (entry: RadioEntry) => void; onPlayProgram: PlayProgramCallback; onNavigate?: (destination: Destination) => void;
}) {
  const media = usePersistentMedia(nowPlaying?.mediaType, nowPlaying ? `${nowPlaying.src}|${nowPlaying.mediaType}` : undefined, Boolean(nowPlaying));
  const programId = nowPlaying?.programId;
  const previous = neighbour(list, programId, 1); // list is newest first: the next row down is the previous broadcast
  const next = neighbour(list, programId, -1);
  const live = Boolean(nowPlaying?.isLive);
  const percent = media.duration > 0 ? Math.min(100, (media.currentTime / media.duration) * 100) : 0;
  const pill = !nowPlaying ? { cls: 'idle', text: 'NOTHING PLAYING' }
    : live ? { cls: 'live', text: 'LIVE AUDIO' }
    : nowPlaying.mediaType === 'video' ? { cls: 'rec', text: 'RECORDED · VIDEO' }
    : { cls: 'rec', text: playingEntry ? `RECORDED · ${typeLabel(typeKey(playingEntry)).toUpperCase()}` : 'RECORDED' };
  return (
    <section className="ajr-now" aria-label="Now playing" data-testid="radio-now-playing">
      <div className="ajr-now-art" aria-hidden="true"><div className="ajr-art-sun" /><div className="ajr-art-horizon" /><span className="ajr-art-index">AJN{playingEntry ? ` — ${showInitials(playingEntry)}` : ''}</span></div>
      <div>
        <div className="ajr-label"><span className={`ajr-eq ${nowPlaying && !media.paused ? 'on' : ''}`} aria-hidden="true"><i /><i /><i /></span>NOW PLAYING</div>
        <div className="ajr-track-title" data-testid="radio-now-title">{nowPlaying ? nowPlaying.title : 'Nothing playing'}</div>
        <div className="ajr-track-sub">{nowPlaying ? (playingEntry ? `${showLabel(showKey(playingEntry))} · ${AJN_CHANNEL_LABELS[playingEntry.channel]}` : nowPlaying.subtitle ?? 'Active broadcast') : 'Press Listen on any episode below. Playback continues when you leave this page.'}</div>
        <div className="ajr-progress">
          <span data-testid="radio-elapsed">{nowPlaying ? formatClock(media.currentTime) : '0:00'}</span>
          <input className="ajr-seek" type="range" aria-label="Seek" min={0} max={media.duration > 0 ? Math.floor(media.duration) : 1} value={media.duration > 0 ? Math.floor(media.currentTime) : 0}
            disabled={!nowPlaying || live || media.duration <= 0} style={{ '--p': `${percent}%` } as CSSProperties} onChange={event => media.seek(Number(event.target.value))} />
          <span>{!nowPlaying ? '—' : live ? 'LIVE' : media.duration > 0 ? formatClock(media.duration) : '—'}</span>
        </div>
      </div>
      <div className="ajr-controls">
        <button type="button" className="ajr-skip" aria-label="Previous broadcast" disabled={!previous} onClick={() => previous && onPlayEntry(previous)}><SkipBack size={17} fill="currentColor" /></button>
        <button type="button" className="ajr-play" aria-label={media.paused ? 'Play' : 'Pause'} data-testid="radio-play-toggle" disabled={!nowPlaying || !media.attached} onClick={media.toggle}>{media.paused ? <Play size={19} fill="currentColor" /> : <Pause size={19} fill="currentColor" />}</button>
        <button type="button" className="ajr-skip" aria-label="Next broadcast" disabled={!next} onClick={() => next && onPlayEntry(next)}><SkipForward size={17} fill="currentColor" /></button>
      </div>
      <div className="ajr-now-side">
        <span className={`ajr-pill ${pill.cls}`}><i />{pill.text}</span>
        <AvSyncControls nowPlaying={nowPlaying} onPlay={onPlayProgram} onNavigate={onNavigate} variant="panel" />
        {nowPlaying && onNavigate && <button type="button" className="ajr-link" onClick={() => onNavigate('player')}>OPEN FULL PLAYER</button>}
      </div>
    </section>
  );
}

export function RadioView({ onPlayProgram, nowPlaying = null, recentlyPlayed = [], onNavigate }: Props) {
  const [items, setItems] = useState<RadioFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const [channel, setChannel] = useState<AjnChannel>('ajn-radio');
  const [filter, setFilter] = useState<RadioFilter>(NO_FILTER);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const gridRef = useRef<HTMLUListElement>(null);
  const news = useDigest();

  const load = useCallback(async () => {
    controller.current?.abort();
    const ctl = new AbortController();
    controller.current = ctl;
    setLoading(true);
    setError(null);
    try {
      const { items: feedItems, failures } = await loadAjnFeeds(ctl.signal);
      if (ctl.signal.aborted) return;
      setItems(feedItems.filter(i => i.url).map(i => ({ id: i.id, title: i.title, url: i.url!, mediaType: i.mediaType, publishedAt: i.publishedAt })));
      if (feedItems.length === 0 && failures > 0) setError('AJN feeds are currently unavailable.');
      else if (failures > 0) setError(`${failures} AJN feed${failures === 1 ? '' : 's'} unavailable; showing available episodes.`);
    } catch (err) {
      if (!ctl.signal.aborted) setError(err instanceof Error ? err.message : 'Unable to load AJN feeds');
    } finally {
      if (!ctl.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_INTERVAL_MS);
    return () => { window.clearInterval(timer); controller.current?.abort(); };
  }, [load]);

  const catalog = useMemo(() => buildRadioCatalog(items), [items]);
  const entries = channel === 'ajn-radio' ? catalog.radio : catalog.exclusive;
  const shown = useMemo(() => filterEntries(entries, filter), [entries, filter]);
  const everyEntry = useMemo(() => [...catalog.radio, ...catalog.exclusive], [catalog]);
  const playingEntry = useMemo(() => everyEntry.find(entry => isPlayingEntry(entry, nowPlaying?.programId)) ?? null, [everyEntry, nowPlaying?.programId]);
  const playingHere = playingEntry !== null && entries.includes(playingEntry);
  const progressById = useMemo(() => new Map(recentlyPlayed.map(item => [item.programId ?? item.id, item.progressSeconds])), [recentlyPlayed]);
  const liveMedia = usePersistentMedia(nowPlaying?.mediaType, nowPlaying ? `${nowPlaying.src}|${nowPlaying.mediaType}` : undefined, Boolean(nowPlaying));

  const update = (patch: Partial<RadioFilter>) => { setFilter(current => ({ ...current, ...patch })); setVisible(PAGE_SIZE); };
  const selectChannel = (next: AjnChannel) => { setChannel(next); setFilter(NO_FILTER); setVisible(PAGE_SIZE); };

  const playEntry = useCallback((entry: RadioEntry) => {
    onPlayProgram(entry.audioUrl, entry.title, AJN_CHANNEL_LABELS[entry.channel], 'audio', 'ajn-radio', 'ajn-radio', entry.id);
  }, [onPlayProgram]);
  const playVideo = (entry: RadioEntry) => {
    onPlayProgram(entry.videoUrl!, entry.title, AJN_CHANNEL_LABELS[entry.channel], 'video', 'ajn-radio', 'ajn-radio', `${entry.id}:video`);
  };

  const jumpToCurrent = () => {
    if (!playingEntry) return;
    if (!playingHere) selectChannel(playingEntry.channel);
    else setFilter(NO_FILTER);
    const list = playingHere ? entries : playingEntry.channel === 'ajn-radio' ? catalog.radio : catalog.exclusive;
    setVisible(Math.max(PAGE_SIZE, list.indexOf(playingEntry) + 1));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const card = gridRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
      if (!card) return;
      card.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
      card.focus({ preventScroll: true });
    }));
  };

  const show = showChips(entries);
  const type = typeChips(entries);
  const label = AJN_CHANNEL_LABELS[channel];
  const page = shown.slice(0, visible);

  return (
    <div className="ajr" id="ajn-radio-view">
      <header className="ajr-topbar">
        <span className="ajr-brand"><span className="ajr-brand-icon"><AudioLines size={17} /></span><span>ajn<span className="ajr-brand-light">radio</span></span><span className="ajr-brand-dot">.</span></span>
        <button type="button" className="ajr-refresh" onClick={() => void load()} disabled={loading}><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> REFRESH</button>
      </header>
      <NewsTicker news={news} />

      <section className="ajr-hero">
        <div>
          <div className="ajr-eyebrow"><i />AJN AUDIO · DAILY NEWS</div>
          <h1>A frequency<br />of <em>your own.</em></h1>
          <p className="ajr-hero-desc">Listen to the latest AJN shows and hours, and read today&apos;s news, all in one place.</p>
          <a href="#ajr-listen" className="ajr-explore" onClick={event => { event.preventDefault(); document.getElementById('ajr-listen')?.scrollIntoView({ behavior: 'smooth' }); }}>BROWSE EPISODES <ArrowDownRight size={15} /></a>
        </div>
        <div className="ajr-hero-art" aria-hidden="true"><div className="ajr-glow" /><div className="ajr-ring r1" /><div className="ajr-ring r2" /><div className="ajr-ring r3" /><div className="ajr-hero-mark">AJN<br />RADIO</div></div>
      </section>

      <NowPlayingPanel nowPlaying={nowPlaying} playingEntry={playingEntry} list={playingEntry ? (playingEntry.channel === 'ajn-radio' ? catalog.radio : catalog.exclusive) : entries} onPlayEntry={playEntry} onPlayProgram={onPlayProgram} onNavigate={onNavigate} />

      <section className="ajr-section" id="ajr-listen" aria-label="Listen back">
        <div className="ajr-heading"><div><div className="ajr-label">THE AJN AUDIO ARCHIVE</div><h2>Listen <em>back.</em></h2></div><span className="ajr-aside">RECORDED AJN SHOWS, HOURS AND SPECIALS.</span></div>
        {error && <p className="ajr-status ajr-status-error" role="alert">{error}</p>}
        {loading && items.length === 0 && !error && <p className="ajr-status" role="status">Loading AJN feeds…</p>}
        <div className="ajr-tabs" role="tablist" aria-label="AJN channels">
          {CHANNELS.map(id => <button key={id} type="button" role="tab" aria-selected={channel === id} className={`ajr-tab ${channel === id ? 'selected' : ''}`} onClick={() => selectChannel(id)}><Headphones size={14} /><span>{AJN_CHANNEL_LABELS[id]}</span><small>{(id === 'ajn-radio' ? catalog.radio : catalog.exclusive).length}</small></button>)}
        </div>
        {(show.length > 0 || type.length > 0) && (
          <div className="ajr-chips" role="group" aria-label={`Filter ${label}`}>
            <span className="ajr-label">{label.toUpperCase()}</span>
            {show.length > 0 && <button type="button" aria-pressed={!filter.show} className={`ajr-chip ${!filter.show ? 'selected' : ''}`} onClick={() => update({ show: null })}>All shows</button>}
            {show.map(chip => <button key={chip.key} type="button" aria-pressed={filter.show === chip.key} className={`ajr-chip ${filter.show === chip.key ? 'selected' : ''}`} onClick={() => update({ show: chip.key })}>{chip.label} · {chip.count}</button>)}
            {show.length > 0 && type.length > 0 && <span className="ajr-gap" />}
            {type.length > 0 && <button type="button" aria-pressed={!filter.type} className={`ajr-chip ${!filter.type ? 'selected' : ''}`} onClick={() => update({ type: null })}>All types</button>}
            {type.map(chip => <button key={chip.key} type="button" aria-pressed={filter.type === chip.key} className={`ajr-chip ${filter.type === chip.key ? 'selected' : ''}`} onClick={() => update({ type: chip.key })}>{chip.label} · {chip.count}</button>)}
          </div>
        )}
        <div className="ajr-tools">
          <label className="ajr-select"><span className="ajr-label">SORT BY</span>
            <select value={filter.sort} aria-label="Sort episodes" onChange={event => update({ sort: event.target.value as RadioSort })}>
              <option value="newest">Date · newest first</option><option value="oldest">Date · oldest first</option>
            </select>
          </label>
          {playingEntry && <button type="button" className="ajr-jump" onClick={jumpToCurrent}><Play size={11} fill="currentColor" /> JUMP TO CURRENT</button>}
        </div>
        <label className="ajr-search"><Search size={14} aria-hidden="true" /><input type="search" value={filter.query} onChange={event => update({ query: event.target.value })} placeholder="Search episodes by title" aria-label="Search episodes by title" />{filter.query && <button type="button" aria-label="Clear episode search" onClick={() => update({ query: '' })}><X size={14} /></button>}</label>
        {entries.length === 0 && !loading && <div className="ajr-empty">No {label} episodes in the current feeds.</div>}
        {entries.length > 0 && shown.length === 0 && <p className="ajr-status" role="status">No episodes match these filters.</p>}
        <ul className="ajr-grid" ref={gridRef}>
          {page.map(entry => {
            const playing = isPlayingEntry(entry, nowPlaying?.programId);
            const saved = progressById.get(entry.id) ?? progressById.get(`${entry.id}:video`) ?? 0;
            const fraction = playing && liveMedia.duration > 0 ? Math.min(1, liveMedia.currentTime / liveMedia.duration) : 0;
            return (
              <li key={entry.id} className={`ajr-card ${playing ? 'playing' : ''}`} data-testid="radio-entry">
                <button type="button" className="ajr-card-open" aria-current={playing ? 'true' : undefined} onClick={() => playEntry(entry)}>
                  <span className="ajr-cover" data-show={showKey(entry)} aria-hidden="true"><span>AJN<br />{showInitials(entry) === 'AJN' ? 'AUDIO' : showInitials(entry)}</span><Headphones size={20} /></span>
                  <span className="ajr-card-meta">
                    <span className="ajr-label">{showLabel(showKey(entry)).toUpperCase()} · {typeLabel(typeKey(entry)).toUpperCase()}</span>
                    <strong>{entry.title}</strong>
                    {entry.airDate && !entry.needsReview ? <small>Aired {formatAirDate(entry.airDate)}</small> : <small className="warn">Date not verified from filename</small>}
                    <span className="ajr-card-play"><Play size={12} fill="currentColor" /> {playing ? (liveMedia.paused ? 'PAUSED' : 'PLAYING') : 'LISTEN TO EPISODE'}{!playing && saved >= 5 && <span className="ajr-card-resume">RESUME {formatClock(saved)}</span>}</span>
                  </span>
                </button>
                {entry.videoUrl && <button type="button" className="ajr-video" aria-label={`Watch video: ${entry.title}`} onClick={() => playVideo(entry)}><Tv size={12} /> VIDEO</button>}
                {fraction > 0 && <span className="ajr-bar" role="progressbar" aria-label="Played so far" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)}><i style={{ width: `${Math.round(fraction * 100)}%` }} /></span>}
              </li>
            );
          })}
        </ul>
        {shown.length > visible && <button type="button" className="ajr-more" onClick={() => setVisible(count => count + PAGE_SIZE)}>MORE FROM {label.toUpperCase()} <ArrowDownRight size={14} /></button>}
      </section>

      <DailyBriefing news={news} />

      <footer className="ajr-footer"><span>AJN AUDIO · SHOWS FROM THE AJN FEEDS</span><span>NEWS FROM THE DAILY DIGEST</span></footer>
    </div>
  );
}
