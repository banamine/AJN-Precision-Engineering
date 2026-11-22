/* On Air backfill pool: the REAL clips the playout may use when a show has no fresh episode.
 *  - news: short clips cut from the Library TV-news recordings (the same clip windows the Cable TV guide plays), per news channel
 *  - long: full-length Infowars-family material (channels "INFO WARS SURVIVAL", "INFOWARS NIGHTLY NEWS", "NEW WORLD TYRANNY") from the channel manifest
 *  - quash: The Quash back-catalog (Archive episodes with Archive's own durations)
 * Nothing is invented: a group that cannot be built is reported as missing, never replaced. Pure functions; the route lives in server.ts. */
import { buildArchiveProxyUrl } from '../src/utils/archivePlayback';
import type { Program, ScheduleChannel } from '../src/types';

export interface FillClip {
  kind: 'news' | 'long' | 'quash';
  channelId: string; channel: string; showId: string; title: string;
  src: string; startSec: number; durSec: number;
  /** YYYY-MM-DD of the recording when known (never today's date by default). */
  clipDate: string | null;
}
export interface FillerPool {
  schemaVersion: 1; builtAt: string; news: FillClip[]; long: FillClip[]; quash: FillClip[];
  /** Plain-words problems: a wanted channel with no clips, an empty group. */
  missing: string[];
}

/** News channels, matched by the name the guide shows. 045 (Taiwan CTV, Mandarin) is excluded here: see EXCLUDED_NEWS. */
export const NEWS_CHANNEL_NAMES = ['CBC News', 'CNN', 'DW News', 'Fox News', 'France 24', 'KPIX CBS', 'MS NOW', 'RT', 'TRT World'];
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

export function buildFillerPool(input: { scheduleChannels: readonly ScheduleChannel[]; manifest: { channels: { id: string; name: string; rows: ManifestRow[] }[] }; quashPrograms: readonly Program[]; now?: Date; newsMaxAgeDays?: number }): FillerPool {
  const n = newsClips(input.scheduleChannels, input.now ?? new Date(), input.newsMaxAgeDays ?? NEWS_MAX_AGE_DAYS), l = longClips(input.manifest), q = quashClips(input.quashPrograms);
  return { schemaVersion: 1, builtAt: (input.now ?? new Date()).toISOString(), news: n.clips, long: l.clips, quash: q.clips, missing: [...n.missing, ...l.missing, ...q.missing] };
}
