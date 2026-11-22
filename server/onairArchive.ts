// "From the Archive · On This Day": real items from the usgovernmentmirrors collections whose `date` falls on today's Denver month/day in an earlier year.
// Honesty rules: `date` only (never `publicdate`, which is the upload date); Jan 1 is skipped (Archive.org stores year-only dates as YYYY-01-01);
// every field comes from Archive.org; an empty result is never reported as a success. Pure helpers are exported for tests.
export interface ArchiveItem {
  identifier: string; title: string; collection: string; collectionName: string; date: string; year: number;
  mediatype: 'texts' | 'audio' | 'movies'; downloads: number; thumbnail: string; url: string;
}
export interface OnThisDayFeed {
  generatedFor: string; generatedAt: string; source: string; yearsQueried: number; yearErrors: number; count: number; items: ArchiveItem[]; skipped?: string;
}
export interface LibraryCollection { identifier: string; name: string }

const MEDIA = ['texts', 'audio', 'movies'] as const;
const GENERIC_COLLECTIONS = new Set(['usgovernmentmirrors', 'government-documents']);
const ACRONYMS = new Set(['CIA', 'FBI', 'NSA', 'NASA', 'JFK', 'USSR', 'USA', 'US', 'U.S.', 'UN', 'DOD', 'DOE', 'FOIA', 'UFO', 'AEC', 'ONI', 'DIA', 'NATO', 'KGB', 'OSS', 'DC', 'II', 'III', 'IV', 'VI', 'VII', 'VIII']);
export const YEARS_PER_QUERY = 10; // the advancedsearch URL limit is ~2.5 KB; 30 years worked, 40 did not. 10 keeps big years from crowding out others.

export const dayOfYearOk = (mmdd: string, year: number): boolean => {
  const [m, d] = mmdd.split('-').map(Number);
  const dt = new Date(Date.UTC(year, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d; // false for Feb 29 in a non-leap year
};
export const isJan1 = (mmdd: string): boolean => mmdd === '01-01';
export const isRealFullDate = (s: unknown): boolean => /^\d{4}-\d{2}-\d{2}/.test(String(s ?? ''));
export const isPlaceholderDate = (s: unknown): boolean => isRealFullDate(s) && String(s).slice(5, 10) === '01-01';

export function denverMMDD(d: Date = new Date()): { mmdd: string; year: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', month: '2-digit', day: '2-digit', year: 'numeric' }).formatToParts(d).map((x) => [x.type, x.value]));
  return { mmdd: `${p.month}-${p.day}`, year: Number(p.year) };
}

export function sentenceCase(t: string): string {
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length < 6) return t;
  if (letters.replace(/[^A-Z]/g, '').length / letters.length < 0.8) return t; // already mixed case
  const words = t.toLowerCase().split(/([\s-]+)/).map((w) => (ACRONYMS.has(w.replace(/[^a-z.]/g, '').toUpperCase()) ? w.toUpperCase() : w)).join('');
  return words.replace(/(^|[a-z]{3}[.!?]\s+)([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
}

export function cleanTitle(raw: unknown, max = 110): string {
  let t = String(raw ?? '').replace(/\s+/g, ' ').trim();
  t = t.replace(/^CIA Reading Room\s+\S+:\s*/i, '')
    .replace(/^DTIC\s+[A-Z]{2,3}\d+:\s*/, '')
    .replace(/^NASA Technical Reports Server \(NTRS\)\s+\d+:\s*/i, '')
    .replace(/^.{0,80}?\b[a-z0-9]+(?:-[a-z0-9]+){2,}:\s+/i, '')
    .replace(/^\(?(sanitized|approved for release)[^)]*\)?\s*/i, '')
    .trim();
  t = sentenceCase(t);
  if (t.length > max) t = t.slice(0, max).replace(/\s+\S*$/, '') + '…';
  if (t.length < 8 || !/[A-Za-z]{3}/.test(t)) return '';
  return t;
}

interface RawDoc { identifier?: string; title?: string; date?: string; collection?: string | string[]; mediatype?: string; downloads?: number | string }

export function toCandidate(doc: RawDoc, libById: Map<string, LibraryCollection>): ArchiveItem | null {
  if (!isRealFullDate(doc.date) || isPlaceholderDate(doc.date)) return null;
  if (!(MEDIA as readonly string[]).includes(String(doc.mediatype))) return null;
  const cols = ([] as string[]).concat(doc.collection ?? []).filter(Boolean);
  const col = cols.find((c) => libById.has(c) && !GENERIC_COLLECTIONS.has(c)) ?? cols.find((c) => !GENERIC_COLLECTIONS.has(c));
  const title = cleanTitle(doc.title);
  if (!title || !col || !doc.identifier) return null;
  const date = String(doc.date).slice(0, 10);
  return {
    identifier: doc.identifier, title, collection: col, collectionName: libById.get(col)?.name ?? col.replace(/[-_]+/g, ' ').trim(), // items in the mirror's other sub-collections keep a readable id
    date, year: Number(date.slice(0, 4)), mediatype: doc.mediatype as ArchiveItem['mediatype'], downloads: Number(doc.downloads) || 0,
    thumbnail: `https://archive.org/services/img/${encodeURIComponent(doc.identifier)}`, url: `https://archive.org/details/${encodeURIComponent(doc.identifier)}`,
  };
}

/** Up to `max` items: round-robin across collections (each by downloads desc), at most `perYear` per year, deterministic; newest year first. */
export function selectItems(cands: ArchiveItem[], { max = 12, perYear = 2 }: { max?: number; perYear?: number } = {}): ArchiveItem[] {
  const byCol = new Map<string, ArchiveItem[]>();
  for (const c of [...cands].sort((a, b) => b.downloads - a.downloads || a.identifier.localeCompare(b.identifier))) {
    if (!byCol.has(c.collection)) byCol.set(c.collection, []);
    byCol.get(c.collection)!.push(c);
  }
  const cols = [...byCol.keys()].sort();
  const yearCount = new Map<number, number>(); const out: ArchiveItem[] = [];
  let progressed = true;
  while (out.length < max && progressed) {
    progressed = false;
    for (const col of cols) {
      if (out.length >= max) break;
      const q = byCol.get(col)!;
      while (q.length) {
        const c = q.shift()!;
        if ((yearCount.get(c.year) ?? 0) >= perYear) continue;
        yearCount.set(c.year, (yearCount.get(c.year) ?? 0) + 1);
        out.push(c); progressed = true; break;
      }
    }
  }
  return out.sort((a, b) => b.year - a.year || a.identifier.localeCompare(b.identifier));
}

export function chunkQueryUrl(years: number[], mmdd: string): string {
  const ranges = years.map((y) => `date:[${y}-${mmdd}T00:00:00Z TO ${y}-${mmdd}T23:59:59Z]`).join(' OR ');
  const q = `collection:usgovernmentmirrors AND mediatype:(${MEDIA.join(' OR ')}) AND (${ranges})`;
  return 'https://archive.org/advancedsearch.php?q=' + encodeURIComponent(q)
    + ['identifier', 'title', 'date', 'collection', 'mediatype', 'downloads'].map((f) => `&fl%5B%5D=${f}`).join('')
    + '&sort%5B%5D=downloads+desc&rows=200&output=json';
}

export interface BuildDeps { fetchImpl: typeof fetch; lib: LibraryCollection[]; mmdd: string; thisYear: number; minYear?: number; max?: number; perYear?: number; now?: () => Date }

/** One failed chunk does not stop the run; if EVERY chunk fails this throws so the caller never reports an empty success. */
export async function buildOnThisDay(d: BuildDeps): Promise<OnThisDayFeed> {
  const now = d.now ?? (() => new Date());
  const base = { generatedFor: d.mmdd, source: 'https://archive.org/details/usgovernmentmirrors', generatedAt: now().toISOString() };
  if (isJan1(d.mmdd)) return { ...base, yearsQueried: 0, yearErrors: 0, count: 0, items: [], skipped: 'Jan 1 skipped: Archive.org stores year-only dates as YYYY-01-01' };
  const libById = new Map(d.lib.map((c) => [c.identifier, c]));
  const years: number[] = [];
  for (let y = d.thisYear - 1; y >= (d.minYear ?? 1900); y--) if (dayOfYearOk(d.mmdd, y)) years.push(y);
  const seen = new Set<string>(); const cands: ArchiveItem[] = []; let ok = 0; let bad = 0; let lastErr = '';
  for (let i = 0; i < years.length; i += YEARS_PER_QUERY) {
    const chunk = years.slice(i, i + YEARS_PER_QUERY);
    try {
      let res = await d.fetchImpl(chunkQueryUrl(chunk, d.mmdd), { headers: { 'User-Agent': 'AJN-Precision-Engineering/1.0' }, signal: AbortSignal.timeout(45_000) });
      if (res.status === 429 || res.status >= 500) res = await d.fetchImpl(chunkQueryUrl(chunk, d.mmdd), { headers: { 'User-Agent': 'AJN-Precision-Engineering/1.0' }, signal: AbortSignal.timeout(45_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { response?: { docs?: RawDoc[] } };
      ok++;
      for (const doc of j.response?.docs ?? []) {
        const c = toCandidate(doc, libById);
        if (c && c.date.slice(5) === d.mmdd && c.year < d.thisYear && !seen.has(c.identifier)) { seen.add(c.identifier); cands.push(c); }
      }
    } catch (e) { bad++; lastErr = e instanceof Error ? e.message : String(e); }
  }
  if (ok === 0) throw new Error(`every Archive.org query failed (${lastErr})`);
  const items = selectItems(cands, { max: d.max ?? 12, perYear: d.perYear ?? 2 });
  return { ...base, yearsQueried: ok * YEARS_PER_QUERY, yearErrors: bad, count: items.length, items };
}
