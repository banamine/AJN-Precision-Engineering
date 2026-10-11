/* Podcasts in the Audio & Podcasts guide.
 *  - Feeds are a hand-curated list (src/data/podcastSources.json). Each feed is read on the SERVER,
 *    STREAMED: only the newest few items are parsed and the download is cancelled after that (some feeds are
 *    85 MB / 12,000 episodes). The browser never fetches or parses RSS.
 *  - Audio is NEVER proxied. Each episode's enclosure URL is handed to the player as-is (tracker redirects and
 *    signed, time-limited URLs resolve in the browser), so the browser's own range requests do the buffering.
 *  - Failure is explicit: wrong feed (title mismatch), no playable episodes, upstream error. The last good
 *    episode list is kept (status 'degraded'); an empty result is never cached as success. */
import type { Program, ScheduleChannel } from '../src/types';
import { safeFetch, anyPublicHost } from './safeFetch';
import sourcesJson from '../src/data/podcastSources.json';

export interface PodcastSource {
  id: string; name: string; publisher?: string; feedUrl: string;
  expectTitle: string; enabled: boolean; highlight?: 'must-listen'; verifiedAt?: string;
  /** Enclosure chain verified to allow CORS-mode playback, so the signal meter can read it. Set only after a real-browser check. */
  corsVerified?: boolean;
}
export interface PodcastEpisode {
  guid: string; title: string; description: string; publishedAt: number; url: string;
  durationSeconds?: number; imageUrl?: string;
}
export type PodcastStatus = 'ok' | 'degraded' | 'error';
export interface PodcastState {
  source: PodcastSource; status: PodcastStatus; fetchedAt: string; lastGoodAt?: string;
  feedTitle?: string; imageUrl?: string; episodes: PodcastEpisode[];
  rejected: Array<{ id: string; reason: string }>; error?: string;
}

export const PODCAST_SOURCES: PodcastSource[] = (sourcesJson as any).sources;
export const EPISODES_PER_SHOW: number = (sourcesJson as any).episodesPerShow ?? 20;
const MAX_FEED_BYTES = 6 * 1024 * 1024;   // safety stop; the newest items are at the top of every feed read so far
const FEED_TIMEOUT_MS = 15_000;
const REFRESH_MS = 30 * 60_000;
const STALE_DAYS = 14;
const FIRST_LOAD_WAIT_MS = 8_000;
const CONCURRENCY = 4;

/* ---------- tiny XML helpers (no dependency) ---------- */
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeXml(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
      return ENT[e.toLowerCase()] ?? m;
    });
}
function tag(block: string, name: string): string | undefined {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? decodeXml(m[1]).trim() : undefined;
}
function attr(block: string, name: string, a: string): string | undefined {
  const m = new RegExp(`<${name}\\b[^>]*\\b${a}="([^"]*)"`, 'i').exec(block);
  return m ? decodeXml(m[1]).trim() : undefined;
}
const stripTags = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
export function parseDuration(v?: string): number | undefined {
  if (!v) return undefined;
  const parts = v.trim().split(':').map(Number);
  if (!parts.length || parts.length > 3 || parts.some((n) => !Number.isFinite(n) || n < 0)) return undefined;
  const s = parts.reduce((a, n) => a * 60 + n, 0);
  return s > 0 ? s : undefined;
}
function fnv(s: string): string { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
/** Station-column logos are ~40 px. Omny serves size=Small (25 KB) instead of size=Large (~1 MB); verified 2026-10-10. Other hosts: unchanged. */
export function smallArtwork(url?: string): string | undefined {
  if (!url) return url;
  try { const u = new URL(url); if (u.hostname.endsWith('omnycontent.com') && u.searchParams.has('size')) { u.searchParams.set('size', 'Small'); return u.toString(); } } catch { /* keep as is */ }
  return url;
}
const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|opus|wav)(\?|$)/i;

/* ---------- streamed read: header + the first N <item> blocks, then stop ---------- */
export async function readFeedHead(res: Response, maxItems: number, maxBytes = MAX_FEED_BYTES): Promise<{ head: string; items: string[]; bytes: number; stoppedEarly: boolean }> {
  if (!res.body) { const t = await res.text(); const items = t.match(/<item\b[\s\S]*?<\/item>/gi) ?? []; const i = t.search(/<item\b/i); return { head: i < 0 ? t : t.slice(0, i), items: items.slice(0, maxItems), bytes: t.length, stoppedEarly: items.length > maxItems }; }
  const reader = res.body.getReader(); const dec = new TextDecoder('utf-8');
  let buf = ''; let bytes = 0; let head = ''; let headDone = false; const items: string[] = []; let stoppedEarly = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) { bytes += value.byteLength; buf += dec.decode(value, { stream: true }); }
      if (!headDone) { const i = buf.search(/<item\b/i); if (i >= 0) { head = buf.slice(0, i); buf = buf.slice(i); headDone = true; } }
      if (headDone) {
        for (;;) {
          const end = buf.search(/<\/item>/i); if (end < 0) break;
          const close = end + '</item>'.length; items.push(buf.slice(0, close)); buf = buf.slice(close);
          const next = buf.search(/<item\b/i); buf = next < 0 ? '' : buf.slice(next);
          if (items.length >= maxItems) break;
        }
      }
      if (items.length >= maxItems || bytes >= maxBytes) { stoppedEarly = true; break; }
      if (done) { if (!headDone) head = buf; break; }
    }
  } finally { await reader.cancel().catch(() => {}); }
  return { head, items, bytes, stoppedEarly };
}

/* ---------- turn raw feed pieces into a state ---------- */
export function buildState(source: PodcastSource, parts: { head: string; items: string[] }, now: Date, limit = EPISODES_PER_SHOW): PodcastState {
  const base = { source, fetchedAt: now.toISOString() };
  const feedTitle = tag(parts.head.replace(/<image\b[\s\S]*?<\/image>/gi, ''), 'title');
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!feedTitle || !norm(feedTitle).includes(norm(source.expectTitle))) {
    return { ...base, status: 'error', episodes: [], rejected: [], feedTitle, error: `feed title "${feedTitle ?? 'missing'}" does not match "${source.expectTitle}" (wrong feed)` };
  }
  const imageUrl = attr(parts.head, 'itunes:image', 'href') ?? tag(parts.head.match(/<image\b[\s\S]*?<\/image>/i)?.[0] ?? '', 'url');
  const rejected: PodcastState['rejected'] = []; const seen = new Set<string>(); const eps: PodcastEpisode[] = [];
  for (const [i, block] of parts.items.entries()) {
    const title = tag(block, 'title') ?? '';
    const guid = tag(block, 'guid') || attr(block, 'enclosure', 'url') || '';
    const id = `${source.id}:${guid || i}`;
    if (!guid) { rejected.push({ id, reason: 'no guid and no enclosure' }); continue; }
    if (seen.has(guid)) { rejected.push({ id, reason: 'duplicate guid in feed' }); continue; }
    seen.add(guid);
    const pub = Date.parse(tag(block, 'pubDate') ?? tag(block, 'dc:date') ?? '');
    if (!Number.isFinite(pub) || pub < Date.UTC(2000, 0, 1)) { rejected.push({ id, reason: 'missing or invalid pubDate' }); continue; }
    if (pub > now.getTime() + 3600_000) { rejected.push({ id, reason: 'pubDate is in the future' }); continue; }
    const url = attr(block, 'enclosure', 'url') ?? '';
    const type = attr(block, 'enclosure', 'type') ?? '';
    if (!/^https:\/\//i.test(url)) { rejected.push({ id, reason: 'audio URL is not HTTPS' }); continue; }
    if (!(type.toLowerCase().startsWith('audio/') || AUDIO_EXT.test(url))) { rejected.push({ id, reason: `enclosure is not audio (${type || 'no type'})` }); continue; }
    if (!title) { rejected.push({ id, reason: 'missing title' }); continue; }
    eps.push({ guid, title, description: stripTags(decodeXml(tag(block, 'description') ?? tag(block, 'itunes:summary') ?? '')).slice(0, 280), publishedAt: pub, url,
      durationSeconds: parseDuration(tag(block, 'itunes:duration')), imageUrl: attr(block, 'itunes:image', 'href') });
    if (eps.length >= limit) break;
  }
  if (eps.length === 0) return { ...base, status: 'error', feedTitle, imageUrl, episodes: [], rejected, error: 'no playable episodes in the newest items' };
  // The early-stop read assumes newest-first. If the accepted items run oldest-first, say so instead of showing old ones as "latest".
  const ascending = eps.length > 1 && eps[0].publishedAt < eps[eps.length - 1].publishedAt;
  eps.sort((a, b) => b.publishedAt - a.publishedAt);
  return { ...base, status: ascending ? 'degraded' : 'ok', lastGoodAt: now.toISOString(), feedTitle, imageUrl, episodes: eps, rejected,
    ...(ascending ? { error: 'feed lists oldest episodes first; the newest episodes may be missing' } : {}) };
}

export function toPrograms(state: PodcastState, guideId: string): Program[] {
  const { source } = state; const channelId = `pod-${source.id}`;
  return state.episodes.map((e) => ({
    id: `${channelId}-${fnv(e.guid)}`, guideId, channelId, title: e.title, description: e.description || source.name,
    startTime: 0, endTime: 0, startTimeUtc: new Date(e.publishedAt).toISOString(), endTimeUtc: new Date(e.publishedAt + (e.durationSeconds ?? 2700) * 1000).toISOString(),
    mediaType: 'audio', mediaUrl: e.url, sourceClass: 'podcast_rss', isArchivedSource: false,
    metadata: { externalId: `${source.id}:${e.guid}`, guid: e.guid, feedId: source.id, sourceFeed: source.feedUrl, airedUtc: new Date(e.publishedAt).toISOString(),
      durationSeconds: e.durationSeconds, durationSource: e.durationSeconds ? 'rss' : 'unknown', durationEstimated: !e.durationSeconds,
      thumbnailUrl: e.imageUrl ?? state.imageUrl, podcast: true },
  } as unknown as Program));
}

/* ---------- fetch + cache ---------- */
let fetchImplForTests: typeof fetch | undefined;
export function setPodcastFetchForTests(f: typeof fetch | undefined) { fetchImplForTests = f; cache.clear(); inflight = null; }
const cache = new Map<string, PodcastState>();
let inflight: Promise<void> | null = null;

export async function refreshPodcastSource(source: PodcastSource, now = new Date()): Promise<PodcastState> {
  const prev = cache.get(source.id);
  const keep = (error: string): PodcastState => prev && prev.episodes.length
    ? { ...prev, status: 'degraded', error, fetchedAt: now.toISOString() }
    : { source, status: 'error', fetchedAt: now.toISOString(), episodes: [], rejected: [], error };
  let state: PodcastState;
  try {
    const { res } = await safeFetch(source.feedUrl, { allow: anyPublicHost, timeoutMs: FEED_TIMEOUT_MS, fetchImpl: fetchImplForTests,
      headers: { 'User-Agent': 'AJN-Precision-Engineering/1.0 (podcast reader)', Accept: 'application/rss+xml, application/xml, text/xml, */*' } });
    if (!res.ok) { await res.body?.cancel().catch(() => {}); state = keep(`feed HTTP ${res.status}`); }
    else {
      const parts = await readFeedHead(res, EPISODES_PER_SHOW * 2);
      const built = buildState(source, parts, now);
      state = built.status === 'error' ? keep(built.error!) : built;
      if (built.status === 'error' && state.status === 'error') state = { ...built };
    }
  } catch (e: any) { state = keep(String(e?.message ?? e)); }
  cache.set(source.id, state);
  return state;
}

async function refreshAll(now: Date): Promise<void> {
  const list = PODCAST_SOURCES.filter((s) => s.enabled); let i = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, async () => { while (i < list.length) await refreshPodcastSource(list[i++], now); }));
}
function ensureFresh(now: Date): Promise<void> {
  const stale = PODCAST_SOURCES.some((s) => s.enabled && (!cache.get(s.id) || now.getTime() - Date.parse(cache.get(s.id)!.fetchedAt) > REFRESH_MS));
  if (stale && !inflight) inflight = refreshAll(now).finally(() => { inflight = null; });
  return inflight ?? Promise.resolve();
}
export function podcastStates(): PodcastState[] { return PODCAST_SOURCES.filter((s) => s.enabled).map((s) => cache.get(s.id)).filter(Boolean) as PodcastState[]; }

const shortDate = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Channel rows for the Audio & Podcasts guide. `layout` is the guide's daily layout function. */
export function buildPodcastChannels(guideId: string, now: Date, layout: (p: Program[], mins: number, now: Date, maxSlots: number) => Program[]): ScheduleChannel[] {
  const out: ScheduleChannel[] = [];
  for (const source of PODCAST_SOURCES.filter((s) => s.enabled)) {
    const state = cache.get(source.id); const id = `pod-${source.id}`;
    const row = { id, guideId, name: source.name, mediaType: 'audio' as const, ...(source.highlight ? { highlight: source.highlight } : {}) };
    if (!state) { out.push({ ...row, group: 'Podcast', programs: [], sourceStatus: 'loading', sourceError: 'loading podcast feed — refresh in a minute' }); continue; }
    if (!state.episodes.length) { out.push({ ...row, group: 'Podcast', programs: [], sourceStatus: 'upstream_error', sourceError: state.error ?? 'no playable episodes' }); continue; }
    const newest = state.episodes[0].publishedAt;
    const old = now.getTime() - newest > STALE_DAYS * 86_400_000;
    out.push({ ...row, logo: smallArtwork(state.imageUrl), group: old ? `Podcast · last episode ${shortDate(newest)}` : 'Podcast',
      programs: layout(toPrograms(state, guideId), 45, now, 120), sourceStatus: state.status === 'ok' ? 'ok' : 'partial', sourceError: state.error,
      rejected: state.rejected.length ? state.rejected : undefined });
  }
  return out;
}

export async function getPodcastChannels(guideId: string, layout: Parameters<typeof buildPodcastChannels>[2], now = new Date()): Promise<ScheduleChannel[]> {
  const p = ensureFresh(now);
  const all = PODCAST_SOURCES.filter((s) => s.enabled).every((s) => cache.get(s.id));
  if (!all) await Promise.race([p, new Promise((r) => setTimeout(r, FIRST_LOAD_WAIT_MS))]);
  return buildPodcastChannels(guideId, now, layout);
}


/* ---------------- Enclosure redirect resolver (explicit fallback) ----------------
 * Audio normally plays DIRECT from the enclosure URL, so the listener's browser walks the tracker chain
 * (podtrac -> pdst -> chrt -> mgln -> pscrb -> ... -> signed CDN URL). When a browser or network blocks one
 * of those tracker hosts the element fails at once (MediaError 4). The player then asks this server to
 * walk the SAME chain (so every tracker is still hit and downloads still count) and plays the signed CDN
 * URL directly. Only enclosure URLs we published ourselves can be resolved; the audio is never proxied. */
export function isKnownEnclosure(url: string): boolean {
  for (const st of cache.values()) if (st.episodes.some((e) => e.url === url)) return true;
  return false;
}
const resolved = new Map<string, { at: number; url: string; hops: string[] }>();
const RESOLVE_TTL_MS = 5 * 60_000;
export async function resolveEnclosure(url: string, fetchImpl?: typeof fetch): Promise<{ url: string; hosts: string[] }> {
  const hit = resolved.get(url);
  if (hit && Date.now() - hit.at < RESOLVE_TTL_MS) return { url: hit.url, hosts: hit.hops };
  const hosts: string[] = [];
  const { res, finalUrl } = await safeFetch(url, {
    allow: anyPublicHost, timeoutMs: 15_000, maxRedirects: 14, fetchImpl: fetchImpl ?? fetchImplForTests,
    headers: { 'User-Agent': 'AJN-Precision-Engineering/1.0 (podcast resolver)', Range: 'bytes=0-0' },
  });
  await res.body?.cancel().catch(() => {});
  if (!(res.status === 200 || res.status === 206)) throw new Error(`enclosure answered HTTP ${res.status}`);
  const ct = String(res.headers.get('content-type') ?? '');
  if (!/^audio\//i.test(ct) && !/octet-stream/i.test(ct)) throw new Error(`enclosure is not audio (${ct || 'no content-type'})`);
  hosts.push(finalUrl.hostname);
  resolved.set(url, { at: Date.now(), url: finalUrl.href, hops: hosts });
  return { url: finalUrl.href, hosts };
}
