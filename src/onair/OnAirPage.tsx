/* AJN On Air: the daily run of show (podcast, then live radio, then podcast) as a 16:9 broadcast frame.
 * Audio first. One foreground audio source at a time; the engine (engine.js) decides, this page shows and does what it says.
 * ?clean=1 hides the app chrome for OBS; &cam=BR|BL|TR|TL reserves a 25% x 25% camera corner. &debug=1 shows the engine state and log.
 * Everything on screen is real data or an explicit "unavailable" note; nothing is invented. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AJN_PLAYOUT as E } from './engine.js';
import { DEFAULT_PARAMS, LIVE_STATIONS, STATION_LOGO, buildRunOfShowFromEdition, segmentIndexAt, type Segment } from './runOfShow';
import { useOnAirPlayout } from './useOnAirPlayout';
import OnAirSpectrum from './OnAirSpectrum';
import ArchiveOnThisDay from './ArchiveOnThisDay';
import PanelCarousel from './PanelCarousel';
import DeckPicture from './DeckPicture';
import { loadLibraryAlbums, type LibAlbum } from './libraryTracks';
import { useOnAirData } from './useOnAirData';
import { useOnAirFiller, poolSize } from './useOnAirFiller';
import { DEFAULT_BACKFILL } from './backfill';
import { denverDateKey, denverMidnight } from '../utils/dailyEdition';
import { useDailyEdition } from '../hooks/useDailyEdition';
import { useLiveRadioNowPlaying } from '../hooks/useLiveRadioNowPlaying';
import { ShowArt } from '../components/ShowArt';
import './onair.css';

const PANEL_CATALOG = ['Headlines', 'Digest', 'Weather', 'Last songs', 'On this day', 'Live now', 'Homepage reel', 'Missed shows', 'Around the clock', 'Station ID card', 'Clock card', 'Show card'];
const params = DEFAULT_PARAMS;
type Rect = { x: number; y: number; w: number; h: number };
const pct = (r: Rect, axis: 'x' | 'y' | 'w' | 'h'): string => `${(r[axis] / (axis === 'x' || axis === 'w' ? 1920 : 1080)) * 100}%`;
const boxStyle = (r: Rect): React.CSSProperties => ({ left: pct(r, 'x'), top: pct(r, 'y'), width: pct(r, 'w'), height: pct(r, 'h') });
const fitClass = (t: string): string => (t.length <= 22 ? 'fit-1' : t.length <= 38 ? 'fit-2' : 'fit-3');
const hms = (ms: number): string => E.formatDenverHMS(ms) as string;
const mmss = (s: number): string => E.formatMMSS(s) as string;

function readQuery(): { clean: boolean; cam: string; debug: boolean } {
  const search = typeof window === 'undefined' ? '' : window.location.search;
  const hashQ = typeof window === 'undefined' ? '' : (window.location.hash.split('?')[1] ?? '');
  const a = E.parseClean(search) as { clean: boolean; cam: string }, b = E.parseClean(hashQ) as { clean: boolean; cam: string };
  const dbg = new URLSearchParams(search || `?${hashQ}`).get('debug') === '1' || new URLSearchParams(hashQ).get('debug') === '1';
  return { clean: a.clean || b.clean, cam: a.cam !== 'Off' ? a.cam : b.cam, debug: dbg };
}

export default function OnAirPage({ stopExistingPlayback }: { stopExistingPlayback?: () => void }) {
  const initial = useMemo(readQuery, []);
  const [clean, setClean] = useState(initial.clean);
  const [cam, setCam] = useState(initial.cam);
  const [revealExit, setRevealExit] = useState(false);
  const [albums, setAlbums] = useState<LibAlbum[] | null>(null);
  const [albumsFailed, setAlbumsFailed] = useState(false);
  const revealTimer = useRef<number | null>(null);
  const lastPanels = useRef<Array<string | null>>([null, null, null, null]);

  const edition = useDailyEdition(true);
  const ed = edition.edition;
  const filler = useOnAirFiller(true);
  const rosKey = `${ed?.editionId ?? 'none'}|${filler.pool?.builtAt ?? 'none'}`;
  // The day is planned from today's fresh podcasts (if any) plus real backfill clips. Without the pool: the old edition-only list.
  const built = useMemo<{ ros: Segment[]; edId: string | null }>(() => {
    const H = 48 * 3600 * 1000;
    if (ed) return { ros: buildRunOfShowFromEdition(ed, params, ed.startMs, ed.startMs + H, 1, filler.pool), edId: ed.editionId };
    if (poolSize(filler.pool) > 0) { const t = Date.now(); const start = denverMidnight(t, 0); return { ros: buildRunOfShowFromEdition(null, params, start, start + H, 1, filler.pool, DEFAULT_BACKFILL, denverDateKey(t)), edId: null }; }
    return { ros: [], edId: null };
  }, [rosKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const ros = built.ros;

  useEffect(() => {
    const ctl = new AbortController();
    loadLibraryAlbums(ctl.signal).then((a) => { setAlbums(a); setAlbumsFailed(a.length === 0); }).catch((e) => { if ((e as Error).name !== 'AbortError') setAlbumsFailed(true); });
    return () => ctl.abort();
  }, []);

  const playout = useOnAirPlayout({ ros, albums, albumsFailed, onStart: stopExistingPlayback });
  const { machine, nowMs } = playout;
  const data = useOnAirData(ed, nowMs, params.headlineMaxAgeHours);

  // A newer edition while on air: append it after the music block that is playing; the current episode always finishes untouched.
  const adopted = useRef<string | null>(null);
  const pendingEd = useRef<typeof ed>(null);
  useEffect(() => {
    if (!ed) return;
    const base = adopted.current ?? built.edId;      // the edition the on-air list was built from (null when it started on backfill alone)
    if (base !== ed.editionId) pendingEd.current = ed;
  }, [ed, built.edId]);
  useEffect(() => {
    const id = window.setInterval(() => {
      const p = pendingEd.current; if (!p || !playout.started) return;
      const done = playout.replaceFromNextBlock((after) => buildRunOfShowFromEdition(p, params, after, after + 48 * 3600 * 1000, 1000 + Date.now() % 100000, filler.pool));
      if (done) { adopted.current = p.editionId; pendingEd.current = null; }
    }, 1000);
    return () => window.clearInterval(id);
  }, [playout, filler.pool]);

  // Active live station: its own song feed drives the "now playing" text and the music block's exit on a song change.
  const seg = machine?.activeSegment ?? null;
  const effSrc = machine ? (machine.blockSourceOverride ?? machine.musicSource) : params.musicSource;
  const liveStationId = seg && seg.type === 'music' && effSrc === 'Live 109' ? (LIVE_STATIONS[seg.musicStation ?? '']?.id ?? null) : null;
  const np = useLiveRadioNowPlaying(liveStationId);
  const songKey = np.current ? `${np.current.artist}|${np.current.title}` : '';
  const prevSong = useRef('');
  useEffect(() => {
    if (!liveStationId) { prevSong.current = ''; return; }
    if (songKey && prevSong.current && songKey !== prevSong.current) playout.notifySongChange();
    if (songKey) prevSong.current = songKey;
  }, [songKey, liveStationId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (liveStationId && np.state === 'stale') playout.notifyFeedStale(); }, [np.state, liveStationId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clean view: Esc or a double-click leaves it. The exit button shows for 5 s on entry and again whenever the pointer, a touch or a key is used.
  useEffect(() => {
    if (!clean) return undefined;
    const show = (ms: number): void => { setRevealExit(true); if (revealTimer.current) window.clearTimeout(revealTimer.current); revealTimer.current = window.setTimeout(() => setRevealExit(false), ms); };
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setClean(false); else show(3000); };
    const onMove = (): void => show(3000);
    const onDbl = (): void => setClean(false);
    show(5000);
    document.addEventListener('keydown', onKey); document.addEventListener('pointermove', onMove); document.addEventListener('pointerdown', onMove); document.addEventListener('touchstart', onMove); document.addEventListener('dblclick', onDbl);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerdown', onMove); document.removeEventListener('touchstart', onMove); document.removeEventListener('dblclick', onDbl); if (revealTimer.current) window.clearTimeout(revealTimer.current); };
  }, [clean]);

  const idx = ros.length ? (machine && machine.state !== 'IDLE' ? Math.max(0, playout.ros.findIndex((s) => s.id === machine.segmentId)) : segmentIndexAt(playout.ros, nowMs)) : -1;
  const list = playout.ros;
  const cur = seg ?? (idx >= 0 ? list[idx] : null);
  const next = idx >= 0 ? (list[idx + 1] ?? list[0]) : null;
  const later = idx >= 0 ? (list[idx + 2] ?? list[0]) : null;
  const onAir = !!machine && machine.state !== 'IDLE';
  const dp = E.daypartOf(nowMs) as string;
  const fresh = data.headlines;
  const tickerVisible = fresh.length > 0;
  const lay0 = E.layoutFor(cam, 1920, 1080, tickerVisible) as { header: Rect; stage: Rect; panels: Rect[]; lowerThird: Rect; ticker: Rect; cam: Rect | null };
  // Wider side panels (about 38% of the width): the stage gives up the room the Recently Played list no longer needs. Only when the panels sit to the right of the stage.
  const lay = (() => {
    const px = Math.min(...lay0.panels.map((r) => r.x));
    if (px <= lay0.stage.x) return lay0;
    const grow = Math.max(0, Math.min(150, Math.round(1920 * 0.38) - (1920 - px)));
    if (!grow) return lay0;
    return { ...lay0, stage: { ...lay0.stage, w: lay0.stage.w - grow }, panels: lay0.panels.map((r) => ({ ...r, x: r.x - grow, w: r.w + grow })) };
  })();

  // Music block display: live song from the station's feed; library track from the block's real track list.
  const libTrack = playout.blockTrack;
  const recent = np.recent.slice(0, 5);
  const lastSongs: string[] = effSrc === 'Live 109' ? recent.map((r, i) => `${i + 1}. ${r.artist ? `${r.artist} – ` : ''}${r.title}`) : [];
  const availability: Record<string, boolean> = {
    Headlines: fresh.length > 0, Digest: data.digestLines.length > 0, Weather: data.weatherLines !== null, 'Last songs': lastSongs.length > 0,
    'On this day': data.onThisDay !== null || data.archiveItems.length > 0, 'Live now': true, 'Homepage reel': false, 'Missed shows': data.missedLines.length > 0,
    'Around the clock': true, 'Station ID card': true, 'Clock card': true,
  };
  const panelTypes = cur ? (E.pickPanels({ dwellSec: params.panelDwellSec, libraryUnreachable: !!machine?.libraryUnreachable }, PANEL_CATALOG, availability, dp, cur.type, nowMs) as string[]) : [];

  const upcomingPodcasts = (): string[] => {
    const out: string[] = [];
    // Music blocks end early/late; shift planned times by the real exit drift so this panel agrees with the stage ticket.
    const drift = cur && cur.type === 'music' && machine?.musicExitMs ? machine.musicExitMs - cur.endMs : 0;
    let prev = cur && cur.type === 'podcast' ? cur.name : '';
    for (let i = idx + 1; i < list.length && out.length < 3; i++) if (list[i].type === 'podcast' && list[i].name !== prev) { prev = list[i].name; out.push(`~${hms(list[i].startMs + drift).slice(0, 5)}  ${list[i].name}${list[i].filler ? ' · filler' : ''}`); }
    return out;
  };
  const panelLines = (type: string): string[] => {
    if (!cur) return [type];
    if (type === 'Show card') return [cur.showName, [cur.networkTag, cur.publishedDate].filter(Boolean).join(' · ') || 'On Air', cur.episodeTitle ?? 'On Air'];
    if (type === 'Headlines') return fresh.slice(0, 8).map((h) => `${h.text} (${E.relativeAge(h.publishedMs, nowMs)})`);
    if (type === 'Digest') return data.digestLines;
    if (type === 'Weather') return data.weatherLines ?? ['Weather unavailable'];
    if (type === 'Last songs') return lastSongs.slice(0, 3);
    if (type === 'On this day') return data.onThisDay ? [`On this day · ${data.onThisDay.date}`, data.onThisDay.title, 'Library recording'] : [];
    if (type === 'Live now') return ['AJN Radio · Live 109', 'Classic Rock 109 · Classic Hits 109', cur.type === 'music' && effSrc === 'Live 109' ? `On air: ${cur.musicStation}` : 'Between podcasts'];
    if (type === 'Missed shows') return data.missedLines;
    if (type === 'Around the clock') return upcomingPodcasts();
    if (type === 'Station ID card') return ['AJN Precision Engineering', `${dp} broadcast · Audio only`, 'Denver local time'];
    if (type === 'Clock card') return [`Denver local time: ${hms(nowMs)}`, `Daypart: ${dp}`, new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(nowMs))];
    return [type];
  };
  const panelTag = (t: string): string => ({ 'Show card': 'SHOW META', 'On this day': 'LIBRARY', Weather: 'WEATHER', 'Live now': 'LIVE 109', 'Last songs': 'MUSIC LOG', Headlines: 'NEWS', Digest: 'DIGEST', 'Missed shows': 'YESTERDAY', 'Around the clock': 'SCHEDULE' } as Record<string, string>)[t] ?? 'AJN';

  // Banners (all truthful engine state).
  const banners: string[] = [];
  if (machine?.standbyNotReadyBanner) banners.push('STANDBY NOT READY');
  if (machine && (machine.skipLoadStarted || machine.fadeKind === 'music-skipped' || (machine.musicUnavailableUntilMs !== null && nowMs < machine.musicUnavailableUntilMs))) banners.push('MUSIC UNAVAILABLE - block skipped');
  if (pendingEd.current) banners.push("New edition ready: starts after this music block");

  const slate = !!machine?.slateOverlayUntilMs && nowMs < machine.slateOverlayUntilMs;

  const renderStage = (): React.ReactNode => {
    if (!cur) {
      const msg = edition.status === 'error' ? `Today's podcasts could not be loaded${edition.error ? ` (${edition.error})` : ''}.` : edition.status === 'degraded' ? "Today's podcasts are only partly available right now." : "Today's podcasts are being prepared…";
      return <div className="stage-main"><div className="stage-hero-center"><div className="meta-col"><div className="show-title fit-2">On Air</div><div className="episode-title">{msg}</div></div></div></div>;
    }
    if (cur.type === 'podcast') {
      const elapsed = Math.max(0, Math.min(cur.durationMs / 1000, (nowMs - cur.startMs) / 1000));
      const rem = Math.max(0, cur.durationMs / 1000 - elapsed);
      const p = cur.durationMs > 0 ? (elapsed / (cur.durationMs / 1000)) * 100 : 0;
      const ups = upcomingPodcasts();
      return (<>
        <div className="stage-main">
          <div className="stage-hero-center"><div className="cover-row">
            <div className="cover-box"><DeckPicture getEl={playout.activeVideo} fallback={<ShowArt label={cur.showName} mediaType="audio" src={cur.artUrl} className="h-full w-full" />} /></div>
            <div className="meta-col">
              <div className={`show-title ${fitClass(cur.showName)}`}>{cur.showName}</div>
              <div className="episode-title">{cur.episodeTitle}</div>
              <div className="btn-row">
                {cur.filler && cur.tag && <span className="chip" data-testid="on-air-filler-tag">{cur.tag}</span>}
                {cur.filler && cur.clipDate && <span className="chip">Recorded {cur.clipDate}</span>}
                {cur.networkTag && <span className={cur.networkTag === "REAL AMERICA'S VOICE" ? 'chip net-rav' : cur.networkTag === 'AJN NETWORK' ? 'chip net-ajn' : 'chip'}>{cur.networkTag}</span>}
                {cur.publishedDate && <span className="chip">Published {cur.publishedDate}</span>}
              </div>
              <div className="meta-subline">Segment {cur.index} of {list.length}</div>
            </div>
          </div></div>
          <div className="stage-bottom">
            <div className="progress-wrap">
              <div className="progress-track"><div className={onAir ? 'progress-fill on-air-bar' : 'progress-fill'} style={{ width: `${p.toFixed(1)}%` }} /></div>
              <div className="progress-times"><span>Elapsed {mmss(elapsed)}</span><span>Remaining -{mmss(rem)}</span></div>
            </div>
            {next && <div className={machine?.state === 'CROSSFADING' ? 'plays-next-ticket blending-ticket' : 'plays-next-ticket'}><span>Plays next: {next.name}</span><span className="ticket-time">{hms(next.startMs)}</span></div>}
          </div>
        </div>
        <div className="stage-side">
          <div className="side-heading"><span>Coming up</span></div>
          <div className="transcript-lines">{ups.length ? ups.map((u) => <div key={u} className="transcript-line single"><span>{u}</span></div>) : <div className="transcript-line single"><span>Nothing scheduled after this</span></div>}</div>
        </div>
      </>);
    }
    // Music block
    const exitMs = machine?.musicExitMs ?? cur.endMs;
    const elapsedMs = Math.max(0, nowMs - cur.startMs);
    const blockDur = Math.max(1, (exitMs - cur.startMs) / 1000);
    const el = Math.max(0, Math.min(blockDur, elapsedMs / 1000)), rem = Math.max(0, blockDur - el);
    const musics = list.filter((x) => x.type === 'music');
    const blockNum = Math.max(1, musics.findIndex((x) => x.id === cur.id) + 1);
    const live = effSrc === 'Live 109';
    // Live music leaves at the first song change after 5:30; until one is seen the exit time is only the latest possible one, so say "by".
    const exitBy = live && (machine?.musicExitReason ?? '') === 'hard_timer_max';
    const title = live ? (np.current?.title ?? (np.state === 'none' ? 'No song right now' : cur.musicStation ?? 'Live 109')) : (libTrack?.title ?? 'Library music');
    const artist = live ? (np.current?.artist ?? (np.state === 'none' ? 'Talk, news or ad break' : 'Live 109')) : (libTrack?.artist || 'Library');
    return (<>
      <div className="stage-main">
        <div className="stage-hero-center"><div className="hero-stack"><div className="cover-row">
          <div className="cover-box"><DeckPicture getEl={playout.activeVideo} fallback={<>{live && np.current?.artUrl ? <img key={np.current.artUrl} src={np.current.artUrl} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" /> : <ShowArt label={live ? (cur.musicStation ?? '109') : 'Library'} mediaType="audio" src={live ? STATION_LOGO : undefined} className="h-full w-full" />}</>} /></div>
          <div className="meta-col">
            <div className={`show-title ${fitClass(title)}`}>{title}</div>
            <div className="episode-title">{artist}</div>
            <div className="btn-row"><span className="chip">{live ? cur.musicStation : 'Library'}</span><span className="chip">Exit {exitBy ? 'by ' : ''}{hms(exitMs)}</span><span className="chip">Block {blockNum} of {musics.length}</span></div>
            <div className="meta-subline">Segment {cur.index} of {list.length}</div>
          </div>
        </div>
        <OnAirSpectrum analyser={playout.analyser} state={playout.meterState} playing={onAir && machine?.state !== 'FAILOVER'} />
        </div></div>
        <div className="stage-bottom">
          <div className="progress-wrap">
            <div className="progress-track"><div className={onAir ? 'progress-fill on-air-bar' : 'progress-fill'} style={{ width: `${((el / blockDur) * 100).toFixed(1)}%` }} /></div>
            <div className="progress-times"><span>Elapsed {mmss(el)}</span><span>Exit -{mmss(rem)}</span></div>
          </div>
          {next && <div className={machine?.state === 'CROSSFADING' ? 'plays-next-ticket blending-ticket' : 'plays-next-ticket'}><span>Plays next: {next.name}</span><span className="ticket-time">{exitBy ? 'by ' : ''}{hms(exitMs)}</span></div>}
        </div>
      </div>
      <div className="stage-side">
        <div className="side-heading"><span>{live ? 'Recently Played' : 'This block'}</span></div>
        <div className="transcript-lines">
          {live
            ? (recent.length ? recent.map((r, i) => <div key={`${r.artist}|${r.title}|${i}`} className={r.artUrl ? 'transcript-line two-line has-art' : 'transcript-line two-line'}>{r.artUrl && <img className="row-art" src={r.artUrl} alt="" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}<div className="row-text"><span>{r.title}</span><span className="sub">{r.artist}</span></div></div>) : <div className="transcript-line single"><span>Song list unavailable</span></div>)
            : (playout.blockTracks.length ? playout.blockTracks.slice(0, 5).map((t, i) => <div key={`${t.src}|${i}`} className="transcript-line two-line"><span>{t.title}</span><span className="sub">{t.artist || t.album}</span></div>) : <div className="transcript-line single"><span>Library tracks unavailable</span></div>)}
        </div>
      </div>
    </>);
  };

  const tickerText = fresh.map((h) => `${h.text} [${E.relativeAge(h.publishedMs, nowMs)}]`).join('   •   ');
  const tickerSecs = Math.max(30, Math.round(tickerText.length * 0.18));
  const gateVisible = !onAir;
  const canStart = list.length > 0;
  // No playable edition (server still building after a restart): keep asking every 10 s so nobody is stranded on the start screen.
  useEffect(() => {
    if (canStart || edition.status === 'loading') return undefined;
    const id = window.setInterval(() => edition.refresh(), 10_000);
    return () => window.clearInterval(id);
  }, [canStart, edition.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const gateReason = edition.status === 'error' ? `Today's podcasts could not be loaded${edition.error ? ` (${edition.error})` : ''}.`
    : edition.status === 'degraded' ? `The server has no playable podcast edition yet (status: degraded${ed ? ', edition has no episodes' : ', no edition returned'}). It builds a new one each Denver day after its feeds refresh.`
    : edition.status === 'building' ? "The server is still building today's podcast edition."
    : edition.status === 'ok' ? "The server returned an edition with no playable episodes."
    : "Loading today's podcasts…";
  const gateFiller = filler.status === 'error' ? ` Backfill clips could not be loaded (${filler.error ?? 'unknown'}).` : '';

  const view = (
    <div className={`onair-root${clean ? ' clean-view' : ''}${clean && !revealExit ? ' hide-cursor' : ''}`} data-testid="on-air-page">
      {clean && <button type="button" className={`clean-exit-btn${revealExit ? ' reveal' : ''}`} onClick={() => setClean(false)}>Exit Clean View (Esc)</button>}
      {!clean && (
        <div className="onair-bar">
          <button type="button" onClick={() => setClean(true)}>Clean view</button>
          <label>Camera corner <select value={cam} onChange={(e) => setCam(e.target.value)}>{['Off', 'BR', 'BL', 'TR', 'TL'].map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
          {edition.notice && <span>{edition.notice.count} new episode{edition.notice.count === 1 ? '' : 's'} published</span>}
        </div>
      )}
      {!clean && edition.status === 'error' && !ed && <div className="onair-note" role="alert">Today's podcasts could not be loaded{edition.error ? `: ${edition.error}` : ''}. Nothing will play until they load.</div>}
      {!clean && albumsFailed && <div className="onair-note" role="status">Library music could not be loaded, so there is no backup if the live station fails.</div>}
      <div className="screen-shell">
        <div className="screen-frame" data-daypart={dp}>
          <div className="frame-box frame-header" style={boxStyle(lay.header)}>
            <div className="hdr-left"><span className={onAir ? 'on-air-dot live' : 'on-air-dot'} /><span className="hdr-brand">AJN ON AIR</span></div>
            <div className="hdr-center"><span className="hdr-clock-display">{hms(nowMs)} MT</span><span className="chip">{dp}</span></div>
            <div className="hdr-right">{cur && <span className="chip">Segment {cur.index} of {list.length}</span>}<span className="chip">{machine?.blockSourceOverride ? `${machine.musicSource} -> ${machine.blockSourceOverride} (failover)` : (machine?.musicSource ?? params.musicSource)}</span></div>
          </div>
          <div className="frame-box frame-stage" style={boxStyle(lay.stage)}>
            <div className="stage-top-row">
              <div className="btn-row"><span className={onAir ? 'chip on-air-chip' : 'chip'}>{onAir && cur ? cur.type.toUpperCase() : 'IDLE'}</span>{cur && cur.editionTag && cur.editionTag !== 'TODAY' && <span className="chip">{cur.editionTag}</span>}</div>
              <div className="blend-overlay">
                {machine?.blockSourceOverride && <span className="chip">{machine.musicSource} -&gt; {machine.blockSourceOverride} (failover)</span>}
                {machine?.state === 'CROSSFADING' && <><span className="chip on-air-chip">BLENDING</span>{next && <span className="chip">Next: {next.name}</span>}</>}
              </div>
            </div>
            <div className={banners.length ? 'stage-banner visible' : 'stage-banner'} role="status">{banners.join(' | ')}</div>
            <div className="stage-body">
              {renderStage()}
              {slate && <div className="slate-overlay"><div className="slate-kicker">INTERMISSION · STATION ID</div><div className="slate-title">AJN — {dp}</div><span className="chip rose-chip">VISUAL ONLY · NO AUDIO</span></div>}
            </div>
          </div>
          {[0, 1, 2, 3].map((pi) => {
            const type = panelTypes[pi];
            const changed = lastPanels.current[pi] !== null && lastPanels.current[pi] !== type;
            lastPanels.current[pi] = type ?? null;
            if (!type || !cur) return <div key={pi} className="frame-box frame-panel" style={boxStyle(lay.panels[pi])} />;
            const compact = lay.panels[pi].h < 200;
            const lines = panelLines(type);
            const slot = 'ABCD'[pi];
            const lockedA = pi === 0 && cur.type === 'podcast' && type === 'Show card';
            return (
              <div key={`${pi}-${type}`} className={changed ? 'frame-box frame-panel panel-fade' : 'frame-box frame-panel'} style={boxStyle(lay.panels[pi])}>
                <div className="panel-hdr"><span className="panel-title">P-{slot} · {type === 'On this day' && data.archiveItems.length > 0 ? 'From the Archive · On This Day' : type}</span><span className="panel-countdown">{lockedA ? 'LOCKED' : `changes in ${E.panelChangesInSec(pi, nowMs, params.panelDwellSec)} s`}</span></div>
                <div className="panel-body">
                  {type === 'On this day' && data.archiveItems.length > 0
                    ? <div className="panel-lines arch-lines"><ArchiveOnThisDay items={data.archiveItems} rush={data.onThisDay} nowMs={nowMs} compact={compact} /></div>
                    : (type === 'Headlines' || type === 'Digest')
                      ? <div className="panel-lines pc-lines"><PanelCarousel items={lines.map((l) => l.replace(/^[•\s]+/, ''))} nowMs={nowMs} /></div>
                      : <div className="panel-lines">{(compact && type === 'Show card' ? [lines[0], lines[2] ?? lines[1]] : lines.slice(0, compact ? 2 : lines.length)).map((l, i) => <div key={i} className="panel-line-item">{l}</div>)}</div>}
                  {!compact && <div className="panel-tags"><span className="role-tag">{type === 'On this day' && data.archiveItems.length > 0 ? 'ARCHIVE' : panelTag(type)}</span></div>}
                </div>
              </div>
            );
          })}
          <div className="frame-box frame-lower-third" style={boxStyle(lay.lowerThird)}>
            <div className="lt-pills">
              <span className="lt-pill lt-now"><strong>NOW</strong><span>{cur?.name ?? '—'}</span></span>
              <span className="lt-pill"><strong>NEXT</strong><span>{next?.name ?? '—'}</span></span>
              <span className="lt-pill"><strong>LATER</strong><span>{later?.name ?? '—'}</span></span>
            </div>
          </div>
          {tickerVisible && (
            <div className="frame-box frame-ticker" style={boxStyle(lay.ticker)}>
              <span className="ticker-label">HEADLINES</span>
              <div className="ticker-viewport"><span className="ticker-track onair-ticker" style={{ animationDuration: `${tickerSecs}s` }}>{tickerText}   •   {tickerText}</span></div>
            </div>
          )}
          {lay.cam && <div className="frame-cam" style={boxStyle(lay.cam)}><DeckPicture getEl={playout.activeVideo} fallback={fresh.length > 0 ? <div className="cam-slate"><span className="role-tag">NEWS</span><PanelCarousel items={fresh.slice(0, 5).map((h) => h.text)} nowMs={nowMs} /></div> : <><span>CAM</span><span className="role-tag">{cam} (25% x 25%)</span></>} /></div>}
          {gateVisible && (
            <div className="gate-overlay">
              <div className="gate-card">
                <span className="role-tag">AUDIO ONLY</span>
                <h2>AJN Precision Engineering — On Air</h2>
                <p>{canStart ? 'Click to start. This lets the page play audio.' : `${gateReason}${gateFiller}`}</p>
                {!canStart && edition.staleFeeds.length > 0 && <p style={{ fontSize: 'calc(16 * var(--u))' }}>Feeds not refreshed: {edition.staleFeeds.slice(0, 6).join(', ')}{edition.staleFeeds.length > 6 ? ` and ${edition.staleFeeds.length - 6} more` : ''}</p>}
                {!canStart && <><p style={{ fontSize: 'calc(16 * var(--u))' }}>Checking again every 10 seconds.</p><button type="button" onClick={() => edition.refresh()} data-testid="on-air-retry">Check again now</button></>}
                {playout.startError && <p role="alert" style={{ color: '#ff8a80' }}>Start failed: {playout.startError}</p>}
                <button type="button" disabled={!canStart} onClick={() => playout.start()} data-testid="on-air-start">Start On Air</button>
              </div>
            </div>
          )}
        </div>
      </div>
      {initial.debug && machine && (
        <div className="onair-debug" data-testid="on-air-debug">
          {`state=${machine.state} seg=${machine.segmentId} deckA=${machine.decks.A.volume.toFixed(2)}/${machine.decks.A.readyState} deckB=${machine.decks.B.volume.toFixed(2)}/${machine.decks.B.readyState} mode=${machine.volumeMode} transitions=${machine.transitions}\n`}
          {cur ? `why: ${cur.why ?? '-'}${cur.startOffsetSec ? ` · from ${cur.startOffsetSec}s` : ''}\n` : ''}
          {playout.logRing.slice(-12).map((l) => `${l.at} ${l.msg}`).join('\n')}
        </div>
      )}
    </div>
  );
  // Clean view renders straight under <body> so no animated or transformed page ancestor can offset it from the window.
  return clean ? createPortal(view, document.body) : view;
}
