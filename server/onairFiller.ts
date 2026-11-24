/* On Air backfill pool: the REAL clips the playout may use when a show has no fresh episode.
 *  - news: short clips cut from the Library TV-news recordings (the same clip windows the Cable TV guide plays), per news channel
 *  - long: full-length Infowars-family material (channels "INFO WARS SURVIVAL", "INFOWARS NIGHTLY NEWS", "NEW WORLD TYRANNY") from the channel manifest
 *  - quash: The Quash back-catalog (Archive episodes with Archive's own durations)
 * Nothing is invented: a group that cannot be built is reported as missing, never replaced. Pure functions; the route lives in server.ts. */
import { buildArchiveProxyUrl } from '../src/utils/archivePlayback';
import type { Program, ScheduleChannel } from '../src/types';

export interface FillClip {
  kind: 'news' | 'long' | 'quash' | 'talk' | 'harvey' | 'rush' | 'ajfresh';
  channelId: string; channel: string; showId: string; title: string;
  src: string; startSec: number; durSec: number;
  /** YYYY-MM-DD of the recording when known (never today's date by default). */
  clipDate: string | null;
}
export interface FillerPool {
  schemaVersion: 1; builtAt: string; news: FillClip[]; long: FillClip[]; quash: FillClip[];
  /** Talk archive reels (Coast to Coast, Long John Nebel, New World Order 1969): long shows played on the programming clock. */
  talk?: FillClip[];
  /** Paul Harvey "The Rest of the Story" shorts (about 4 min each). */
  harvey?: FillClip[];
  /** Rush Limbaugh hours with today's month/day, one file per hour, several years. */
  rush?: FillClip[];
  /** Current Alex Jones shows from the AJN feed (last few days, newest first). The evening plays these; days and afternoons play the archive. */
  ajfresh?: FillClip[];
  /** Plain-words problems: a wanted channel with no clips, an empty group. */
  missing: string[];
}

/** News channels, matched by the name the guide shows. 045 (Taiwan CTV, Mandarin) is excluded here: see EXCLUDED_NEWS. */
export const NEWS_CHANNEL_NAMES = ['Al Jazeera English', 'BBC News', 'CBC News', 'CNN', 'DW News', 'Fox News', 'France 24', 'KPIX CBS', 'MS NOW', 'RT', 'TRT World'];
export const EXCLUDED_NEWS = ['CTV News'];
export const LONG_CHANNEL_IDS: { id: string; label: string }[] = [
  { id: 'ajn-infowars-survival', label: 'INFO WARS SURVIVAL' },
  { id: 'ajn-infowars-nightly-news', label: 'INFOWARS NIGHTLY NEWS' },
  { id: 'ajn-new-world-tyranny', label: 'NEW WORLD TYRANNY' },
];
const NEWS_PER_CHANNEL = 30, LONG_PER_CHANNEL = 60;
/** Build 18: a news clip older than this (by its real recording date) is never used as "news". Undated clips cannot be proven fresh and are skipped too. */
export const NEWS_MAX_AGE_DAYS = 7;
const NEWS_MIN_SEC = 60, NEWS_MAX_SEC = 600;
const LONG_MIN_SEC = 900, LONG_MAX_SEC = 14_400;

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Evenly spread pick of up to n items, so the pool covers the whole list, not just its first entries. */
export function spread<T>(items: readonly T[], n: number): T[] {
  if (items.length <= n) return [...items];
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(items[Math.floor((i * items.length) / n)]);
  return out;
}

/** A recording date from a title or file name: 20141015, 2014-10-15 or 2014_10_15. Null when none is present. */
export function dateFromText(s: string): string | null {
  const m = s.match(/(?:^|[^0-9])((?:19|20)\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])(?:[^0-9]|$)/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export function newsClips(channels: readonly ScheduleChannel[], now: Date = new Date(), maxAgeDays: number = NEWS_MAX_AGE_DAYS): { clips: FillClip[]; missing: string[] } {
  const wanted = new Map(NEWS_CHANNEL_NAMES.map((n) => [norm(n), n]));
  const oldestOk = now.getTime() - maxAgeDays * 86_400_000;
  const clips: FillClip[] = []; const found = new Set<string>(); const stale = new Map<string, string>(); // label -> newest date seen when nothing was fresh
  for (const ch of channels) {
    const label = wanted.get(norm(ch.name));
    if (!label) continue;
    const rows: FillClip[] = []; let newestSeen = '';
    for (const p of ch.programs ?? []) {
      const md = (p.metadata ?? {}) as { clip?: { start?: number; end?: number }; durationSeconds?: number; airedUtc?: string };
      const start = md.clip?.start, end = md.clip?.end;
      if (typeof start !== 'number' || typeof end !== 'number' || !(end > start) || !p.mediaUrl) continue;
      const dur = end - start;
      if (dur < NEWS_MIN_SEC || dur > NEWS_MAX_SEC) continue;
      const airedMs = md.airedUtc ? Date.parse(md.airedUtc) : NaN;
      const aired = Number.isFinite(airedMs) ? new Date(airedMs).toISOString().slice(0, 10) : null;
      if (aired && aired > newestSeen) newestSeen = aired;
      if (!Number.isFinite(airedMs) || airedMs < oldestOk) continue; // old or undated: not news
      rows.push({ kind: 'news', channelId: ch.id, channel: label, showId: `news-${norm(label).replace(/ /g, '-')}`, title: p.title, src: p.mediaUrl, startSec: start, durSec: dur, clipDate: aired });
    }
    rows.sort((a, b) => (b.clipDate ?? '').localeCompare(a.clipDate ?? ''));
    if (rows.length) { found.add(label); clips.push(...spread(rows, NEWS_PER_CHANNEL)); } else stale.set(label, newestSeen);
  }
  const missing = NEWS_CHANNEL_NAMES.filter((n) => !found.has(n)).map((n) => (stale.has(n) ? `news channel "${n}": no clips from the last ${maxAgeDays} days (newest in the guide: ${stale.get(n) || 'undated'})` : `news channel "${n}": no usable clips in the guide`));
  return { clips, missing };
}

interface ManifestRow { identifier?: string; file?: string; title?: string; durationSeconds?: number }
export function longClips(manifest: { channels: { id: string; name: string; rows: ManifestRow[] }[] }): { clips: FillClip[]; missing: string[] } {
  const clips: FillClip[] = []; const missing: string[] = [];
  for (const want of LONG_CHANNEL_IDS) {
    const ch = manifest.channels.find((c) => c.id === want.id);
    const rows = (ch?.rows ?? []).filter((r) => r.identifier && r.file && typeof r.durationSeconds === 'number' && r.durationSeconds >= LONG_MIN_SEC && r.durationSeconds <= LONG_MAX_SEC);
    if (!rows.length) { missing.push(`long channel "${want.label}": no files of 15 min to 4 h in the manifest`); continue; }
    for (const r of spread(rows, LONG_PER_CHANNEL)) {
      const archivePath = `/download/${encodeURIComponent(r.identifier as string)}/${(r.file as string).split('/').map(encodeURIComponent).join('/')}`;
      clips.push({ kind: 'long', channelId: want.id, channel: want.label, showId: want.id, title: r.title ?? (r.file as string), src: buildArchiveProxyUrl(archivePath), startSec: 0, durSec: Math.round(r.durationSeconds as number), clipDate: dateFromText(`${r.title ?? ''} ${r.file ?? ''}`) });
    }
  }
  return { clips, missing };
}

export function quashClips(programs: readonly Program[]): { clips: FillClip[]; missing: string[] } {
  const clips: FillClip[] = [];
  for (const p of programs) {
    const dur = Number((p.metadata as { durationSeconds?: number } | undefined)?.durationSeconds);
    if (!p.archivePath || !(dur >= 300)) continue;
    clips.push({ kind: 'quash', channelId: 'pod-quash', channel: 'The Quash', showId: 'quash', title: p.title, src: buildArchiveProxyUrl(p.archivePath), startSec: 0, durSec: Math.round(dur), clipDate: null });
  }
  return { clips, missing: clips.length ? [] : ['The Quash: no back-catalog episodes with a known length'] };
}

/** Talk Radio archive shows from the Audio & Podcasts guide, matched by channel id. The guide repeats a file through its day, so rows are de-duplicated by archive path. */
const TALK_SOURCES: { match: (id: string) => boolean; kind: 'talk' | 'harvey' | 'rush'; label: string }[] = [
  { match: (id) => id.startsWith('otr-coast-2-coast'), kind: 'talk', label: 'Coast to Coast AM' },
  { match: (id) => id === 'long-john-nebel', kind: 'talk', label: 'Long John Nebel' },
  { match: (id) => id.startsWith('nwt-audio-new-world-order-exposed'), kind: 'talk', label: 'New World Order Exposed (1969)' },
  { match: (id) => id === 'otr-paul-harvey-trots-23', kind: 'harvey', label: 'Paul Harvey · The Rest of the Story' },
  { match: (id) => id === 'rush-on-this-day', kind: 'rush', label: 'Rush Limbaugh' },
];
const TALK_MIN_SEC = 600, HARVEY_MIN_SEC = 60, HARVEY_MAX_SEC = 900;
export function audioClips(channels: readonly ScheduleChannel[]): { talk: FillClip[]; harvey: FillClip[]; rush: FillClip[]; missing: string[] } {
  const out = { talk: [] as FillClip[], harvey: [] as FillClip[], rush: [] as FillClip[] };
  const seen = new Set<string>(); const found = new Set<string>();
  for (const ch of channels) {
    const src = TALK_SOURCES.find((t) => t.match(ch.id));
    if (!src) continue;
    for (const p of ch.programs ?? []) {
      const dur = Number((p.metadata as { durationSeconds?: number } | undefined)?.durationSeconds);
      if (!p.archivePath || !(dur > 0)) continue;
      if (src.kind === 'talk' && dur < TALK_MIN_SEC) continue;
      if (src.kind === 'harvey' && (dur < HARVEY_MIN_SEC || dur > HARVEY_MAX_SEC)) continue;
      const key = `${src.kind}|${p.archivePath}`;
      if (seen.has(key)) continue;
      seen.add(key); found.add(src.label);
      out[src.kind].push({ kind: src.kind, channelId: ch.id, channel: src.label, showId: ch.id, title: p.title, src: buildArchiveProxyUrl(p.archivePath), startSec: 0, durSec: Math.round(dur), clipDate: src.kind === 'rush' ? dateFromText(p.title) : null });
    }
  }
  out.rush.sort((a, b) => (a.clipDate ?? '').localeCompare(b.clipDate ?? '') || a.title.localeCompare(b.title));
  const missing = TALK_SOURCES.map((t) => t.label).filter((l, i, a) => a.indexOf(l) === i && !found.has(l)).map((l) => `talk source "${l}": nothing usable in the Audio & Podcasts guide`);
  return { ...out, missing };
}

/** "HH:MM:SS", "MM:SS" or plain seconds (itunes:duration) to seconds; 0 when unknown. */
export function parseDurationSec(v: string | undefined): number {
  if (!v) return 0;
  const parts = v.trim().split(':').map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return 0;
  return parts.reduce((a, n) => a * 60 + n, 0);
}
export interface AjnFeedItemLike { id: string; title: string; url: string; publishedAt?: string; duration?: string }
export const AJFRESH_MAX_AGE_DAYS = 4, AJFRESH_MIN_SEC = 900, AJFRESH_MAX_SEC = 14_400;
/** Current whole shows from the AJN feed. Only files on a host the AJN proxy serves (`proxyUrl` returns null otherwise), with a real published date and a real length. */
export function ajnFreshClips(items: readonly AjnFeedItemLike[], now: Date, proxyUrl: (url: string) => string | null, maxAgeDays: number = AJFRESH_MAX_AGE_DAYS): FillClip[] {
  const oldestOk = now.getTime() - maxAgeDays * 86_400_000;
  const out: FillClip[] = []; const seen = new Set<string>();
  for (const it of items) {
    const pub = it.publishedAt ? Date.parse(it.publishedAt) : NaN;
    const dur = parseDurationSec(it.duration);
    if (!Number.isFinite(pub) || pub < oldestOk || pub > now.getTime() + 3_600_000) continue;
    if (dur < AJFRESH_MIN_SEC || dur > AJFRESH_MAX_SEC) continue;
    const src = proxyUrl(it.url);
    if (!src || seen.has(it.url)) continue;
    seen.add(it.url);
    out.push({ kind: 'ajfresh', channelId: 'ajn-feed-alex', channel: 'The Alex Jones Show', showId: 'ajn-feed-alex', title: it.title, src, startSec: 0, durSec: Math.round(dur), clipDate: new Date(pub).toISOString().slice(0, 10) });
  }
  return out.sort((a, b) => (b.clipDate ?? '').localeCompare(a.clipDate ?? '') || b.title.localeCompare(a.title));
}

export function buildFillerPool(input: { scheduleChannels: readonly ScheduleChannel[]; manifest: { channels: { id: string; name: string; rows: ManifestRow[] }[] }; quashPrograms: readonly Program[]; audioChannels?: readonly ScheduleChannel[]; ajnFresh?: readonly FillClip[]; now?: Date; newsMaxAgeDays?: number }): FillerPool {
  const n = newsClips(input.scheduleChannels, input.now ?? new Date(), input.newsMaxAgeDays ?? NEWS_MAX_AGE_DAYS), l = longClips(input.manifest), q = quashClips(input.quashPrograms);
  const a = audioClips(input.audioChannels ?? []);
  return { schemaVersion: 1, builtAt: (input.now ?? new Date()).toISOString(), news: n.clips, long: l.clips, quash: q.clips, talk: a.talk, harvey: a.harvey, rush: a.rush, ajfresh: [...(input.ajnFresh ?? [])], missing: [...n.missing, ...l.missing, ...q.missing, ...(input.audioChannels ? a.missing : [])] };
}
