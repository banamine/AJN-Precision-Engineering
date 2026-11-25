/* AJN On Air: the daily run of show (podcast, then live radio, then podcast) as a 16:9 broadcast frame.
 * Audio first. One foreground audio source at a time; the engine (engine.js) decides, this page shows and does what it says.
 * &debug=1 shows the engine state and log. (Clean view and the camera-corner reservation were removed 2026-11-23: a camera is laid over the page instead.)
 * Everything on screen is real data or an explicit "unavailable" note; nothing is invented. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AJN_PLAYOUT as E } from './engine.js';
import { DEFAULT_PARAMS, LIVE_STATIONS, STATION_LOGO, buildRunOfShowFromEdition, segmentIndexAt, type Segment } from './runOfShow';
import { useOnAirPlayout } from './useOnAirPlayout';
import OnAirSpectrum from './OnAirSpectrum';
import ArchiveOnThisDay from './ArchiveOnThisDay';
import { useDeskStories } from './useDeskStories';
import { rankForToday } from '../desk/onThisDay';
import { StoryWindow } from '../desk/StoryWindow';
import { isSaved, loadSaved, saveSaved, toggleSaved } from '../desk/savedStories';
import type { DeskItem } from '../desk/useDesk';
import PanelCarousel from './PanelCarousel';
import DeckPicture from './DeckPicture';
import { loadLibraryAlbums, type LibAlbum } from './libraryTracks';
import { useOnAirData } from './useOnAirData';
import { useOnAirFiller, poolSize } from './useOnAirFiller';
import { DEFAULT_BACKFILL } from './backfill';
import { stageVirtualSize, type StageSize } from './stageSize';
import { comingUp, cycleStart, daypartRest, remainingLabel, stillToComeToday } from './scheduleView';
import { nextAirings } from './nextAirings';
import { denverDateKey, denverMidnight } from '../utils/dailyEdition';
import { useDailyEdition } from '../hooks/useDailyEdition';
import { useLiveRadioNowPlaying } from '../hooks/useLiveRadioNowPlaying';
import { ShowArt } from '../components/ShowArt';
import OnAirCaptions, { archivePathOf } from './OnAirCaptions';
import { useCaptionTrack } from '../news/captions/useCaptionTrack';
import './onair.css';

// One ticker only: the headlines run along the bottom, so there is no Headlines panel. "Still to come" replaces the old Missed shows and Around the clock panels.
/** How long the large right-hand panel holds each of its contents before it crossfades to the next. */
const BIG_PANEL_DWELL_MS = 30_000;
/* Board merge (2026-11-25): Last songs and Live now are inside the Now card and the music stage; Still to come duplicated Coming up; Homepage reel was never available. */
const PANEL_CATALOG = ['Digest', 'Weather', 'On this day', 'Station ID card', 'Clock card', 'Show card'];
const params = DEFAULT_PARAMS;
type Rect = { x: number; y: number; w: number; h: number };
const boxStyleIn = (r: Rect, vw: number, vh: number): React.CSSProperties => ({ left: `${(r.x / vw) * 100}%`, top: `${(r.y / vh) * 100}%`, width: `${(r.w / vw) * 100}%`, height: `${(r.h / vh) * 100}%` });
const fitClass = (t: string): string => (t.length <= 22 ? 'fit-1' : t.length <= 38 ? 'fit-2' : 'fit-3');
const hms = (ms: number): string => E.formatDenverHMS(ms) as string;
const mmss = (s: number): string => E.formatMMSS(s) as string;
const kindForPanel = (type: string): string => {
  if (type === 'Show card' || type === 'Last songs') return 'show';
  if (type === 'Clock card' || type === 'Live now') return 'now';
  if (type === 'Station ID card' || type === 'Still to come') return 'when';
  if (type === 'Digest') return 'digest';
  if (type === 'Weather') return 'weather';
  return 'story';
};

function readQuery(): { debug: boolean } {
  const search = typeof window === 'undefined' ? '' : window.location.search;
  const hashQ = typeof window === 'undefined' ? '' : (window.location.hash.split('?')[1] ?? '');
  const dbg = new URLSearchParams(search || `?${hashQ}`).get('debug') === '1' || new URLSearchParams(hashQ).get('debug') === '1';
  return { debug: dbg };
}

export default function OnAirPage({ stopExistingPlayback }: { stopExistingPlayback?: () => void }) {
  const initial = useMemo(readQuery, []);
  const [albums, setAlbums] = useState<LibAlbum[] | null>(null);
  const [albumsFailed, setAlbumsFailed] = useState(false);
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


  const idx = ros.length ? (machine && machine.state !== 'IDLE' ? Math.max(0, playout.ros.findIndex((s) => s.id === machine.segmentId)) : segmentIndexAt(playout.ros, nowMs)) : -1;
  const list = playout.ros;
  const cur = seg ?? (idx >= 0 ? list[idx] : null);
  const next = idx >= 0 ? (list[idx + 1] ?? list[0]) : null;
  const later = idx >= 0 ? (list[idx + 2] ?? list[0]) : null;
  const onAir = !!machine && machine.state !== 'IDLE';
  const dp = E.daypartOf(nowMs) as string;
  const fresh = data.headlines;
  const tickerVisible = fresh.length > 0;
  // The stage fills its box edge to edge: layout runs in a virtual space of the box's own shape (see stageSize.ts).
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [vsz, setVsz] = useState<StageSize>({ w: 1920, h: 1080 });
  useEffect(() => {
    const el = shellRef.current; if (!el) return undefined;
    const measure = (): void => { const n = stageVirtualSize(el.clientWidth, el.clientHeight); setVsz((p) => (p.w === n.w && p.h === n.h ? p : n)); };
    measure();
    if (typeof ResizeObserver === 'undefined') { window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure); }
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const VW = vsz.w;
  const boxStyle = (r: Rect): React.CSSProperties => boxStyleIn(r, vsz.w, vsz.h);
  const lay0 = E.layoutFor('Off', vsz.w, vsz.h, tickerVisible) as { header: Rect; stage: Rect; panels: Rect[]; lowerThird: Rect; ticker: Rect; cam: Rect | null };
  // Wider side panels (about 38% of the width): the stage gives up the room the Recently Played list no longer needs. Only when the panels sit to the right of the stage.
  const lay = (() => {
    const px = Math.min(...lay0.panels.map((r) => r.x));
    let base = lay0;
    if (px > lay0.stage.x) {
      const grow = Math.max(0, Math.min(150, Math.round(VW * 0.38) - (VW - px)));
      if (grow) base = { ...lay0, stage: { ...lay0.stage, w: lay0.stage.w - grow }, panels: lay0.panels.map((r) => ({ ...r, x: r.x - grow, w: r.w + grow })) };
    }
    const colTop = base.panels[0].y;
    const colBottom = base.lowerThird.y - 12;
    const gap = 14;
    const panel0 = { ...base.panels[0], h: 150 };
    const panelBig = { ...base.panels[1], y: colTop + 150 + gap, h: colBottom - (colTop + 150 + gap) };
    return { ...base, panels: [panel0, panelBig, panelBig, panelBig] };
  })();

  // Declassified Desk stories: near-date ones first, then the rest (see desk/onThisDay.ts). Click opens the story window.
  const deskStories = useDeskStories();
  const todayMD = (() => { const p = E.denverParts(nowMs) as { month: number; day: number }; return { month: p.month, day: p.day }; })();
  const rankedStories = useMemo(() => rankForToday(deskStories, todayMD), [deskStories, todayMD.month, todayMD.day]); // eslint-disable-line react-hooks/exhaustive-deps
  const [openStory, setOpenStory] = useState<{ item: DeskItem; label: string; el: HTMLElement | null } | null>(null);
  const [capHost, setCapHost] = useState<HTMLElement | null>(null);
  const [savedStories, setSavedStories] = useState<DeskItem[]>(() => loadSaved());
  const toggleStory = (item: DeskItem) => setSavedStories((list) => { const next = toggleSaved(list, item); saveSaved(next); return next; });

  // Music blocks end early/late; shift planned times by the real exit drift so every list agrees with the stage ticket.
  const drift = cur && cur.type === 'music' && machine?.musicExitMs ? machine.musicExitMs - cur.endMs : 0;
  const curName = cur && cur.type === 'podcast' ? cur.name : '';
  // Captions for news clips: the same Archive caption pipeline as the player; only TV News files match, everything else stays 'off'.
  const capPath = cur && cur.type === 'podcast' && cur.filler ? archivePathOf(cur.src) : undefined;
  const captionState = useCaptionTrack(capPath, () => playout.activeVideo() as HTMLVideoElement | null);
  const upRows = comingUp(list, nowMs, curName, drift);
  const upcomingPodcasts = (): string[] => upRows.map((r) => `~${r.label}`);
  const stillLines = stillToComeToday(list, nowMs, 5, drift);

  // Music block display: live song from the station's feed; library track from the block's real track list.
  const libTrack = playout.blockTrack;
  const recent = np.recent.slice(0, 3);
  const lastSongs: string[] = effSrc === 'Live 109' ? recent.map((r, i) => `${i + 1}. ${r.artist ? `${r.artist} – ` : ''}${r.title}`) : [];
  const availability: Record<string, boolean> = {
    Digest: data.digestLines.length > 0, Weather: data.weatherLines !== null, 'Last songs': false,
    'On this day': data.onThisDay !== null || data.archiveItems.length > 0 || rankedStories.length > 0, 'Live now': false, 'Homepage reel': false, 'Still to come': false,
    'Station ID card': true, 'Clock card': true,
  };
  const panelTypes = cur ? (E.pickPanels({ dwellSec: params.panelDwellSec, libraryUnreachable: !!machine?.libraryUnreachable && rankedStories.length === 0 && data.archiveItems.length === 0 }, PANEL_CATALOG, availability, dp, cur.type, nowMs) as string[]) : [];

  const whenLines = nextAirings(list, nowMs, [
    { label: 'Alex Jones', re: /alex jones|infowars/i }, { label: 'Fox News', re: /fox news/i },
    { label: 'CNN', re: /\bcnn\b/i }, { label: 'BBC News', re: /\bbbc\b/i },
    { label: 'Coast to Coast', re: /coast to coast/i }, { label: 'Paul Harvey', re: /paul harvey/i },
  ], drift);
  const wdName = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', weekday: 'long' }).format(new Date(nowMs));
  const nowLines = [
    `${new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit' }).format(new Date(nowMs))} Denver`,
    `${wdName} · ${wdName === 'Saturday' || wdName === 'Sunday' ? 'Weekend' : 'Weekday'} · ${dp}`,
    ...lastSongs.slice(0, 3),
  ];
  const panelTitle = (t: string): string =>
    ({ 'Still to come': 'Tonight on AJN', 'Clock card': 'Now', 'Station ID card': 'When does it play' } as Record<string, string>)[t] ?? t;
  const panelLines = (type: string): string[] => {
    if (!cur) return [type];
    if (type === 'Show card') return [cur.showName, [cur.networkTag, cur.publishedDate].filter(Boolean).join(' · ') || (next ? `Next: ${next.name}` : ''), cur.episodeTitle ?? ''].filter(Boolean);
    if (type === 'Digest') return data.digestLines;
    if (type === 'Weather') return data.weatherLines ?? ['Weather unavailable'];
    if (type === 'Last songs') return lastSongs.slice(0, 3);
    if (type === 'On this day') return data.onThisDay ? [`On this day · ${data.onThisDay.date}`, data.onThisDay.title, 'Library recording'] : [];
    if (type === 'Live now') return ['AJN Radio · Live 109', 'Classic Rock 109 · Classic Hits 109', cur.type === 'music' && effSrc === 'Live 109' ? `On air: ${cur.musicStation}` : 'Between podcasts'];
    if (type === 'Still to come') return stillLines;
    if (type === 'Station ID card') return whenLines;
    if (type === 'Clock card') return nowLines;
    return [type];
  };
  const panelTag = (t: string): string => ({ 'Show card': 'SHOW META', 'On this day': 'LIBRARY', Weather: 'WEATHER', 'Live now': 'LIVE 109', 'Last songs': 'MUSIC LOG', Digest: 'DIGEST', 'Still to come': 'TODAY' } as Record<string, string>)[t] ?? 'AJN';

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
                {cur.filler && cur.clipDate && <span className="chip">{cur.tag === 'LATEST' ? 'Aired' : 'Recorded'} {cur.clipDate}</span>}
                {cur.networkTag && <span className={cur.networkTag === "REAL AMERICA'S VOICE" ? 'chip net-rav' : cur.networkTag === 'AJN NETWORK' ? 'chip net-ajn' : 'chip'}>{cur.networkTag}</span>}
                {cur.publishedDate && <span className="chip">Published {cur.publishedDate}</span>}
              </div>
              <div className="meta-subline">Segment {cur.index} of {list.length}</div>
            </div>
          </div></div>
          <div className="stage-bottom">
            <div className="progress-wrap">
              <div className="progress-track"><div className={onAir ? 'progress-fill on-air-bar' : 'progress-fill'} style={{ width: `${p.toFixed(1)}%` }} /></div>
              <div className="progress-times"><span>Elapsed {mmss(elapsed)}</span><span>Remaining {remainingLabel(rem, mmss)}</span></div>
            </div>
            {next && <div className={machine?.state === 'CROSSFADING' ? 'plays-next-ticket blending-ticket' : 'plays-next-ticket'}><span>Plays next: {next.name}</span><span className="ticket-time">{hms(next.startMs)}</span></div>}
          </div>
        </div>
        <div className="stage-side">
          <OnAirCaptions state={captionState} />
          <div className="side-heading"><span>Coming up</span></div>
          <div className="transcript-lines">{(captionState.phase === 'off' ? ups : ups.slice(0, 2)).length ? (captionState.phase === 'off' ? ups : ups.slice(0, 2)).map((u) => <div key={u} className="transcript-line single"><span>{u}</span></div>) : <div className="transcript-line single"><span>Nothing scheduled after this</span></div>}</div>
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
            <div className="progress-times"><span>Elapsed {mmss(el)}</span><span>Exit in {remainingLabel(rem, mmss)}</span></div>
          </div>
          {next && <div className={machine?.state === 'CROSSFADING' ? 'plays-next-ticket blending-ticket' : 'plays-next-ticket'}><span>Plays next: {next.name}</span><span className="ticket-time">{exitBy ? 'by ' : ''}{hms(exitMs)}</span></div>}
        </div>
      </div>
      <div className="stage-side">
        <div className="side-heading"><span>{live ? 'Recently Played' : 'This block'}</span></div>
        <div className="transcript-lines side-recent">
          {live
            ? (recent.length ? recent.map((r, i) => <div key={`${r.artist}|${r.title}|${i}`} className={r.artUrl ? 'transcript-line two-line has-art' : 'transcript-line two-line'}>{r.artUrl && <img className="row-art" src={r.artUrl} alt="" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}<div className="row-text"><span>{r.title}</span><span className="sub">{r.artist}</span></div></div>) : <div className="transcript-line single"><span>Song list unavailable</span></div>)
            : (playout.blockTracks.length ? playout.blockTracks.slice(0, 3).map((t, i) => <div key={`${t.src}|${i}`} className="transcript-line two-line"><span>{t.title}</span><span className="sub">{t.artist || t.album}</span></div>) : <div className="transcript-line single"><span>Library tracks unavailable</span></div>)}
        </div>
        <div className="side-heading side-heading-sm"><span>Coming up</span></div>
        <div className="upnext-lines">{upcomingPodcasts().length ? upcomingPodcasts().map((u) => <div key={u} className="upnext-line">{u}</div>) : <div className="upnext-line">Nothing scheduled after this</div>}</div>
      </div>
    </>);
  };

  // Bottom row: NOW stays; the other two panels snap through the rest of today's daypart (after the three "Coming up" shows). Nothing left in the daypart: plain NEXT / LATER.
  const rest = daypartRest(list, nowMs, curName, drift);
  const rs = cycleStart(nowMs, rest.length, 2);
  const restPills = rest.length ? [rest[rs], rest.length > 1 ? rest[(rs + 1) % rest.length] : null].filter((r): r is NonNullable<typeof r> => !!r) : [];

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
    <div className="onair-root" data-testid="on-air-page">
      {edition.notice && (
        <div className="onair-bar">
          <span>{edition.notice.count} new episode{edition.notice.count === 1 ? '' : 's'} published</span>
        </div>
      )}
      {edition.status === 'error' && !ed && <div className="onair-note" role="alert">Today's podcasts could not be loaded{edition.error ? `: ${edition.error}` : ''}. Nothing will play until they load.</div>}
      {albumsFailed && <div className="onair-note" role="status">Library music could not be loaded, so there is no backup if the live station fails.</div>}
      <div className="screen-shell" ref={shellRef}>
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
            // Slots B, C and D are one larger panel that crossfades through their content (the engine still picks what each lane offers).
            if (pi >= 2) return null;
            const bigTypes = [1, 2, 3].map((k) => panelTypes[k]).filter((t): t is string => !!t);
            const bigStep = Math.floor(nowMs / BIG_PANEL_DWELL_MS);
            const storiesOn = rankedStories.length > 0 || data.archiveItems.length > 0;
            const bigOthers = bigTypes.filter((t) => t !== 'On this day');
            /* Stories hold the big panel 3 of every 4 turns; the 4th turn is a Board card (Now, Tonight, Weather...). With no stories, the Board rotates as before. */
            const type = pi === 0 ? panelTypes[0] : storiesOn ? ((bigStep % 4 === 3 && bigOthers.length) ? bigOthers[Math.floor(bigStep / 4) % bigOthers.length] : 'On this day') : (bigTypes.length ? bigTypes[bigStep % bigTypes.length] : undefined);
            const rect = pi === 0 ? lay.panels[0] : lay.panels[1];
            const changed = lastPanels.current[pi] !== null && lastPanels.current[pi] !== type;
            lastPanels.current[pi] = type ?? null;
            if (!type || !cur) return <div key={pi} className="frame-box frame-panel" style={boxStyle(rect)} />;
            const compact = rect.h < 200;
            const lines = panelLines(type);
            const lockedA = pi === 0 && cur.type === 'podcast' && type === 'Show card';
            const photo = type === 'Weather' ? data.weatherPhoto : null;
            const hasLib = type === 'On this day' && (data.archiveItems.length > 0 || rankedStories.length > 0);
            const moveText = false; /* text stays in the panel body, readable */ // // the small text goes up into the header line; the body is left for the picture
            const countdown = pi === 0 ? (lockedA ? 'LOCKED' : `changes in ${E.panelChangesInSec(0, nowMs, params.panelDwellSec)} s`) : `changes in ${Math.max(1, Math.ceil((BIG_PANEL_DWELL_MS - (nowMs % BIG_PANEL_DWELL_MS)) / 1000))} s`;
            return (
              <div key={`${pi}-${type}`} className={`frame-box frame-panel${pi === 1 ? ' frame-panel-big' : ''}${changed ? ' panel-fade' : ''}${photo ? ' has-photo' : ''}`} data-kind={kindForPanel(type)} style={photo ? ({ ...boxStyle(rect), '--photo': `url("${photo.url}")` } as React.CSSProperties) : boxStyle(rect)}>
                <div className="panel-hdr"><span className="panel-title">{hasLib ? 'From the Library · On This Day' : panelTitle(type)}</span>{hasLib && pi === 1 ? <span className="panel-caption" ref={setCapHost} /> : null}{moveText ? <span className="panel-caption"><span title={lines.join(' · ')}>{lines.join(' · ')}</span></span> : null}<span className="panel-countdown">{countdown}</span></div>
                <div className="panel-body">
                  {moveText
                    ? (photo || !cur.artUrl ? null : <div className="panel-art"><img src={cur.artUrl} alt="" referrerPolicy="no-referrer" /></div>)
                    : hasLib
                    ? <div className="panel-lines arch-lines"><ArchiveOnThisDay headlines={data.headlines} items={data.archiveItems} rush={data.onThisDay} stories={rankedStories} nowMs={nowMs} compact={compact} big={pi === 1} captionHost={pi === 1 ? capHost : null} onOpenStory={(item, label, el) => setOpenStory({ item, label, el })} /></div>
                    : type === 'Digest'
                      ? <div className="panel-lines pc-lines"><PanelCarousel items={lines.map((l) => l.replace(/^[•\s]+/, ''))} nowMs={nowMs} /></div>
                      : <div className={`panel-lines${type === 'Show card' ? ' pl-show' : ''}`}>{(compact && type === 'Show card' ? [lines[0], lines[2] ?? lines[1]] : lines.slice(0, compact ? 2 : lines.length)).map((l, i) => <div key={i} className="panel-line-item">{l}</div>)}</div>}
                  {!compact && <div className="panel-tags"><span className="role-tag">{hasLib ? 'LIBRARY' : panelTag(type)}</span>{photo && <a className="photo-credit" href={photo.pageUrl} target="_blank" rel="noopener noreferrer">Photo: {photo.author} · {photo.license}</a>}</div>}
                </div>
              </div>
            );
          })}
          <div className="frame-box frame-lower-third" style={boxStyle(lay.lowerThird)}>
            <div className="lt-pills">
              <span className="lt-pill lt-now"><strong>NOW</strong><span>{cur?.name ?? '—'}</span></span>
              {restPills.length
                ? restPills.map((r, k) => <span key={`${k}-${r.key}`} className="lt-pill lt-snap"><strong>LATER</strong><span>{r.label}</span></span>)
                : <><span className="lt-pill"><strong>NEXT</strong><span>{next?.name ?? '—'}</span></span><span className="lt-pill"><strong>LATER</strong><span>{later?.name ?? '—'}</span></span></>}
            </div>
          </div>
          {tickerVisible && (
            <div className="frame-box frame-ticker" style={boxStyle(lay.ticker)}>
              <span className="ticker-label">HEADLINES</span>
              <div className="ticker-viewport"><span className="ticker-track onair-ticker" style={{ animationDuration: `${tickerSecs}s` }}>{tickerText}   •   {tickerText}</span></div>
            </div>
          )}
          {gateVisible && (
            <div className="gate-overlay">
              <div className="gate-card">
                <span className="role-tag">AUDIO ONLY</span>
                <h2>AJN Precision Engineering — On Air</h2>
                <p>{canStart ? 'Click to start. This lets the page play audio.' : `${gateReason}${gateFiller}`}</p>
                {!canStart && edition.staleFeeds.length > 0 && <p style={{ fontSize: 'calc(16 * var(--u))' }}>Feeds not refreshed: {edition.staleFeeds.slice(0, 6).join(', ')}{edition.staleFeeds.length > 6 ? ` and ${edition.staleFeeds.length - 6} more` : ''}</p>}
                {!canStart && <><p style={{ fontSize: 'calc(16 * var(--u))' }}>Checking again every 10 seconds.</p><button type="button" onClick={() => edition.refresh()} data-testid="on-air-retry">Check again now</button></>}
                {playout.startError && <p role="alert" style={{ color: '#ff8a80' }}>Start failed: {playout.startError}</p>}
                <button type="button" disabled={!canStart} onClick={() => playout.start()} data-testid="on-air-start">{canStart ? 'Start On Air' : 'Loading…'}</button>
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
      {openStory ? <StoryWindow item={openStory.item} dateLabel={openStory.label} returnFocus={openStory.el} onClose={() => setOpenStory(null)} saved={isSaved(savedStories, openStory.item.id)} onToggleSave={() => toggleStory(openStory.item)} /> : null}
    </div>
  );
  // Clean view renders straight under <body> so no animated or transformed page ancestor can offset it from the window.
  return view;
}
