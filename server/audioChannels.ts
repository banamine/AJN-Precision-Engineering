/* Audio & Podcasts channels — two separate collections, two separate rules:
 *  - Rush Limbaugh — On This Day: from the Rush master index (rushIndex.json),
 *    today's month/day across 2005-2017, hours in order, looped 24/7.
 *  - Old-Time Radio: authentic OTR from Archive's oldtimeradio collection,
 *    randomized, preferring broadcasts dated nearest today's month/day.
 * Both resolve MP3 files just in time through the shared Archive limiter. */
import type { Program } from '../src/types';
import { archiveApiFetch } from './archiveLimiter';
import { rushIndex, resolveRushItem as resolveAudioItem, type RushIndexEntry, type RushTrack } from './rush';

const RUSH_EPISODES = 8;
const OTR_ITEMS = 10;
const OTR_FILES_PER_ITEM = 4;
const CONCURRENCY = 2;

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

/** Circular day-of-year distance between an ISO date and today (month/day only). */
export function dayDistance(isoDate: string, now: Date): number {
  const m = isoDate.match(/^\d{4}-(\d{2})-(\d{2})/);
  if (!m) return Infinity;
  const doy = (mo: number, d: number) => Math.floor((Date.UTC(2001, mo - 1, d) - Date.UTC(2001, 0, 1)) / 86400000);
  const a = doy(+m[1], +m[2]); const b = doy(now.getUTCMonth() + 1, now.getUTCDate());
  const diff = Math.abs(a - b); return Math.min(diff, 365 - diff);
}

function trackProgram(t: RushTrack, o: { guideId: string; channelId: string; title: string; description: string; id: string }): Program {
  return {
    id: o.id, guideId: o.guideId, channelId: o.channelId, title: o.title, description: o.description,
    startTime: 0, endTime: 0, mediaType: 'audio', mediaUrl: t.archivePath, archivePath: t.archivePath,
    sourceClass: 'archive_org', isArchivedSource: true,
    metadata: { durationSeconds: Math.round(t.durationSeconds), durationSource: 'metadata', file: t.file },
  } as Program;
}

/** Rush — On This Day: same month/day in every year, nearest dates as fill. */
export function pickRushEpisodes(index: RushIndexEntry[], now: Date, n = RUSH_EPISODES): RushIndexEntry[] {
  return [...index]
    .map((e) => ({ e, d: dayDistance(e.date, now) }))
    .sort((a, b) => a.d - b.d || a.e.date.localeCompare(b.e.date))
    .slice(0, n).map((x) => x.e)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function buildRushChannel(guideId: string, now = new Date()): Promise<Program[]> {
  const eps = pickRushEpisodes(rushIndex, now);
  const resolved = await pool(eps, CONCURRENCY, (e) => resolveAudioItem(e.id).then((r) => ({ e, r })).catch(() => null));
  const programs: Program[] = [];
  for (const x of resolved) {
    if (!x) continue;
    x.r.tracks.forEach((t, h) => programs.push(trackProgram(t, {
      guideId, channelId: 'rush-on-this-day', id: `rush-${x.e.date}-h${h + 1}`,
      title: `Rush Limbaugh — ${x.e.date} (Hour ${h + 1})`, description: `The Rush Limbaugh Show, ${x.e.date}`,
    })));
  }
  return programs;
}

/** Old-Time Radio: dated items nearest today first, shuffled, random files per item. */
export async function buildOtrChannel(guideId: string, now = new Date(), fetchImpl: typeof fetch = archiveApiFetch, rand = Math.random): Promise<Program[]> {
  const q = 'collection:oldtimeradio AND mediatype:audio';
  const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&fl[]=date&rows=300&sort[]=downloads+desc&output=json`;
  const r = await fetchImpl(url);
  if (!r.ok) throw new Error(`OTR search HTTP ${r.status}`);
  const docs: Array<{ identifier: string; title?: string; date?: string }> = (await r.json())?.response?.docs ?? [];
  const shuffled = docs.map((d) => ({ d, k: rand() })).sort((a, b) => a.k - b.k).map((x) => x.d);
  const dated = shuffled.filter((d) => Number.isFinite(dayDistance(String(d.date ?? ''), now)))
    .sort((a, b) => dayDistance(String(a.date), now) - dayDistance(String(b.date), now));
  const picked = [...dated.slice(0, OTR_ITEMS / 2), ...shuffled.filter((d) => !dated.slice(0, OTR_ITEMS / 2).includes(d))].slice(0, OTR_ITEMS);
  const resolved = await pool(picked, CONCURRENCY, (d) => resolveAudioItem(d.identifier).then((x) => ({ d, x })).catch(() => null));
  const programs: Program[] = [];
  for (const it of resolved) {
    if (!it) continue;
    const files = it.x.tracks.map((t) => ({ t, k: rand() })).sort((a, b) => a.k - b.k).slice(0, OTR_FILES_PER_ITEM).map((y) => y.t);
    for (const t of files) {
      const name = t.file.split('/').pop()!.replace(/\.mp3$/i, '').replace(/[_]+/g, ' ').trim();
      programs.push(trackProgram(t, {
        guideId, channelId: 'old-time-radio', id: `otr-${it.d.identifier}-${t.file}`,
        title: name, description: String(it.d.title ?? it.d.identifier),
      }));
    }
  }
  // Interleave shows so the loop doesn't play one series back to back.
  return programs.map((p) => ({ p, k: rand() })).sort((a, b) => a.k - b.k).map((x) => x.p);
}
