// Live-radio "now playing" (title, artist, cover) from the STATION'S OWN public feed. Server-side only.
// Adapter 'corus-s3': Corus FM stations publish <CODE>_np.js (current song) and <CODE>_pl.js (recent songs) as JSONP on a fixed S3 host.
// Adapter 'triton': Triton Digital's public Now Playing API (np.tritondigital.com) for a StreamTheWorld mount; XML, no cover art.
// Rules: the URL is built here from a validated station code (never from user input); the JSONP wrapper is stripped and the body is
// parsed with JSON.parse (never executed); only https images on an allow-listed host are passed on; nothing is invented:
// no feed, no song, or an old feed is reported as such.
export type NowPlayingConfig =
  | { kind: 'corus-s3'; code: string }
  | { kind: 'triton'; mount: string }
  | { kind: 'somafm'; channel: string }
  | { kind: 'live365'; mount: string }
  | { kind: 'ihr'; stream: string }
  | { kind: 'ch109'; slug: string };
/** Reads the first inline-metadata block of an Icy stream (server-side, bounded). Returns the raw StreamTitle text. */
export type IcyReader = (url: string, signal: AbortSignal) => Promise<{ status: number; streamTitle: string | null }>;
export interface SongEntry { artist: string; title: string; artUrl: string | null; playedLabel: string | null }
export type NowPlayingState = 'ok' | 'stale' | 'none' | 'error';
export interface NowPlaying {
  state: NowPlayingState; reason?: string;
  current: SongEntry | null; recent: SongEntry[];
  sourceUpdatedAt: string | null; ageSeconds: number | null; fetchedAt: string; source: 'station';
}
export type TextFetcher = (url: string, signal: AbortSignal) => Promise<{ status: number; text: string; lastModified: string | null }>;

const HOST = 'https://globalnewselection.s3.amazonaws.com/fm-playlist/results/';
const ART_HOSTS = /^https:\/\/is\d*-ssl\.mzstatic\.com\//;
export const STALE_AFTER_S = 20 * 60;
const MAX_BYTES = 64 * 1024;
const CODE_RE = /^[A-Z0-9]{3,12}$/;
const MOUNT_RE = /^[A-Za-z0-9_]{3,40}$/;
const TRITON = 'https://np.tritondigital.com/public/nowplaying';
const SOMA_CH_RE = /^[a-z0-9]{3,30}$/;
const L365_RE = /^a\d{3,8}$/;
const IHR_RE = /^zc\d{1,6}$/;
const CH109_SLUG_RE = /^[a-z0-9-]{3,30}$/;
const CH109_API = 'https://www.classichits109.com/api/';
const L365_ART = /^https:\/\/media\.live365\.com\//;

export const stripJsonp = (text: string): unknown => {
  const m = /^\s*[A-Za-z_$][\w$]*\(([\s\S]*)\)\s*;?\s*$/.exec(text);
  if (!m) throw new Error('not a JSONP body');
  return JSON.parse(m[1]);
};
const clean = (v: unknown, max = 160): string => typeof v === 'string' ? v.replace(/<[^>]*>/g, ' ').replace(/&apos;|&#0?39;/g, "'").replace(/&quot;|&#0?34;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const art = (v: unknown): string | null => typeof v === 'string' && ART_HOSTS.test(v) ? v : null;
const entry = (artist: unknown, title: unknown, img: unknown, label: unknown): SongEntry | null => {
  const a = clean(artist), t = clean(title);
  return a && t ? { artist: a, title: t, artUrl: art(img), playedLabel: clean(label, 20) || null } : null;
};

async function fetchCorus(cfg: { kind: 'corus-s3'; code: string }, fetchText: TextFetcher, now: number, timeoutMs: number): Promise<NowPlaying> {
  const base = { fetchedAt: new Date(now).toISOString(), source: 'station' as const, recent: [] as SongEntry[], current: null as SongEntry | null, sourceUpdatedAt: null as string | null, ageSeconds: null as number | null };
  if (!CODE_RE.test(cfg.code)) return { ...base, state: 'error', reason: 'bad station config' };
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const [np, pl] = await Promise.all([
      fetchText(`${HOST}${cfg.code}_np.js`, ctl.signal),
      fetchText(`${HOST}${cfg.code}_pl.js`, ctl.signal).catch(() => null),
    ]);
    if (np.status === 404 || np.status === 403) return { ...base, state: 'none', reason: `station feed not found (HTTP ${np.status})` };
    if (np.status !== 200) return { ...base, state: 'error', reason: `station feed HTTP ${np.status}` };
    if (np.text.length > MAX_BYTES) return { ...base, state: 'error', reason: 'feed too large' };
    let o: Record<string, unknown>;
    try { o = stripJsonp(np.text) as Record<string, unknown>; } catch (e) { return { ...base, state: 'error', reason: `feed unreadable: ${(e as Error).message}` }; }
    const current = entry(o.artist_name, o.song_name, o.itunes_img ?? o.image, o.locale_time);
    let recent: SongEntry[] = [];
    if (pl && pl.status === 200 && pl.text.length <= MAX_BYTES) {
      try {
        const songs = (stripJsonp(pl.text) as { songs?: Array<Record<string, unknown>> }).songs ?? [];
        recent = songs.slice(0, 15).map((s) => entry(s.artist, s.song, s.image, s.date)).filter((x): x is SongEntry => !!x);
      } catch { /* recent list is optional; current song still reported */ }
    }
    const lm = np.lastModified ? Date.parse(np.lastModified) : NaN;
    const age = Number.isNaN(lm) ? null : Math.max(0, Math.round((now - lm) / 1000));
    const updated = Number.isNaN(lm) ? null : new Date(lm).toISOString();
    if (!current) return { ...base, state: 'none', reason: 'feed has no current song', recent, sourceUpdatedAt: updated, ageSeconds: age };
    return { ...base, state: age !== null && age > STALE_AFTER_S ? 'stale' : 'ok', current, recent, sourceUpdatedAt: updated, ageSeconds: age };
  } catch (e) {
    return { ...base, state: 'error', reason: (e as Error).name === 'AbortError' ? 'station feed timed out' : `station feed unreachable: ${(e as Error).message}` };
  } finally { clearTimeout(timer); }
}

const cdata = (xml: string, name: string): string => {
  const m = new RegExp(`<property name="${name}"><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></property>`).exec(xml);
  return m ? m[1] : '';
};
async function fetchTriton(cfg: { kind: 'triton'; mount: string }, fetchText: TextFetcher, now: number, timeoutMs: number): Promise<NowPlaying> {
  const base = { fetchedAt: new Date(now).toISOString(), source: 'station' as const, recent: [] as SongEntry[], current: null as SongEntry | null, sourceUpdatedAt: null as string | null, ageSeconds: null as number | null };
  if (!MOUNT_RE.test(cfg.mount)) return { ...base, state: 'error', reason: 'bad station config' };
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetchText(`${TRITON}?mountName=${cfg.mount}&numberToFetch=1&eventType=track`, ctl.signal);
    if (r.status !== 200) return { ...base, state: 'error', reason: `station feed HTTP ${r.status}` };
    if (r.text.length > MAX_BYTES) return { ...base, state: 'error', reason: 'feed too large' };
    if (!r.text.includes('<nowplaying-info-list')) return { ...base, state: 'error', reason: 'feed unreadable' };
    const title = clean(cdata(r.text, 'cue_title')), artist = clean(cdata(r.text, 'track_artist_name'));
    // Triton publishes station IDs, show names and headlines as tracks too; a song always has an artist.
    if (!title || !artist) return { ...base, state: 'none', reason: 'no song right now (talk, news or ad block)' };
    const startMs = Number(cdata(r.text, 'cue_time_start'));
    const started = Number.isFinite(startMs) && startMs > 0 ? startMs : NaN;
    const age = Number.isNaN(started) ? null : Math.max(0, Math.round((now - started) / 1000));
    // A title with no artist is shown as the title only; nothing is invented.
    const current: SongEntry = { artist, title, artUrl: null, playedLabel: null };
    return { ...base, state: age !== null && age > STALE_AFTER_S ? 'stale' : 'ok', current, sourceUpdatedAt: Number.isNaN(started) ? null : new Date(started).toISOString(), ageSeconds: age };
  } catch (e) {
    return { ...base, state: 'error', reason: (e as Error).name === 'AbortError' ? 'station feed timed out' : `station feed unreachable: ${(e as Error).message}` };
  } finally { clearTimeout(timer); }
}

const mkBase = (now: number) => ({ fetchedAt: new Date(now).toISOString(), source: 'station' as const, recent: [] as SongEntry[], current: null as SongEntry | null, sourceUpdatedAt: null as string | null, ageSeconds: null as number | null });
const withAge = (base: ReturnType<typeof mkBase>, current: SongEntry, startMs: number, now: number): NowPlaying => {
  const ok = Number.isFinite(startMs) && startMs > 0;
  const age = ok ? Math.max(0, Math.round((now - startMs) / 1000)) : null;
  return { ...base, state: age !== null && age > STALE_AFTER_S ? 'stale' : 'ok', current, sourceUpdatedAt: ok ? new Date(startMs).toISOString() : null, ageSeconds: age };
};
const failure = (base: ReturnType<typeof mkBase>, e: unknown): NowPlaying => ({ ...base, state: 'error', reason: (e as Error).name === 'AbortError' ? 'station feed timed out' : `station feed unreachable: ${(e as Error).message}` });

async function fetchSoma(cfg: { kind: 'somafm'; channel: string }, fetchText: TextFetcher, now: number, timeoutMs: number): Promise<NowPlaying> {
  const base = mkBase(now);
  if (!SOMA_CH_RE.test(cfg.channel)) return { ...base, state: 'error', reason: 'bad station config' };
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetchText(`https://somafm.com/songs/${cfg.channel}.json`, ctl.signal);
    if (r.status !== 200) return { ...base, state: 'error', reason: `station feed HTTP ${r.status}` };
    if (r.text.length > 256 * 1024) return { ...base, state: 'error', reason: 'feed too large' };
    let j: any; try { j = JSON.parse(r.text); } catch { return { ...base, state: 'error', reason: 'feed unreadable' }; }
    const first = Array.isArray(j?.songs) ? j.songs[0] : null;
    const title = clean(first?.title), artist = clean(first?.artist);
    if (!title) return { ...base, state: 'none', reason: 'no track is playing' };
    // SomaFM publishes empty albumArt; nothing is invented.
    return withAge(base, { artist, title, artUrl: null, playedLabel: null }, Number(first?.date) * 1000, now);
  } catch (e) { return failure(base, e); } finally { clearTimeout(timer); }
}

async function fetchLive365(cfg: { kind: 'live365'; mount: string }, fetchText: TextFetcher, now: number, timeoutMs: number): Promise<NowPlaying> {
  const base = mkBase(now);
  if (!L365_RE.test(cfg.mount)) return { ...base, state: 'error', reason: 'bad station config' };
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetchText(`https://api.live365.com/station/${cfg.mount}`, ctl.signal);
    if (r.status !== 200) return { ...base, state: 'error', reason: `station feed HTTP ${r.status}` };
    if (r.text.length > 256 * 1024) return { ...base, state: 'error', reason: 'feed too large' };
    let j: any; try { j = JSON.parse(r.text); } catch { return { ...base, state: 'error', reason: 'feed unreadable' }; }
    const t = j?.['current-track'];
    const title = clean(t?.title), artist = clean(t?.artist);
    if (!title) return { ...base, state: 'none', reason: 'no track is playing' };
    const art = typeof t?.art === 'string' && L365_ART.test(t.art) ? t.art : null;
    return withAge(base, { artist, title, artUrl: art, playedLabel: null }, Date.parse(String(t?.start ?? '').replace(' ', 'T')), now);
  } catch (e) { return failure(base, e); } finally { clearTimeout(timer); }
}

/** iHeart inline meta: StreamTitle=' <artist> - text="<title>" song_spot="M" ...'. Only song_spot="M" (music) is shown; ads and station IDs are "none". */
export function parseIhrTitle(t: string): { music: boolean; artist: string; title: string } | null {
  if (!t.includes('song_spot=')) return null;
  const spot = /song_spot="(\w)"/.exec(t)?.[1];
  const txt = /text="([^"]*)"/.exec(t)?.[1] ?? '';
  const head = /^\s*([\s\S]*?)\s*-\s*text=/.exec(t)?.[1] ?? '';
  return { music: spot === 'M', artist: clean(head), title: clean(txt) };
}
async function fetchIhr(cfg: { kind: 'ihr'; stream: string }, readIcy: IcyReader, now: number, timeoutMs: number): Promise<NowPlaying> {
  const base = mkBase(now);
  if (!IHR_RE.test(cfg.stream)) return { ...base, state: 'error', reason: 'bad station config' };
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await readIcy(`https://stream.revma.ihrhls.com/${cfg.stream}`, ctl.signal);
    if (r.status !== 200) return { ...base, state: 'error', reason: `station stream HTTP ${r.status}` };
    if (r.streamTitle === null) return { ...base, state: 'error', reason: 'station stream has no inline titles' };
    const p = parseIhrTitle(r.streamTitle);
    if (!p || !p.music || !p.title) return { ...base, state: 'none', reason: 'no song right now (ad, station ID or talk)' };
    // Inline titles carry no start time: it is the song playing at this moment.
    return { ...base, state: 'ok', current: { artist: p.artist, title: p.title, artUrl: null, playedLabel: null }, ageSeconds: 0 };
  } catch (e) { return failure(base, e); } finally { clearTimeout(timer); }
}

/** "Artist - Title" as the station publishes it. Split on the FIRST " - "; a title with no separator is not guessed at. */
const splitSong = (raw: unknown): { artist: string; title: string } | null => {
  const t = clean(raw, 200); const i = t.indexOf(' - ');
  return i > 0 ? { artist: t.slice(0, i).trim(), title: t.slice(i + 3).trim() } : null;
};
/** The station naming itself in the artist slot is an ID/promo, not a song. */
const ownBrand = (artist: string): boolean => /\b(classic ?hits|classic ?rock|warm|summertime|one ?hit) ?(109|wonders|hits)?\b.*\b109\b|^(classic ?hits|classic ?rock|warm|ch) ?109$/i.test(artist);
const agoLabel = (iso: unknown, now: number): string | null => {
  const ms = Date.parse(String(iso ?? '')); if (!Number.isFinite(ms)) return null;
  const m = Math.round((now - ms) / 60000);
  return m < 0 ? null : m < 1 ? 'just now' : m < 120 ? `${m} min ago` : null;
};

/** Classic Hits 109's own site API: api/metadata.php (current song) + api/history.php (last 5). Same feeds its web player uses. */
async function fetchCh109(cfg: { kind: 'ch109'; slug: string }, fetchText: TextFetcher, now: number, timeoutMs: number): Promise<NowPlaying> {
  const base = mkBase(now);
  if (!CH109_SLUG_RE.test(cfg.slug)) return { ...base, state: 'error', reason: 'bad station config' };
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const q = `?station=${cfg.slug}`;
    const [cur, hist] = await Promise.all([
      fetchText(`${CH109_API}metadata.php${q}`, ctl.signal),
      fetchText(`${CH109_API}history.php${q}`, ctl.signal).catch(() => null),
    ]);
    if (cur.status !== 200) return { ...base, state: 'error', reason: `station feed HTTP ${cur.status}` };
    if (cur.text.length > 64 * 1024) return { ...base, state: 'error', reason: 'feed too large' };
    let j: any; try { j = JSON.parse(cur.text); } catch { return { ...base, state: 'error', reason: 'feed unreadable' }; }
    if (j?.error) return { ...base, state: 'none', reason: 'station feed does not know this station' };
    const song = splitSong(j?.songtitle ?? j?.title);
    const recent: SongEntry[] = [];
    if (hist && hist.status === 200 && hist.text.length <= 64 * 1024) {
      try {
        const h: any = JSON.parse(hist.text);
        for (const t of (Array.isArray(h?.tracks) ? h.tracks : []).slice(0, 8)) {
          const sp = splitSong(t?.title ?? t?.songtitle);
          if (!sp || looksLikeNonSong(sp.artist, sp.title) || ownBrand(sp.artist)) continue;
          if (song && sp.artist === song.artist && sp.title === song.title && recent.length === 0) continue; // the playing song is not "recent"
          recent.push({ artist: sp.artist, title: sp.title, artUrl: null, playedLabel: agoLabel(t?.played_at, now) });
          if (recent.length >= 5) break;
        }
      } catch { /* history is optional */ }
    }
    if (!song) return { ...base, recent, state: 'none', reason: 'no song title is being published' };
    if (ownBrand(song.artist)) return { ...base, recent, state: 'none', reason: 'no song right now (station ID or promo)' };
    return { ...base, recent, current: { artist: song.artist, title: song.title, artUrl: null, playedLabel: null }, state: 'ok' };
  } catch (e) { return failure(base, e); } finally { clearTimeout(timer); }
}

/** Station IDs, ad breaks, show names and headlines that feeds publish as "tracks". Conservative: a real song may be dropped, an ad is never shown as a song. */
export function looksLikeNonSong(artist: string, title: string): boolean {
  const a = artist.trim(), t = title.trim();
  if (!t) return true;
  if (a && a.toLowerCase() === t.toLowerCase()) return true;
  const both = `${a} ${t}`;
  if (/\bad break\b|\bsecond ad\b|\bcommercial (break|pod)\b|\bstation id\b|\bsweeper\b|\bjingle\b|\bpsa\b|\bunderwriting\b|\btraffic (intro|report|update)\b/i.test(both)) return true;
  if (/\.(org|com|net)\b|\bwww\./i.test(both)) return true;
  if (/\b(8\d|9\d|10\d)\.\d\b/.test(both)) return true; // dial frequency (e.g. "News 88.9 KNPR")
  if (/^live365$/i.test(a)) return true;
  if (/^\d{4}-\d{1,2}-\d{1,2}\b/.test(a) || /^\d{1,2}:\d{2}/.test(a)) return true; // a timestamp in the artist slot
  return false;
}
async function dispatch(cfg: NowPlayingConfig, fetchText: TextFetcher, now: number, timeoutMs: number, readIcy: IcyReader): Promise<NowPlaying> {
  if (cfg.kind === 'corus-s3') return fetchCorus(cfg, fetchText, now, timeoutMs);
  if (cfg.kind === 'triton') return fetchTriton(cfg, fetchText, now, timeoutMs);
  if (cfg.kind === 'somafm') return fetchSoma(cfg, fetchText, now, timeoutMs);
  if (cfg.kind === 'live365') return fetchLive365(cfg, fetchText, now, timeoutMs);
  if (cfg.kind === 'ihr') return fetchIhr(cfg, readIcy, now, timeoutMs);
  if (cfg.kind === 'ch109') return fetchCh109(cfg, fetchText, now, timeoutMs);
  return { fetchedAt: new Date(now).toISOString(), source: 'station', recent: [], current: null, sourceUpdatedAt: null, ageSeconds: null, state: 'error', reason: 'bad station config' };
}
export async function fetchNowPlaying(cfg: NowPlayingConfig, fetchText: TextFetcher, now = Date.now(), timeoutMs = 6000, readIcy: IcyReader = httpIcyReader): Promise<NowPlaying> {
  const r = await dispatch(cfg, fetchText, now, timeoutMs, readIcy);
  if (r.current && looksLikeNonSong(r.current.artist, r.current.title)) return { ...r, state: 'none', current: null, sourceUpdatedAt: null, ageSeconds: null, reason: 'no song right now (station ID, ad or talk)' };
  return r;
}

export const httpTextFetcher: TextFetcher = async (url, signal) => {
  const r = await fetch(url, { signal, headers: { 'user-agent': 'AJN-Precision-Engineering/1.0 (now-playing)' } });
  const text = await r.text();
  return { status: r.status, text, lastModified: r.headers.get('last-modified') };
};

/** Opens a stream with Icy-MetaData, reads only up to the first metadata block (<= ~40 KB), then closes it. */
export const httpIcyReader: IcyReader = async (url, signal) => {
  const res = await fetch(url, { signal, headers: { 'Icy-MetaData': '1', 'User-Agent': 'AJN-Precision-Engineering/1.0 (now-playing)' } });
  if (res.status !== 200 || !res.body) { try { await res.body?.cancel(); } catch { /* ignore */ } return { status: res.status, streamTitle: null }; }
  const metaint = Number(res.headers.get('icy-metaint'));
  if (!Number.isInteger(metaint) || metaint < 1 || metaint > 32768) { try { await res.body.cancel(); } catch { /* ignore */ } return { status: 200, streamTitle: null }; }
  const reader = res.body.getReader(); const chunks: Uint8Array[] = []; let have = 0, need = metaint + 1;
  try {
    while (have < need && have < metaint + 1 + 4096 + 16) {
      const { value, done } = await reader.read(); if (done) break;
      chunks.push(value); have += value.length;
      if (have > metaint) { const buf = Buffer.concat(chunks); need = metaint + 1 + buf[metaint] * 16; }
    }
  } finally { try { await reader.cancel(); } catch { /* ignore */ } }
  const buf = Buffer.concat(chunks);
  if (buf.length <= metaint) return { status: 200, streamTitle: null };
  const len = buf[metaint] * 16;
  if (buf.length < metaint + 1 + len) return { status: 200, streamTitle: null };
  const block = buf.subarray(metaint + 1, metaint + 1 + len).toString('utf8').replace(/\0+$/, '');
  const m = /StreamTitle='([\s\S]*?)';/.exec(block);
  return { status: 200, streamTitle: m ? m[1] : '' };
};
