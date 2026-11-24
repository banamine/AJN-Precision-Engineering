// "Declassified Desk": story and scan cards built from real Archive.org government scans (usgovernmentmirrors).
// Honesty rules: every field comes from Archive.org (metadata, OCR text, OCR layout). Nothing is summarised or invented: the card deck is a verbatim
// lead taken from the document text. A card is a STORY card only when the OCR is measurably good; everything else is a SCAN card (page image first).
// Pure helpers are exported for tests; buildDesk() does the network work and never reports an empty failure as success.

export type DeskTone = 'pass' | 'amber' | 'red';
export interface DeskConfidence { label: string; tone: DeskTone; mean: number | null; basis: 'ocr' | 'plain-text' | 'unscored' }
export interface DeskItem {
  id: string; archiveId: string; beat: string; cardType: 'story' | 'scan'; headline: string; lead: string | null;
  source: string; year: number | null; yearNote: string | null; pages: number | null; confidence: DeskConfidence;
  thumbUrl: string; pageUrl: string; rawOcr: string;
  /** Full date (YYYY-MM-DD) read from the item's metadata or the document's own text; null when only a year is known. Older snapshots do not have it. */
  docDate?: string | null;
  /** More of the document in its own words: up to ~1200 characters of consecutive clean sentences, starting at the lead. Older snapshots do not have it. */
  excerpt?: string | null;
  // image addresses only: the page shows no links to Archive.org
}
export interface DeskBeat { id: string; label: string; enabled: boolean; count: number }
export interface DeskFeed { generatedAt: string; source: string; beats: DeskBeat[]; count: number; queryErrors: number; items: DeskItem[]; /** Added by /api/desk: where this copy came from and how old it is. */ snapshot?: { source: 'bundled' | 'github' | 'live'; ageDays: number; stale: boolean } }
export interface DeskCollection { identifier: string; name: string }

export const STORY_MIN_CONFIDENCE = 75; // mean OCR word confidence (0-100) at or above this makes a story card
export const AMBER_MIN_CONFIDENCE = 55; // below this the pill is red
export const PLAIN_TEXT_MIN_CLEAN = 85; // plain-text-only items need this share of clean words

export const DESK_BEATS: { id: string; label: string; collections: string[]; enabled: boolean }[] = [
  { id: 'intelligence', label: 'Intelligence', collections: ['ciareadingroom'], enabled: true },
  { id: 'ufo', label: 'UFO files', collections: ['project-blue-book', 'ufo-files'], enabled: true },
  { id: 'state', label: 'State Dept.', collections: ['state-department'], enabled: true },
  // FBI items are 10-140 GB multi-file dumps with personal data; not loaded until they are probed file by file.
  { id: 'fbi', label: 'FBI', collections: ['nsia-fbi-files'], enabled: false },
  { id: 'mkultra', label: 'MKULTRA', collections: ['mkultrafiles'], enabled: true },
];

const ACRONYMS = new Set(['CIA', 'FBI', 'NSA', 'NASA', 'JFK', 'USSR', 'USA', 'US', 'U.S.', 'UN', 'DOD', 'DOE', 'FOIA', 'UFO', 'AEC', 'ONI', 'DIA', 'NATO', 'KGB', 'OSS', 'DC', 'II', 'III', 'IV', 'MKULTRA']);
const SMALL = new Set(['of', 'the', 'and', 'for', 'in', 'on', 'to', 'a', 'an', 'at', 'by', 'from', 'with']);
const STOPWORDS = new Set(['the', 'of', 'and', 'to', 'in', 'a', 'is', 'that', 'for', 'it', 'as', 'was', 'with', 'be', 'by', 'on', 'not', 'he', 'this', 'are', 'or', 'his', 'from', 'at', 'which', 'but', 'have', 'an', 'had', 'they', 'you', 'were', 'their', 'one', 'all', 'we', 'can', 'her', 'has', 'there', 'been', 'if', 'more', 'when', 'will', 'would', 'who', 'so', 'no']);

const words = (s: string): string[] => s.split(/\s+/).filter(Boolean);
const trimPunct = (t: string): string => t.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');

/** Mean OCR word confidence from ABBYY hOCR (`x_wconf`). Works on a partial file (only the first pages). */
export function meanWordConfidence(hocr: string): { mean: number; words: number } | null {
  let sum = 0; let n = 0;
  for (const m of hocr.matchAll(/x_wconf (\d{1,3})/g)) { const v = Number(m[1]); if (v <= 100) { sum += v; n++; } }
  return n >= 30 ? { mean: Math.round(sum / n), words: n } : null; // under 30 words is not a measurement
}

/** Share (0-100) of tokens that look like real words, numbers or acronyms. A cheap proxy for "is this plain text clean" when no hOCR score exists. */
export function textCleanliness(text: string): number {
  let total = 0; let clean = 0;
  for (const raw of words(text)) {
    const t = trimPunct(raw);
    if (t.length < 2) continue;
    total++;
    if (/^[A-Za-z][A-Za-z'’-]*$/.test(t) && !/[^aeiouyAEIOUY]{6,}/.test(t) && (/[aeiouyAEIOUY]/.test(t) || /^[A-Z]{2,6}$/.test(t)) && !/[a-z][A-Z]/.test(t.slice(1))) clean++;
    else if (/^\d[\d,./:-]*$/.test(t)) clean++;
    else if (/^[A-Z]{2,6}$/.test(t)) clean++;
  }
  return total < 20 ? 0 : Math.round((100 * clean) / total);
}

export function isEnglishText(text: string): boolean {
  const toks = words(text.toLowerCase()).map(trimPunct).filter((t) => t.length > 0);
  if (toks.length < 30) return false;
  return toks.filter((t) => STOPWORDS.has(t)).length / toks.length >= 0.1;
}

export function languageAllowed(meta: unknown): boolean {
  const langs = ([] as unknown[]).concat(meta ?? []).map((l) => String(l).trim().toLowerCase()).filter(Boolean);
  if (!langs.length) return true; // untagged: decided from the text instead
  return langs.some((l) => l === 'english' || l === 'eng' || l === 'en' || l.startsWith('english'));
}

export function classifyCard(a: { meanConf: number | null; cleanliness: number }): { cardType: 'story' | 'scan'; confidence: DeskConfidence } {
  if (a.meanConf !== null) {
    const tone: DeskTone = a.meanConf >= STORY_MIN_CONFIDENCE ? 'pass' : a.meanConf >= AMBER_MIN_CONFIDENCE ? 'amber' : 'red';
    return { cardType: a.meanConf >= STORY_MIN_CONFIDENCE ? 'story' : 'scan', confidence: { label: `${a.meanConf}% OCR`, tone, mean: a.meanConf, basis: 'ocr' } };
  }
  if (a.cleanliness >= PLAIN_TEXT_MIN_CLEAN) return { cardType: 'story', confidence: { label: 'Plain text', tone: 'pass', mean: null, basis: 'plain-text' } };
  return { cardType: 'scan', confidence: { label: 'No OCR score', tone: a.cleanliness >= 60 ? 'amber' : 'red', mean: null, basis: 'unscored' } };
}

export function headlineCase(t: string): string {
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length < 4 || letters.replace(/[^A-Z]/g, '').length / letters.length < 0.8) return t; // already mixed case
  return t.toLowerCase().split(/(\s+)/).map((w, i) => {
    const bare = w.replace(/[^a-z.]/g, '');
    if (ACRONYMS.has(bare.toUpperCase())) return w.toUpperCase();
    if (i > 0 && SMALL.has(bare)) return w;
    return w.replace(/[a-z]/, (c) => c.toUpperCase());
  }).join('');
}

const BOILERPLATE: RegExp[] = [
  /^\s*approved for release\b/i, /^\s*sanitized copy approved\b/i, /^\s*(un)?classified\b/i, /^\s*unclas\b/i, /^\s*sipdis\s*$/i, /^\s*sensitive\s*$/i,
  /^\s*this record is a partial extract\b/i, /^\s*the full text of the original cable\b/i, /^\s*page\s+\d+\s*(of\s+\d+)?\s*$/i, /^[\s\d.\-–—_=*|]+$/,
  /^\s*(memorandum\s+for|subject|subj|from|to|ref|reference|date|via|tags|e\.?o\.?)\s*:/i, /^\s*\d{1,2}\s+[A-Z]{3,9}\s+\d{4}\s*$/,
];
export function stripBoilerplate(text: string): string {
  return text.replace(/This\s+record\s+is\s+a\s+partial\s+extract\s+of\s+the\s+original\s+cable\.\s*The\s+full\s+text\s+of\s+the\s+original\s+cable\s+is\s+not\s+available\./gi, '').split(/\r?\n/).filter((l) => !BOILERPLATE.some((re) => re.test(l))).join('\n')
    // Wire-service / FBIS style headers and markup are not story text: drop them so the lead starts at the first real sentence.
    .replace(/\(\([^()]*\)\)/g, ' ')
    .replace(/\b(?:Document|Doc\.?)\s+\d+\b[^.!?]*?\bMessage\s+\d+\b/gi, ' ')
    .replace(/\/\/+\s*\d{0,2}\s*/g, ' ')
    .replace(/([.!?"\u201D']\s+)\d{1,2}\s+(?=[A-Z"\u201C(])/g, '$1')
    .replace(/^\s*\d{1,2}\s+(?=[A-Z"\u201C(])/, '');
}

export function looksLikeId(title: string): boolean {
  const wordsIn = title.match(/[A-Za-z]{3,}/g) ?? [];
  return wordsIn.length < 2 || /\bDOC_\d+/.test(title) || /^[A-Za-z]*\d{5,}/.test(title.trim()) || /^\d{4}-\d{2}-\d+/.test(title.trim());
}

export function humanizeId(identifier: string, collectionName: string): string {
  const m = identifier.match(/^(\d{4})-(\d{2})-\d+-(.+)$/);
  if (m) return `${collectionName}: ${m[3].replace(/[-_]+/g, ' ')}`;
  if (/^\d{2}[A-Z]+\d+$/.test(identifier)) return `State Department cable ${identifier}`;
  const doc = identifier.match(/^DOC_0*(\d+)$/);
  if (doc) return `${collectionName.replace(/\s+files$/i, '')} document ${doc[1]}`;
  return `${collectionName} ${identifier}`;
}

export function cleanArchiveTitle(raw: unknown): string {
  let t = String(raw ?? '').replace(/\s+/g, ' ').trim();
  t = t.replace(/^CIA Reading Room\s+\S+:\s*/i, '').replace(/^\(?(sanitized|approved for release)[^)]*\)?\s*/i, '').trim();
  if (t.length > 120) t = t.slice(0, 120).replace(/\s+\S*$/, '') + '…';
  return t;
}

export function pickHeadline(a: { title: unknown; identifier: string; collectionName: string; text: string }): string {
  const t = cleanArchiveTitle(a.title);
  if (t.length >= 8 && !looksLikeId(t) && !/[:\u2026]$/.test(t)) return headlineCase(t);
  const subj = a.text.match(/^\s*(?:SUBJECT|SUBJ)\s*[:\-]\s*(.+)$/im);
  if (subj) {
    const s = subj[1].replace(/\s+/g, ' ').replace(/^["“](.*)["”]$/, '$1').trim();
    if (s.length >= 8 && textCleanliness(Array(6).fill(s).join(" ")) >= 80) return headlineCase(s);
  }
  const first = stripBoilerplate(a.text).replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/).find((x) => x.length >= 25 && x.length <= 160 && isProseSentence(x));
  if (first) return headlineCase(first.length > 80 ? first.slice(0, 80).replace(/\s+\S*$/, '') + '…' : first.replace(/[.!?]$/, ''));
  return humanizeId(a.identifier, a.collectionName);
}

const upperShare = (s: string): number => { const l = s.replace(/[^A-Za-z]/g, ''); return l.length ? l.replace(/[^A-Z]/g, '').length / l.length : 0; };

const JUNK_SENTENCE = /\b[A-Z]{1,4}-?[A-Z]*\d{4,}\b|estimated\s+publication\s+date|CIA-RDP|Approved\s+For\s+Release|\b\d{4}\/\d{2}\/\d{2}\b|@\w+\.\w+|https?:|www\./i;
const stopShare = (s: string): number => { const t = words(s.toLowerCase()).map(trimPunct).filter(Boolean); return t.length ? t.filter((w) => STOPWORDS.has(w)).length / t.length : 0; };
const digitShare = (s: string): number => (s.length ? (s.match(/\d/g) ?? []).length / s.length : 0);
/** A real prose sentence: long enough, full of ordinary words, few digits, no release stamps or addresses. */
const oddShare = (s: string): number => (s.length ? (s.match(/[^A-Za-z0-9\s.,;:'"“”’()\-–—?!%$&\/]/g) ?? []).length / s.length : 0);
const lonelyShare = (s: string): number => { const t = words(s); return t.length ? t.filter((w) => /^[A-Za-z]$/.test(trimPunct(w)) && !/^[aAI]$/.test(trimPunct(w))).length / t.length : 0; };
export function isProseSentence(s: string): boolean {
  return oddShare(s) <= 0.02 && lonelyShare(s) <= 0.08 && /^[A-Z"“(]/.test(s) && words(s).length >= 10 && upperShare(s) < 0.5 && stopShare(s) >= 0.2 && digitShare(s) <= 0.06
    && !JUNK_SENTENCE.test(s) && textCleanliness(`${s} ${s}`) >= PLAIN_TEXT_MIN_CLEAN;
}

/** Verbatim lead: the first prose sentence(s) of the body, up to `max` characters. Returns null when the text has no real sentence. */
export function leadFromText(text: string, max = 260): string | null {
  const body = stripBoilerplate(text).replace(/-[ \t]*\r?\n[ \t]*/g, '').split(/\r?\n/)
    .filter((l) => !(words(l).length <= 8 && upperShare(l) >= 0.8)) // headings
    .join(' ').replace(/\s+/g, ' ').trim();
  const sentences = body.split(/(?<=[.!?])\s+(?=[A-Z])/);
  const start = sentences.findIndex(isProseSentence);
  if (start < 0) return null;
  let out = sentences[start];
  if (out.length > max) return out.slice(0, max).replace(/\s+\S*$/, '') + '…';
  for (let i = start + 1; i < sentences.length; i++) {
    const t = sentences[i];
    if (out.length + 1 + t.length > max || !isProseSentence(t)) break;
    out += ' ' + t;
  }
  return out;
}

const MONTHS = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
/** First full written date near the top of the document ("9 June 1983", "July 26, 1963"). Null when there is none. */
export function yearFromText(text: string): number | null {
  const head = text.slice(0, 4000);
  const m = head.match(new RegExp(`\\b\\d{1,2}\\s+${MONTHS}\\.?,?\\s+((?:19|20)\\d{2})\\b`, 'i')) ?? head.match(new RegExp(`\\b${MONTHS}\\.?\\s+(?:\\d{1,2},?\\s+)?((?:19|20)\\d{2})\\b`, 'i'));
  const y = m ? Number(m[1]) : NaN;
  return y >= 1900 && y <= 2030 ? y : null;
}

const MONTH_NUM: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const validDay = (y: number, m: number, d: number): boolean => y >= 1900 && y <= 2030 && m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
/** First complete written date (day, month and year) near the top of the document, as YYYY-MM-DD. Null when the text has only a month or a year. */
export function dateFromText(text: string): string | null {
  const head = text.slice(0, 4000);
  let m = head.match(new RegExp(`\\b(\\d{1,2})\\s+(${MONTHS})\\.?,?\\s+((?:19|20)\\d{2})\\b`, 'i'));
  let d = 0, mon = 0, y = 0;
  if (m) { d = Number(m[1]); mon = MONTH_NUM[m[2].slice(0, 3).toLowerCase()]; y = Number(m[3]); }
  else {
    m = head.match(new RegExp(`\\b(${MONTHS})\\.?\\s+(\\d{1,2}),?\\s+((?:19|20)\\d{2})\\b`, 'i'));
    if (!m) return null;
    mon = MONTH_NUM[m[1].slice(0, 3).toLowerCase()]; d = Number(m[2]); y = Number(m[3]);
  }
  return validDay(y, mon, d) ? `${y}-${String(mon).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
}
/** Item metadata dates that are only a year (Archive writes those as YYYY-01-01) are not a real day. */
export function dateFromMeta(date: unknown): string | null {
  const m = String(date ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return validDay(y, mo, d) && !(mo === 1 && d === 1) ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
/** The lead plus the sentences that follow it, word for word, up to `max` characters; each sentence must pass the same prose check as the lead. */
export function excerptFromText(text: string, max = 1200): string | null {
  const body = stripBoilerplate(text).replace(/-[ \t]*\r?\n[ \t]*/g, '').split(/\r?\n/)
    .filter((l) => !(words(l).length <= 8 && upperShare(l) >= 0.8)).join(' ').replace(/\s+/g, ' ').trim();
  const sentences = body.split(/(?<=[.!?])\s+(?=[A-Z])/);
  const start = sentences.findIndex(isProseSentence);
  if (start < 0) return null;
  let out = sentences[start];
  for (let i = start + 1; i < sentences.length; i++) {
    const t = sentences[i];
    if (!isProseSentence(t) || out.length + 1 + t.length > max) break;
    out += ' ' + t;
  }
  return out.length > 300 ? out : null; // not worth an expander when it is barely more than the lead
}

export function yearFromItem(date: unknown, identifier: string): { year: number | null; note: string | null } {
  const d = String(date ?? '').match(/^(\d{4})/);
  if (d && Number(d[1]) >= 1800 && Number(d[1]) <= 2100) return { year: Number(d[1]), note: null };
  const id = identifier.match(/^(\d{4})-\d{2}-/);
  if (id) return { year: Number(id[1]), note: 'from item ID' };
  const cable = identifier.match(/^(\d{2})[A-Z]+\d+$/);
  if (cable) { const yy = Number(cable[1]); return { year: yy <= 26 ? 2000 + yy : 1900 + yy, note: 'from cable ID' }; }
  return { year: null, note: null };
}

export interface RawSearchDoc { identifier?: string; title?: string; date?: string; collection?: string | string[]; language?: string | string[]; downloads?: number | string }
interface ItemMeta {
  metadata?: Record<string, unknown>; files?: { name: string; size?: string | number; format?: string }[]; is_dark?: boolean;
}
const fileSize = (f: { size?: string | number } | undefined): number => Number(f?.size ?? 0) || 0;
const MAX_TEXT_FILE = 25_000_000;
const TEXT_BYTES = 80_000; // enough for headline, lead and the raw OCR drawer
const HOCR_BYTES = 400_000; // the first pages are a good sample of scan quality

export interface DeskDeps { fetchImpl: typeof fetch; lib: DeskCollection[]; perBeat?: number; maxAttempts?: number; now?: () => Date }

const UA = { 'User-Agent': 'AJN-Precision-Engineering/1.0' };
async function getJson<T>(f: typeof fetch, url: string): Promise<T> {
  let res = await f(url, { headers: UA, signal: AbortSignal.timeout(45_000) });
  if (res.status === 429 || res.status >= 500) res = await f(url, { headers: UA, signal: AbortSignal.timeout(45_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.slice(0, 80)}`);
  return (await res.json()) as T;
}
async function getPartialText(f: typeof fetch, url: string, bytes: number): Promise<string> {
  const res = await f(url, { headers: { ...UA, Range: `bytes=0-${bytes - 1}` }, signal: AbortSignal.timeout(45_000) });
  if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status} for ${url.slice(0, 80)}`);
  return (await res.text()).slice(0, bytes);
}

export function beatQueryUrl(collections: string[], rows: number): string {
  const q = `collection:(${collections.join(' OR ')}) AND mediatype:texts`;
  return 'https://archive.org/advancedsearch.php?q=' + encodeURIComponent(q)
    + ['identifier', 'title', 'date', 'collection', 'language', 'downloads'].map((f) => `&fl%5B%5D=${f}`).join('')
    + `&sort%5B%5D=downloads+desc&rows=${rows}&output=json`;
}

/** Why an item was not used (or null when it is usable). Exported for tests. */
export function skipReason(meta: ItemMeta, doc: RawSearchDoc): string | null {
  const m = meta.metadata ?? {};
  if (meta.is_dark || m.private || String(m['access-restricted-item'] ?? '') === 'true') return 'restricted';
  if (!languageAllowed(m.language ?? doc.language)) return 'not English';
  const files = meta.files ?? [];
  const djvu = files.find((f) => f.name.endsWith('_djvu.txt'));
  if (!djvu || fileSize(djvu) < 200) return 'no OCR text';
  if (fileSize(djvu) > MAX_TEXT_FILE) return 'text file too large';
  return null;
}

export async function buildDeskItem(d: DeskDeps, beatId: string, doc: RawSearchDoc, libById: Map<string, DeskCollection>): Promise<DeskItem | { skipped: string }> {
  const id = String(doc.identifier ?? '');
  if (!id) return { skipped: 'no identifier' };
  const meta = await getJson<ItemMeta>(d.fetchImpl, `https://archive.org/metadata/${encodeURIComponent(id)}`);
  const why = skipReason(meta, doc);
  if (why) return { skipped: why };
  const files = meta.files ?? [];
  const djvu = files.find((f) => f.name.endsWith('_djvu.txt'))!;
  const hocr = files.find((f) => f.name.endsWith('_hocr.html'));
  const enc = (n: string) => `https://archive.org/download/${encodeURIComponent(id)}/${n.split('/').map(encodeURIComponent).join('/')}`;
  const text = await getPartialText(d.fetchImpl, enc(djvu.name), TEXT_BYTES);
  const metaLang = (meta.metadata ?? {}).language ?? doc.language;
  if (!([] as unknown[]).concat(metaLang ?? []).length && !isEnglishText(text)) return { skipped: 'not English' };
  let ocr: { mean: number; words: number } | null = null;
  if (hocr) { try { ocr = meanWordConfidence(await getPartialText(d.fetchImpl, enc(hocr.name), HOCR_BYTES)); } catch { ocr = null; } } // no score, not a failure
  const cleanliness = textCleanliness(text);
  const classified = classifyCard({ meanConf: ocr?.mean ?? null, cleanliness });
  const leadText = classified.cardType === 'story' ? leadFromText(text) : null;
  const cardType: 'story' | 'scan' = classified.cardType === 'story' && leadText ? 'story' : 'scan'; // no readable sentence: show the scan, not an empty story
  const confidence = classified.confidence;
  const m = meta.metadata ?? {};
  const col = ([] as string[]).concat((m.collection as string | string[]) ?? doc.collection ?? []).find((c) => libById.has(c) && c !== 'usgovernmentmirrors');
  const source = (col && libById.get(col)?.name) || 'US Government Mirrors';
  let { year, note } = yearFromItem(m.date ?? doc.date, id);
  if (year === null) { const ty = yearFromText(text); if (ty) { year = ty; note = 'from text'; } }
  const pages = Number(m.imagecount) > 0 ? Number(m.imagecount) : null;
  const rawOcr = text.replace(/\n{3,}/g, '\n\n').trim().slice(0, 2400);
  const eid = encodeURIComponent(id);
  return {
    id, archiveId: id, beat: beatId, cardType,
    headline: pickHeadline({ title: m.title ?? doc.title, identifier: id, collectionName: source, text }),
    lead: cardType === 'story' ? leadText : null,
    source, year, yearNote: note, pages, confidence,
    thumbUrl: `https://archive.org/download/${eid}/page/n0_w400.jpg`, pageUrl: `https://archive.org/download/${eid}/page/n0_w800.jpg`,
    rawOcr,
    docDate: dateFromMeta(m.date ?? doc.date) ?? dateFromText(text),
    excerpt: cardType === 'story' ? excerptFromText(text) : null,
  };
}

/** One failed item or query does not stop the run; if EVERY enabled beat query fails this throws so the caller never reports an empty success. */
export async function buildDesk(d: DeskDeps): Promise<DeskFeed> {
  const now = d.now ?? (() => new Date());
  const perBeat = d.perBeat ?? 6; const maxAttempts = d.maxAttempts ?? 14;
  const libById = new Map(d.lib.map((c) => [c.identifier, c]));
  const seen = new Set<string>();
  let queryErrors = 0; let queriesOk = 0; let lastErr = '';
  // Beats run side by side (the shared Archive limiter paces the real requests); candidates within a beat run one at a time.
  const perBeatResults = await Promise.all(DESK_BEATS.map(async (beat) => {
    if (!beat.enabled) return { beat, got: [] as DeskItem[] };
    let docs: RawSearchDoc[] = [];
    try {
      const j = await getJson<{ response?: { docs?: RawSearchDoc[] } }>(d.fetchImpl, beatQueryUrl(beat.collections, maxAttempts * 2));
      docs = j.response?.docs ?? []; queriesOk++;
    } catch (e) { queryErrors++; lastErr = e instanceof Error ? e.message : String(e); }
    const got: DeskItem[] = []; let tried = 0;
    for (const doc of docs) {
      if (got.length >= perBeat || tried >= maxAttempts) break;
      if (!doc.identifier || seen.has(doc.identifier)) continue;
      seen.add(doc.identifier); tried++;
      try {
        const r = await buildDeskItem(d, beat.id, doc, libById);
        if (!('skipped' in r)) got.push(r);
      } catch { /* one bad item is skipped, the next candidate is tried */ }
    }
    return { beat, got };
  }));
  if (queriesOk === 0) throw new Error(`every Archive.org query failed (${lastErr})`);
  const items = perBeatResults.flatMap((r) => r.got);
  const beats: DeskBeat[] = perBeatResults.map((r) => ({ id: r.beat.id, label: r.beat.label, enabled: r.beat.enabled, count: r.got.length }));
  return { generatedAt: now().toISOString(), source: 'https://archive.org/details/usgovernmentmirrors', beats, count: items.length, queryErrors, items };
}
