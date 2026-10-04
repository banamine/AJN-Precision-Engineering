// Pure AJN filename/title classification (ported from radio-lite `server/sources/ajn.ts`, XML parsing removed).
// No I/O, no clock, no randomness. Dates are never guessed: a bad or contradictory date yields airDate=null + a review reason.

export type AjnShowSlug = 'alex-jones' | 'war-room' | 'sunday-night-live';
export type AjnShowType = 'full_show' | 'hour' | 'special' ;
export type AjnChannel = 'ajn-radio' | 'ajn-exclusive';
export type AjnMediaKind = 'audio' | 'video';

export const AJN_SHOWS: Record<string, { slug: AjnShowSlug; name: string }> = {
  Alex: { slug: 'alex-jones', name: 'Alex Jones' },
  WarRoom: { slug: 'war-room', name: 'War Room' },
  SundayLive: { slug: 'sunday-night-live', name: 'Sunday Night Live' },
};
const SHOW_BY_TITLE: Record<string, string> = { 'Alex Jones': 'Alex', 'War Room': 'WarRoom', 'Sunday Night Live': 'SundayLive' };
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

// 20261002_Fri_Alex.mp3 | 20260926_Sat_Alex-Special.mp3 | 20261002_Fri_WarRoom-Hr3.mp3 | 20261002_Fri_WarRoom-Hr3.m4v
const FILE_RE = /^(?<date>\d{8})_(?<dow>Mon|Tue|Wed|Thu|Fri|Sat|Sun)_(?<show>Alex|WarRoom|SundayLive)(?:-Hr(?<hour>\d+))?(?:-(?<variant>[A-Za-z]+))?\.(?<ext>mp3|m4v|mp4)$/;
// "Alex Jones 2026-Oct-02 Friday"
const TITLE_RE = /^(?<show>Alex Jones|War Room|Sunday Night Live)\s+(?<date>\d{4}-[A-Za-z]{3}-\d{2})\s+(?<dow>[A-Za-z]+day)$/;

export type AjnReviewReason =
  | 'unrecognized_filename' | 'invalid_filename_date' | 'weekday_mismatch'
  | 'title_filename_date_mismatch' | 'title_filename_show_mismatch' | 'unknown_variant';

export interface AjnClassified {
  fileName: string | null;
  fileKey: string | null;            // filename without extension; identical for the audio and video of the same hour
  kind: AjnMediaKind | null;
  showSlug: AjnShowSlug | null;
  showType: AjnShowType | null;
  airDate: string | null;            // YYYY-MM-DD from the filename only
  hourNumber: number | null;
  variant: string | null;
  cleanTitle: string;
  needsReview: boolean;
  reviewReasons: AjnReviewReason[];
}

export interface AjnClassifyInput { url: string; title?: string | null }
export interface AjnClassifyOptions { exclusiveVariants?: readonly string[] }

function parseCompactDate(value: string): { iso: string; dow: (typeof DOW)[number] } | null {
  const year = Number(value.slice(0, 4)); const month = Number(value.slice(4, 6)); const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { iso: `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`, dow: DOW[date.getUTCDay()] };
}

function parseTitleDate(value: string): string | null {
  const [year, mon, day] = value.split('-');
  const month = MONTHS.findIndex(name => name.toLowerCase() === mon.toLowerCase());
  return month < 0 ? null : parseCompactDate(`${year}${String(month + 1).padStart(2, '0')}${day}`)?.iso ?? null;
}

export function formatAirDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return `${DOW[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]} ${MONTHS[month - 1]} ${day}, ${year}`;
}

export function fileNameOf(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    return decodeURIComponent(pathname.slice(pathname.lastIndexOf('/') + 1)) || null;
  } catch { return null; }
}

/** `https://h/hourly-mp3/20261002_Fri_WarRoom-Hr3.mp3` -> `20261002_Fri_WarRoom-Hr3`. */
export function fileKeyOf(url: string): string | null {
  const name = fileNameOf(url);
  if (!name) return null;
  return name.replace(/\.[A-Za-z0-9]+$/, '') || null;
}

const cleanRaw = (title: string | null | undefined, fallback: string): string =>
  (title ?? '').replace(/^AUDIO\s*-\s*/i, '').trim().slice(0, 255) || fallback;

export function classifyAjnMedia(input: AjnClassifyInput, options: AjnClassifyOptions = {}): AjnClassified {
  const fileName = fileNameOf(input.url);
  const key = fileKeyOf(input.url);
  const reasons: AjnReviewReason[] = [];
  const match = fileName ? FILE_RE.exec(fileName) : null;
  const titleMatch = input.title ? TITLE_RE.exec(input.title) : null;

  if (!match?.groups) {
    const fallbackShow = titleMatch?.groups ? AJN_SHOWS[SHOW_BY_TITLE[titleMatch.groups.show]] : null;
    return {
      fileName, fileKey: key, kind: null, showSlug: fallbackShow?.slug ?? null, showType: null, airDate: null, hourNumber: null, variant: null,
      cleanTitle: cleanRaw(input.title, fileName ?? input.url), needsReview: true, reviewReasons: ['unrecognized_filename'],
    };
  }

  const { date, dow, show, hour, variant, ext } = match.groups;
  const showInfo = AJN_SHOWS[show];
  const parsed = parseCompactDate(date);
  let airDate: string | null = null;
  if (!parsed) reasons.push('invalid_filename_date');
  else if (parsed.dow !== dow) reasons.push('weekday_mismatch');
  else airDate = parsed.iso;

  if (titleMatch?.groups) {
    const titleDate = parseTitleDate(titleMatch.groups.date);
    if (titleDate && parsed && titleDate !== parsed.iso) reasons.push('title_filename_date_mismatch');
    if (AJN_SHOWS[SHOW_BY_TITLE[titleMatch.groups.show]]?.slug !== showInfo.slug) reasons.push('title_filename_show_mismatch');
  }

  const exclusive = (options.exclusiveVariants ?? ['Special']).map(v => v.toLowerCase());
  const isSpecial = variant !== undefined && variant.toLowerCase() === 'special';
  if (variant !== undefined && !isSpecial && !exclusive.includes(variant.toLowerCase())) reasons.push('unknown_variant');

  const hourNumber = hour === undefined ? null : Number(hour);
  const showType: AjnShowType = hourNumber !== null ? 'hour' : isSpecial ? 'special' : 'full_show';
  const datePart = airDate ? formatAirDate(airDate) : null;
  const cleanTitle = datePart
    ? [showInfo.name + (isSpecial ? ' Special' : ''), hourNumber !== null ? `Hour ${hourNumber}` : null, datePart].filter(Boolean).join(' — ')
    : cleanRaw(input.title, fileName ?? input.url);

  return {
    fileName, fileKey: key, kind: ext === 'mp3' ? 'audio' : 'video', showSlug: showInfo.slug, showType, airDate, hourNumber,
    variant: variant ?? null, cleanTitle, needsReview: reasons.length > 0, reviewReasons: reasons,
  };
}

/** Which AJN section an item belongs to. Exclusive membership is configuration (default: variant `Special`), never inferred. */
export function channelFor(item: Pick<AjnClassified, 'variant'>, exclusiveVariants: readonly string[] = ['Special']): AjnChannel {
  const variant = item.variant?.toLowerCase();
  return variant && exclusiveVariants.some(v => v.toLowerCase() === variant) ? 'ajn-exclusive' : 'ajn-radio';
}

export const AJN_CHANNEL_LABELS: Record<AjnChannel, string> = { 'ajn-radio': 'AJN Radio', 'ajn-exclusive': 'AJN Exclusive' };
