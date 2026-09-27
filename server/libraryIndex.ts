/* Library index: one record per Archive item we have inspected and chosen a
 * playable file for. Two kinds of category:
 *  - search categories: fixed Archive collection queries. Built offline into a
 *    packaged snapshot (scripts/library-snapshot.ts -> src/data/libraryIndex.json)
 *    so a Cloud Run cold start makes no Archive calls; topped up at runtime one
 *    category an hour, a few new items at a time, through the shared limiter.
 *  - guide categories: taken from guides the server already builds (news,
 *    NASA/NOVA, documentaries, Rush) — no extra Archive calls.
 * Items are hidden only when a file check failed twice (unavailable) or no
 * web-playable file exists (unsupported). No Node APIs at import time. */
import type { Program, ScheduleChannel } from '../src/types';
import { selectPlayableFile, type LibraryAvailability, type DurationSource } from './archive/mediaSelector';
import { archiveApiFetch } from './archiveLimiter';
import { safeFetch } from './safeFetch';

export interface LibraryCategory { id: string; label: string; mediaType: 'video' | 'audio'; query?: string; guide?: { guideId: string; channels: (ch: ScheduleChannel) => boolean } }
export const LIBRARY_CATEGORIES: LibraryCategory[] = [
  { id: 'newsroom', label: 'Newsroom Feeds', mediaType: 'video', guide: { guideId: 'cable-tv', channels: () => true } },
  { id: 'aerospace', label: 'Aerospace & Science', mediaType: 'video', guide: { guideId: 'science-documentaries', channels: (c) => c.id === 'nasa-missions' || c.id === 'nova-wonders' } },
  { id: 'classic-cinema', label: 'Classic Cinema', mediaType: 'video', query: 'collection:feature_films AND mediatype:movies' },
  { id: 'silent-films', label: 'Silent Films', mediaType: 'video', query: 'collection:silent_films AND mediatype:movies' },
  { id: 'scifi-horror', label: 'Sci-Fi & Horror', mediaType: 'video', query: 'collection:SciFi_Horror AND mediatype:movies' },
  { id: 'classic-tv', label: 'Classic TV', mediaType: 'video', query: 'collection:classic_tv AND mediatype:movies' },
  { id: 'cartoons', label: 'Cartoons', mediaType: 'video', query: 'collection:classic_cartoons AND mediatype:movies' },
  { id: 'educational', label: 'Educational & Industrial', mediaType: 'video', query: 'collection:prelinger AND mediatype:movies' },
  { id: 'newsreels', label: 'Newsreels & Historical', mediaType: 'video', query: 'collection:newsandpublicaffairs AND mediatype:movies' },
  { id: 'documentaries', label: 'Documentaries', mediaType: 'video', guide: { guideId: 'science-documentaries', channels: (c) => c.id.startsWith('doc-') } },
  { id: 'old-time-radio', label: 'Old-Time Radio', mediaType: 'audio', query: 'collection:oldtimeradio AND mediatype:audio' },
  { id: 'audiobooks', label: 'Audiobooks', mediaType: 'audio', query: 'collection:librivoxaudio AND mediatype:audio' },
  { id: 'rush', label: 'Rush Limbaugh', mediaType: 'audio', guide: { guideId: 'audio-podcasts', channels: (c) => c.id === 'rush-on-this-day' } },
];
export const ITEMS_PER_SEARCH = 150;

export interface IndexRecord {
  id: string; identifier: string; title: string; description?: string;
  categoryIds: string[]; mediaType: 'video' | 'audio';
  year?: number; decade?: number;
  path: string; file: string; format: string;
  dur: number; durSrc: DurationSource | 'clip' | 'metadata'; durEst: boolean;
  availability: LibraryAvailability; foundBy: string; why: string; indexedAt: string;
  // guide items only: how to play them through the guide's own ids
  channelId?: string; guideId?: string; programId?: string;
}
export interface LibrarySnapshot { schemaVersion: 1; generatedAt: string; items: IndexRecord[] }

const yearOf = (v: unknown): number | undefined => { const m = /\b(1[89]\d\d|20\d\d)\b/.exec(String(v ?? '')); return m ? Number(m[1]) : undefined; };
const clean = (s: unknown, n = 240) => String(Array.isArray(s) ? s[0] : s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) || undefined;

/** Search result + item metadata -> index record (or an unsupported marker). */
export function recordFromMetadata(cat: LibraryCategory, doc: any, meta: any, now = new Date()): IndexRecord {
  const m = selectPlayableFile(doc.identifier, meta?.files, meta?.metadata?.runtime, cat.mediaType);
  const year = yearOf(doc.year) ?? yearOf(doc.date) ?? yearOf(meta?.metadata?.date) ?? yearOf(meta?.metadata?.year);
  return {
    id: `ia-${doc.identifier}`, identifier: doc.identifier,
    title: clean(doc.title ?? meta?.metadata?.title, 160) ?? doc.identifier, description: clean(meta?.metadata?.description ?? doc.description),
    categoryIds: [cat.id], mediaType: cat.mediaType, year, decade: year ? Math.floor(year / 10) * 10 : undefined,
    path: m.canonicalPath, file: m.filename, format: m.format, dur: m.durationSeconds, durSrc: m.durationSource, durEst: m.durationEstimated,
    availability: m.availability, foundBy: `${cat.id}: ${cat.query}`, why: m.selectedBecause, indexedAt: now.toISOString(),
  };
}

/** Same item found by two searches -> one record in both categories. */
export function mergeRecords(list: IndexRecord[]): IndexRecord[] {
  const byId = new Map<string, IndexRecord>();
  for (const r of list) {
    const cur = byId.get(r.id);
    if (!cur) { byId.set(r.id, { ...r, categoryIds: [...r.categoryIds] }); continue; }
    for (const c of r.categoryIds) if (!cur.categoryIds.includes(c)) cur.categoryIds.push(c);
  }
  return [...byId.values()];
}

export type LibrarySeriesCategory = 'cartoons' | 'classic-tv' | 'old-time-radio';

export interface SeriesSource {
  id: string;
  identifier: string;
  title: string;
  categoryIds: string[];
  mediaType: 'video' | 'audio';
  year?: number;
  decade?: number;
  path: string;
  format: string;
  dur: number;
  durEst: boolean;
  availability: string;
  description?: string;
  channelId?: string;
  guideId?: string;
  programId?: string;
}

export interface SeriesEpisode extends SeriesSource {
  episodeTitle: string;
  season?: number;
  episode?: number;
}

export interface LibrarySeries {
  type: 'series';
  id: string;
  groupKey: string;
  title: string;
  categoryIds: string[];
  mediaType: 'video' | 'audio';
  episodeCount: number;
  episodes: SeriesEpisode[];
  groupingMethod: 'separator-title';
}

export type LibraryResult = SeriesSource & { type: 'item' } | LibrarySeries;

const GROUPABLE = new Set<LibrarySeriesCategory>(['cartoons', 'classic-tv', 'old-time-radio']);

const clean = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim();
const norm = (s: string) => clean(s).toLocaleLowerCase().replace(/[’']/g, "'").replace(/\s*[-–—:]\s*/g, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

function separatorPrefix(title: string): { prefix: string; suffix: string } | null {
  const s = clean(title);
  if (/[\[\]{}()]/.test(s)) return null;
  if (/\b\d{1,2}:\d{2}(?::\d{2})?\b/.test(s)) return null;
  const m = /^(.{1,80}?)(?: - |: )(.+)$/.exec(s);
  if (!m) return null;
  const prefix = clean(m[1]);
  const suffix = clean(m[2]);
  const words = prefix.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 5 || suffix.length < 2) return null;
  if (/^(?:\d{4}|\d{1,4}\s+episodes?)$/i.test(suffix)) return null;
  if (/\b\d{1,2}:\d{2}(?::\d{2})?\b/.test(suffix)) return null;
  if (/\b\d{3,4}\s+episodes?\b/i.test(suffix)) return null;
  return { prefix, suffix };
}

function categoryFor(r: SeriesSource): LibrarySeriesCategory | undefined {
  for (const c of r.categoryIds) if (GROUPABLE.has(c as LibrarySeriesCategory)) return c as LibrarySeriesCategory;
  return undefined;
}

function episodeOrder(a: SeriesEpisode, b: SeriesEpisode) {
  return (a.season ?? 9999) - (b.season ?? 9999)
    || (a.episode ?? 9999) - (b.episode ?? 9999)
    || (a.year ?? 9999) - (b.year ?? 9999)
    || a.episodeTitle.localeCompare(b.episodeTitle)
    || a.identifier.localeCompare(b.identifier);
}

export function groupLibraryResults(rows: SeriesSource[]): LibraryResult[] {
  const groups = new Map<string, SeriesEpisode[]>();
  const singles: SeriesSource[] = [];
  for (const row of rows) {
    const category = categoryFor(row);
    const parsed = category ? separatorPrefix(row.title) : null;
    if (!category || !parsed) { singles.push(row); continue; }
    const key = category + ':' + norm(parsed.prefix);
    const episode: SeriesEpisode = { ...row, episodeTitle: parsed.suffix };
    const list = groups.get(key);
    if (list) list.push(episode); else groups.set(key, [episode]);
  }

  const grouped: LibraryResult[] = [...groups.entries()].flatMap(([groupKey, episodes]) => {
    if (episodes.length < 2) return episodes.map(({ episodeTitle: _episodeTitle, ...item }) => ({ ...item, type: 'item' as const }));
    episodes.sort(episodeOrder);
    const first = episodes[0];
    const categoryIds = [...new Set(episodes.flatMap((e) => e.categoryIds))];
    return [{
      type: 'series' as const,
      id: 'series-' + groupKey.replace(/[^a-z0-9:_-]+/gi, '-'),
      groupKey,
      title: separatorPrefix(episodes[0].title)?.prefix ?? clean(groupKey.slice(groupKey.indexOf(':') + 1)),
      categoryIds,
      mediaType: first.mediaType,
      episodeCount: episodes.length,
      episodes,
      groupingMethod: 'separator-title' as const,
    }];
  });

  return [...singles.map((r) => ({ ...r, type: 'item' as const })), ...grouped]
    .sort((a, b) => {
      const ay = a.type === 'series' ? a.episodes[0]?.year : a.year;
      const by = b.type === 'series' ? b.episodes[0]?.year : b.year;
      return (ay ?? 9999) - (by ?? 9999) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
    });
}

export function findLibrarySeries(rows: SeriesSource[], key: string): LibrarySeries | null {
  const result = groupLibraryResults(rows).find((r): r is LibrarySeries => r.type === 'series' && r.groupKey === key);
  return result ?? null;
}

/* ---------------- guide categories ---------------- */
const baseId = (id: string) => id.replace(/:d\d+$/, '');
export function recordsFromGuide(cat: LibraryCategory, channels: ScheduleChannel[], now = new Date()): IndexRecord[] {
  const out: IndexRecord[] = [];
  const seen = new Set<string>();
  for (const ch of channels) {
    if (!cat.guide!.channels(ch)) continue;
    for (const p of ch.programs ?? []) {
      const mt = (p.metadata ?? {}) as any;
      const path = p.archivePath || p.mediaUrl;
      const id = baseId(p.id);
      if (!path || mt.live || seen.has(id)) continue;
      seen.add(id);
      const secs = Number(mt.durationSeconds) || (p.endTimeUtc && p.startTimeUtc ? (Date.parse(p.endTimeUtc) - Date.parse(p.startTimeUtc)) / 1000 : 0);
      const year = yearOf(mt.year) ?? yearOf(mt.airedUtc) ?? yearOf(mt.date) ?? yearOf(/(\d{4}-\d{2}-\d{2})/.exec(p.id)?.[1]);
      out.push({
        id, identifier: String(mt.identifier ?? ''), title: p.title, description: clean(p.description) ?? ch.name,
        categoryIds: [cat.id], mediaType: p.mediaType === 'audio' ? 'audio' : 'video', year, decade: year ? Math.floor(year / 10) * 10 : undefined,
        path, file: String(mt.file ?? ''), format: String(mt.format ?? ''), dur: Math.round(secs) || 0,
        durSrc: mt.durationSource === 'default' ? 'default' : 'metadata', durEst: !!mt.durationEstimated,
        availability: 'unverified', foundBy: `${cat.id}: guide ${cat.guide!.guideId}/${ch.id}`, why: 'playing in the guide', indexedAt: now.toISOString(),
        channelId: ch.id, guideId: cat.guide!.guideId, programId: id,
      });
    }
  }
  return out;
}

/* ---------------- runtime state ---------------- */
let searchItems: IndexRecord[] = [];
let snapshotAt: string | null = null;
let guideItems = new Map<string, IndexRecord[]>();
let loaded: Promise<void> | null = null;
const probe = new Map<string, { fails: number; status: LibraryAvailability }>();
export const libraryIndexStats = { snapshotAt: null as string | null, searchItems: 0, guideItems: 0, refreshes: 0, lastRefresh: null as string | null, lastRefreshCategory: null as string | null, lastError: null as string | null, probed: 0, verified: 0, unavailable: 0 };

export function setLibraryIndexForTests(items: IndexRecord[] | null) { searchItems = items ?? []; loaded = Promise.resolve(); guideItems = new Map(); probe.clear(); }

export async function loadLibrarySnapshot(): Promise<void> {
  loaded ??= (async () => {
    try {
      const mod: any = await import('../src/data/libraryIndex.json');
      const snap = (mod.default ?? mod) as LibrarySnapshot;
      if (snap?.schemaVersion === 1 && Array.isArray(snap.items)) { searchItems = snap.items; snapshotAt = snap.generatedAt; }
    } catch (e: any) { libraryIndexStats.lastError = `snapshot: ${e?.message ?? e}`; }
    libraryIndexStats.snapshotAt = snapshotAt; libraryIndexStats.searchItems = searchItems.length;
  })();
  return loaded;
}

export function setGuideRecords(categoryId: string, records: IndexRecord[]) {
  if (records.length || !guideItems.get(categoryId)?.length) guideItems.set(categoryId, records); // keep last good
  libraryIndexStats.guideItems = [...guideItems.values()].reduce((n, l) => n + l.length, 0);
}

function availability(r: IndexRecord): LibraryAvailability { return probe.get(r.id)?.status ?? r.availability; }
function allRecords(): IndexRecord[] { return mergeRecords([...searchItems, ...[...guideItems.values()].flat()]); }
const visible = (r: IndexRecord) => { const a = availability(r); return a !== 'unavailable' && a !== 'unsupported' && !!r.path; };

export interface ItemsQuery { ids?: string[]; category?: string; decade?: number | null; q?: string; mediaType?: string; page?: number; limit?: number }
export function queryLibrary(qy: ItemsQuery) {
  const limit = Math.max(1, Math.min(Number(qy.limit) || 24, 48));
  const page = Math.max(1, Number(qy.page) || 1);
  const q = String(qy.q ?? '').trim().toLowerCase();
  let rows = allRecords().filter(visible);
  if (qy.ids) { const want = new Set(qy.ids); rows = rows.filter((r) => want.has(r.id)); }
  if (qy.category) rows = rows.filter((r) => r.categoryIds.includes(qy.category!));
  if (qy.decade !== undefined && qy.decade !== null) rows = rows.filter((r) => (qy.decade === 0 ? r.decade === undefined : r.decade === qy.decade));
  if (qy.mediaType === 'video' || qy.mediaType === 'audio') rows = rows.filter((r) => r.mediaType === qy.mediaType);
  if (q) rows = rows.filter((r) => r.title.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q) || r.identifier.toLowerCase().includes(q));
  const grouped = groupLibraryResults(rows);
  const totalItems = grouped.length;
  return { snapshotAt, page, limit, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / limit)),
    rawCount: rows.length, uniqueCount: rows.length, groupCount: grouped.filter((r) => r.type === 'series').length,
    items: grouped.slice((page - 1) * limit, page * limit).map((r) => r.type === 'series' ? r : { ...r, availability: availability(r), playbackMode: 'vod' as const }) };
}

export function getLibrarySeries(groupKey: string): LibrarySeries | null {
  return findLibrarySeries(allRecords().filter(visible), groupKey);
}

export function libraryHeatmap() {
  const rows = allRecords().filter(visible);
  return {
    snapshotAt,
    categories: LIBRARY_CATEGORIES.map((c) => {
      const inCat = rows.filter((r) => r.categoryIds.includes(c.id));
      const byDecade = new Map<number, number>();
      for (const r of inCat) byDecade.set(r.decade ?? 0, (byDecade.get(r.decade ?? 0) ?? 0) + 1);
      return { categoryId: c.id, label: c.label, mediaType: c.mediaType, total: inCat.length,
        decades: [...byDecade].map(([decade, count]) => ({ decade, count })).sort((a, b) => (a.decade || 99999) - (b.decade || 99999)) };
    }),
  };
}

/* ---------------- background: file checks + hourly top-up ---------------- */
let probeFetch: typeof fetch | undefined;
export function setLibraryProbeFetchForTests(f?: typeof fetch) { probeFetch = f; }
const archiveHost = (h: string) => h === 'archive.org' || h.endsWith('.archive.org');

/** Read the first 2 bytes of the chosen file. 2 failures (403/404/410) -> unavailable. */
export async function probeRecord(r: IndexRecord): Promise<LibraryAvailability> {
  if (!r.path.startsWith('/download/')) return availability(r);
  const st = probe.get(r.id) ?? { fails: 0, status: r.availability };
  try {
    const { res } = await safeFetch(`https://archive.org${r.path.split('?')[0]}`, { allow: archiveHost, timeoutMs: 15_000, fetchImpl: probeFetch, headers: { Range: 'bytes=0-1', 'User-Agent': 'AJN-Precision-Engineering/LibraryCheck' } });
    const ct = res.headers.get('content-type') ?? '';
    await res.body?.cancel().catch(() => {});
    if ((res.status === 206 || res.status === 200) && !/text\/html/i.test(ct)) { st.fails = 0; st.status = 'verified'; }
    else if ([401, 403, 404, 410].includes(res.status)) { st.fails++; if (st.fails >= 2) st.status = 'unavailable'; }
  } catch { /* network trouble on our side: no verdict */ }
  probe.set(r.id, st);
  libraryIndexStats.probed = probe.size;
  libraryIndexStats.verified = [...probe.values()].filter((p) => p.status === 'verified').length;
  libraryIndexStats.unavailable = [...probe.values()].filter((p) => p.status === 'unavailable').length;
  return st.status;
}

let metaFetch: typeof fetch = archiveApiFetch;
export function setLibraryMetaFetchForTests(f?: typeof fetch) { metaFetch = f ?? archiveApiFetch; }
export const searchUrl = (c: LibraryCategory, rows = ITEMS_PER_SEARCH) =>
  `https://archive.org/advancedsearch.php?q=${encodeURIComponent(c.query!)}&fl[]=identifier&fl[]=title&fl[]=date&fl[]=year&fl[]=description&rows=${rows}&page=1&sort[]=downloads+desc&output=json`;

/** Re-run one category's search; inspect up to `maxNew` identifiers not yet indexed. */
export async function topUpCategory(c: LibraryCategory, maxNew = 15): Promise<number> {
  const r = await metaFetch(searchUrl(c), { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`${c.id} search HTTP ${r.status}`);
  const docs: any[] = (await r.json())?.response?.docs ?? [];
  const known = new Set(searchItems.map((x) => x.identifier));
  const fresh = docs.filter((d) => typeof d?.identifier === 'string' && !known.has(d.identifier)).slice(0, maxNew);
  const added: IndexRecord[] = [];
  for (const d of fresh) {
    try {
      const mr = await metaFetch(`https://archive.org/metadata/${encodeURIComponent(d.identifier)}`, { signal: AbortSignal.timeout(30_000) });
      if (!mr.ok) continue;
      const meta = await mr.json();
      if (meta?.is_dark) continue;
      added.push(recordFromMetadata(c, d, meta));
    } catch { /* skip this one */ }
  }
  // existing items found again by this search join the category too
  const docIds = new Set(docs.map((d) => d.identifier));
  searchItems = mergeRecords([...searchItems.map((x) => (docIds.has(x.identifier) && !x.categoryIds.includes(c.id) ? { ...x, categoryIds: [...x.categoryIds, c.id] } : x)), ...added]);
  libraryIndexStats.searchItems = searchItems.length;
  return added.length;
}

let timers: ReturnType<typeof setInterval>[] = [];
let nextCat = 0;
export function startLibraryBackground(opts: { probeEveryMs?: number; topUpEveryMs?: number } = {}) {
  if (timers.length) return;
  const probeEvery = opts.probeEveryMs ?? 5000, topUpEvery = opts.topUpEveryMs ?? 3600_000;
  let cursor = 0;
  timers.push(setInterval(() => {
    const list = allRecords().filter((r) => r.path.startsWith('/download/') && !probe.has(r.id) && r.availability === 'unverified');
    const pending = list.length ? list : allRecords().filter((r) => probe.get(r.id)?.status === 'unverified' || (probe.get(r.id)?.fails ?? 0) === 1);
    if (!pending.length) return;
    void probeRecord(pending[cursor++ % pending.length]);
  }, probeEvery));
  timers.push(setInterval(() => {
    const searchCats = LIBRARY_CATEGORIES.filter((c) => c.query);
    const c = searchCats[nextCat++ % searchCats.length];
    topUpCategory(c).then((n) => { libraryIndexStats.refreshes++; libraryIndexStats.lastRefresh = new Date().toISOString(); libraryIndexStats.lastRefreshCategory = `${c.id} (+${n})`; })
      .catch((e) => { libraryIndexStats.lastError = String(e?.message ?? e); });
  }, topUpEvery));
  for (const t of timers) (t as any)?.unref?.();
}
