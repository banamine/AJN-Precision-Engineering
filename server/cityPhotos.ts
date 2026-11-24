/* On Air weather-card backgrounds: one Wikimedia Commons photo per city.
 * The browser never names a category: it sends one of the 12 city keys below and the server maps it to categories chosen here.
 * Only photos under a licence on the allowlist (public domain, CC0, CC BY) are used; the credit is returned with the photo and shown on the card.
 * Lookups are cached for a day, concurrent misses share one lookup, and any failure is reported as such (status 'error' / 'empty'), never as a photo. */
import { fnv1a } from '../src/utils/roundRobinSchedule';

export const CITY_CATEGORIES: Record<string, { name: string; category: string }> = {
  'new-york-city': { name: 'New York City', category: 'New York City' },
  'los-angeles': { name: 'Los Angeles', category: 'Los Angeles' },
  'chicago': { name: 'Chicago', category: 'Chicago' },
  'san-francisco': { name: 'San Francisco', category: 'San Francisco' },
  'boston': { name: 'Boston', category: 'Boston' },
  // "Category:Miami" is an empty redirect-style page on Commons; the photos are under "Miami, Florida" (checked against the live API).
  'miami': { name: 'Miami', category: 'Miami, Florida' },
  'toronto': { name: 'Toronto', category: 'Toronto' },
  'vancouver': { name: 'Vancouver', category: 'Vancouver' },
  'montreal': { name: 'Montreal', category: 'Montreal' },
  'ottawa': { name: 'Ottawa', category: 'Ottawa' },
  'calgary': { name: 'Calgary', category: 'Calgary' },
  'quebec-city': { name: 'Quebec City', category: 'Quebec City' },
};
export const cityKeyOf = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export interface CityPhoto { url: string; width: number; height: number; title: string; author: string; license: string; licenseUrl: string | null; pageUrl: string }
export interface CityPhotoResponse { status: 'ok' | 'empty' | 'error'; city: string; photo: CityPhoto | null; candidates: number; fetchedAt: string; error?: string }

const API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'AJN-Precision-Engineering/1.0 (On Air weather backgrounds; https://github.com/banamine/AJN-Precision-Engineering)';
const THUMB_WIDTH = 960, MIN_WIDTH = 1600, MAX_SUBCATS = 6, PER_CAT = 50, MAX_BYTES = 2_000_000, TIMEOUT_MS = 8000;
const OK_TTL_MS = 24 * 3_600_000, FAIL_TTL_MS = 10 * 60_000;
/** Which sub-categories are worth reading, best first. On Commons the photos mostly sit in these ("Chicago skyline", "Cityscapes of Quebec City", "Views of ...", "Photographs of ..."). */
const PREFERRED_SUB: RegExp[] = [/skylines?|cityscapes?/i, /quality images|featured pictures|valued images/i, /\bviews of\b/i, /\bnight in\b/i, /photographs of/i, /architecture|waterfront|harbou?r|downtown|park|bridge|street|panorama|aerial|landmark/i];
export const subScore = (name: string): number => PREFERRED_SUB.findIndex((re) => re.test(name));
const BAD_SUB = /map|people|portrait|transport|bus|train|metro|subway|vehicle|aircraft|airport|history|by year|logo|flag|coat of arms|sign|interior|museum|event|protest|sport|food|ship|cemeter|deaths|births|churches|schools|buildings? by|videos|text\)|gallery pages|named after|cleanup|from ottawa|national flag/i;
const NOT_PHOTO = /\b(?:interior|ceiling|lobby|museum|exhibit|artifact|cup|vase|statue|sculpture|plan|map|maps|diagram|drawing|engraving|lithograph|postcard|poster|painting|illustration|sketch|chart|logo|flag|coat of arms|certificate|document|manuscript|scan)\b/i;
/** Exact licence identifiers only. ShareAlike (CC BY-SA) is left out on purpose: the card dims and blurs the picture. */
export const LICENSE_OK = /^(?:CC0(?: 1\.0)?|Public domain|PDM(?: 1\.0)?|PD[- ][A-Za-z0-9-]+|CC BY (?:1\.0|2\.0|2\.5|3\.0|4\.0)(?: [A-Za-z]{2,3})?)$/i;

const stripHtml = (s: string): string => s.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();
type Meta = Record<string, { value?: string } | undefined>;
interface ApiPage { title?: string; imageinfo?: Array<{ thumburl?: string; width?: number; height?: number; mime?: string; descriptionurl?: string; extmetadata?: Meta }> }

/** Pure: turn one API page into a photo, or null when it is not usable (size, shape, licence, missing credit). */
export function photoFromPage(page: ApiPage): CityPhoto | null {
  const ii = page.imageinfo?.[0];
  if (!ii || ii.mime !== 'image/jpeg' || !ii.thumburl || !ii.descriptionurl) return null;
  const w = Number(ii.width), h = Number(ii.height);
  if (!(w >= MIN_WIDTH) || !(h > 0) || w / h < 1.3) return null;
  if (NOT_PHOTO.test(String(page.title ?? ''))) return null;      // plans, maps, engravings, posters: not a view of the city today
  const meta = ii.extmetadata ?? {};
  const license = String(meta.LicenseShortName?.value ?? '').trim();
  if (!LICENSE_OK.test(license)) return null;
  const author = stripHtml(String(meta.Artist?.value ?? ''));
  const pd = /^(?:CC0|Public domain|PDM|PD[- ])/i.test(license);
  if (!author && !pd) return null;                       // an attribution licence needs a named author
  if (author.length > 160) return null;
  const licenseUrl = String(meta.LicenseUrl?.value ?? '').trim();
  return { url: ii.thumburl, width: w, height: h, title: stripHtml(String(page.title ?? '').replace(/^File:/, '')), author: author || 'Public domain', license, licenseUrl: /^https:\/\//.test(licenseUrl) ? licenseUrl : null, pageUrl: ii.descriptionurl };
}
/** Pure and deterministic: the same seed, city and day always give the same photo. */
export function pickPhoto(list: readonly CityPhoto[], seed: string, city: string, day: string): CityPhoto | null {
  return list.length ? list[fnv1a(`${seed}|${city}|${day}`) % list.length] : null;
}

type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
async function getJson(f: FetchLike, params: Record<string, string>): Promise<any> {
  const r = await f(`${API}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error(`Commons HTTP ${r.status}`);
  const text = await r.text();
  if (text.length > MAX_BYTES) throw new Error('Commons response too large');
  return JSON.parse(text);
}
const filesOf = async (f: FetchLike, category: string): Promise<CityPhoto[]> => {
  const j = await getJson(f, { action: 'query', generator: 'categorymembers', gcmtitle: `Category:${category}`, gcmtype: 'file', gcmsort: 'timestamp', gcmdir: 'descending', gcmlimit: String(PER_CAT), prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: String(THUMB_WIDTH), iiextmetadatafilter: 'LicenseShortName|Artist|LicenseUrl' });
  return ((j?.query?.pages ?? []) as ApiPage[]).map(photoFromPage).filter((p): p is CityPhoto => !!p);
};
const subcatsOf = async (f: FetchLike, category: string): Promise<string[]> => {
  const j = await getJson(f, { action: 'query', list: 'categorymembers', cmtitle: `Category:${category}`, cmtype: 'subcat', cmlimit: '200' });
  return ((j?.query?.categorymembers ?? []) as Array<{ title?: string }>).map((m) => String(m.title ?? '').replace(/^Category:/, '')).filter((n) => n && subScore(n) >= 0 && !BAD_SUB.test(n)).sort((a, b) => subScore(a) - subScore(b));
};
const MIN_GOOD = 8;
/** Best photos first: skyline / cityscape / quality-image / views / night sub-categories. Broader ones (Photographs of, architecture, the city's own category) are read only while there are too few. */
export async function fetchCandidates(city: string, f: FetchLike): Promise<CityPhoto[]> {
  const base = CITY_CATEGORIES[city]?.category; if (!base) return [];
  const all = await subcatsOf(f, base).catch(() => [] as string[]);
  const strong = all.filter((n) => subScore(n) <= 3).slice(0, MAX_SUBCATS), broad = all.filter((n) => subScore(n) > 3).slice(0, MAX_SUBCATS);
  const out: CityPhoto[] = []; const seen = new Set<string>(); let firstError: unknown = null; let okCalls = 0;
  const read = async (cat: string): Promise<void> => {
    try { for (const p of await filesOf(f, cat)) if (!seen.has(p.pageUrl)) { seen.add(p.pageUrl); out.push(p); } okCalls++; } catch (e) { firstError ??= e; }
  };
  for (const cat of strong) await read(cat);
  if (out.length < MIN_GOOD) for (const cat of broad) { await read(cat); if (out.length >= MIN_GOOD * 2) break; }
  if (out.length < MIN_GOOD) {
    // Sparse city: the photos sit one level further down, under "Photographs of X" / "Views of X".
    const deeper: string[] = [];
    for (const n of [...strong, ...broad].filter((x) => /photographs of|views of|cityscapes?|skylines?/i.test(x)).slice(0, 2)) deeper.push(...(await subcatsOf(f, n).catch(() => [] as string[])));
    for (const cat of [...new Set(deeper)].slice(0, 4)) await read(cat);
  }
  if (out.length < MIN_GOOD) await read(base);
  if (!okCalls && firstError) throw firstError;
  return out;
}

export interface CityPhotoService { get(city: string, seed: string, now?: Date): Promise<CityPhotoResponse> }
export function createCityPhotoService(f: FetchLike, log: (m: string) => void = () => {}): CityPhotoService {
  const cache = new Map<string, { at: number; list: CityPhoto[]; error?: string }>();
  const inflight = new Map<string, Promise<{ at: number; list: CityPhoto[]; error?: string }>>();
  const load = (city: string, nowMs: number): Promise<{ at: number; list: CityPhoto[]; error?: string }> => {
    const hit = cache.get(city);
    if (hit && nowMs - hit.at < (hit.error ? FAIL_TTL_MS : OK_TTL_MS)) return Promise.resolve(hit);
    let p = inflight.get(city);
    if (!p) {
      p = fetchCandidates(city, f)
        .then((list) => { const e = { at: nowMs, list }; cache.set(city, e); log(`[city-photo] ${city}: ${list.length} usable photos`); return e; })
        .catch((err) => { const e = { at: nowMs, list: [] as CityPhoto[], error: err instanceof Error ? err.message : String(err) }; cache.set(city, e); log(`[city-photo] ${city}: failed (${e.error})`); return e; })
        .finally(() => { inflight.delete(city); });
      inflight.set(city, p);
    }
    return p;
  };
  return {
    async get(city, seed, now = new Date()) {
      const fetchedAt = now.toISOString();
      if (!CITY_CATEGORIES[city]) return { status: 'error', city, photo: null, candidates: 0, fetchedAt, error: 'unknown city' };
      const e = await load(city, now.getTime());
      if (e.error) return { status: 'error', city, photo: null, candidates: 0, fetchedAt, error: e.error };
      const photo = pickPhoto(e.list, seed, city, fetchedAt.slice(0, 10));
      if (photo) log(`[city-photo] ${city}: picked ${photo.pageUrl} (${photo.license})`);
      return { status: photo ? 'ok' : 'empty', city, photo, candidates: e.list.length, fetchedAt };
    },
  };
}
