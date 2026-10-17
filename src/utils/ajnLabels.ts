// Pure label parser for AJN feed items. Never guesses: returns null when the title/url do not match a known pattern.
export interface AjnLabel {
  show: string;          // "Alex Jones" | "War Room" | "Sunday Night Live"
  detail: string;        // "Hour 3" | "Special" | "Full show"
  dateISO: string;       // "2026-10-09" (calendar date from the file name or title, no timezone conversion)
  dateLabel: string;     // "Fri Oct 9" (weekday computed from the date)
  key: string;           // "20261009|warroom|hr3" | "...|special" | "...|full"
  groupKey: string;      // "20261009|warroom" (same day + show; links video, hourly audio and full-show audio)
}

const SHOW_NAMES: Record<string, string> = { alex: 'Alex Jones', warroom: 'War Room', sundaylive: 'Sunday Night Live' };
const TITLE_SHOWS: Record<string, string> = { 'alex jones': 'alex', 'war room': 'warroom', 'sunday night live': 'sundaylive' };
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const FILE_RE = /(\d{4})(\d{2})(\d{2})_[A-Za-z]{3}_(Alex|WarRoom|SundayLive)(?:-(?:Hr(\d{1,2})|(Special)))?(?![A-Za-z0-9])/;
const TITLE_RE = /^(Alex Jones|War Room|Sunday Night Live)\s+(\d{4})-([A-Za-z]{3})-(\d{1,2})\b/i;

function build(y: number, m: number, d: number, slug: string, hour?: number, special?: boolean): AjnLabel | null {
  const t = Date.UTC(y, m - 1, d);
  const dt = new Date(t);
  if (!Number.isFinite(t) || dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  const p2 = (n: number) => String(n).padStart(2, '0');
  const ymd = `${y}${p2(m)}${p2(d)}`;
  const part = hour !== undefined ? `hr${hour}` : special ? 'special' : 'full';
  return {
    show: SHOW_NAMES[slug],
    detail: hour !== undefined ? `Hour ${hour}` : special ? 'Special' : 'Full show',
    dateISO: `${y}-${p2(m)}-${p2(d)}`,
    dateLabel: `${DAY_LABELS[dt.getUTCDay()]} ${MONTH_LABELS[m - 1]} ${d}`,
    key: `${ymd}|${slug}|${part}`,
    groupKey: `${ymd}|${slug}`,
  };
}

export function labelAjnItem(item: { title?: string; url?: string }): AjnLabel | null {
  for (const text of [item.title ?? '', (item.url ?? '').split('?')[0].split('/').pop() ?? '']) {
    const f = FILE_RE.exec(text);
    if (f) {
      const slug = f[4].toLowerCase();
      return build(Number(f[1]), Number(f[2]), Number(f[3]), slug, f[5] !== undefined ? Number(f[5]) : undefined, f[6] !== undefined);
    }
  }
  const t = TITLE_RE.exec(item.title ?? '');
  if (t) {
    const mi = MONTHS.indexOf(t[3].toLowerCase());
    if (mi >= 0) return build(Number(t[2]), mi + 1, Number(t[4]), TITLE_SHOWS[t[1].toLowerCase()]);
  }
  return null;
}
