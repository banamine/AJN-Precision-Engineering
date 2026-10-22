/** Pure filename parsing for the All My Children Archive snapshot. */

export const ALL_MY_CHILDREN_KINDS = [
  'full',
  'part',
  'promo',
  'clip',
  'recap',
  'compilation',
  'credits',
  'other',
] as const;

export type AllMyChildrenKind = (typeof ALL_MY_CHILDREN_KINDS)[number];

export interface AllMyChildrenPart {
  number: number;
  total: number;
  variant?: 'a' | 'b';
}

export interface ParsedAllMyChildrenName {
  date: string | null;
  episode: number | null;
  part: AllMyChildrenPart | null;
  kind: AllMyChildrenKind;
  subtitle: string | null;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const WEEKDAY_TOKEN = /^(?:mon|tue|wed|thu|fri|sat|sun)/i;
const STEM_EXT = /\.(?:mp4|m4v|mov|avi|mkv|webm|mpg|mpeg|ogv)$/i;

function basename(value: string): string {
  return value.split(/[\\/]/).pop() ?? value;
}

function validDate(year: number, month: number, day: number): string | null {
  if (year < 1980 || year > 1992 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseDate(stem: string): { date: string | null; end: number } {
  const match = /^AMc\s*(\d{2})\s*-\s*(\d{2})\s*-\s*(\d{2})/i.exec(stem);
  if (!match) return { date: null, end: 0 };
  const year = 1900 + Number(match[1]);
  return { date: validDate(year, Number(match[2]), Number(match[3])), end: match[0].length };
}

function parseEpisode(stem: string): { episode: number | null; end: number } {
  const match = /Ep\s*(\d{4})/i.exec(stem);
  return match
    ? { episode: Number(match[1]), end: match.index + match[0].length }
    : { episode: null, end: 0 };
}

function parsePart(tail: string, date: string | null, hasEpisode: boolean): AllMyChildrenPart | null {
  const afterMarker = tail.replace(/^Ep\s*-*/i, '');
  const weekday = /^(?:mon|tue|wed|thu|fri|sat|sun)(\d{2})?/i.exec(afterMarker);
  if (weekday && date) {
    let suffix = afterMarker.slice(weekday[0].length);
    const day = weekday[1];
    if (day && Number(day) === Number(date.slice(8, 10))) {
      const concatenated = /^(\d)-(\d{1,2})([ab])?/i.exec(suffix);
      if (concatenated) {
        const number = Number(concatenated[1]);
        const total = Number(concatenated[2]);
        if (number > 0 && total >= number && total <= 12) {
          return {
            number,
            total,
            ...(concatenated[3] ? { variant: concatenated[3].toLowerCase() as 'a' | 'b' } : {}),
          };
        }
      }
    }
    const leading = /^(\d{1,2})-(\d{1,2})([ab])?/i.exec(suffix);
    if (leading) {
      const number = Number(leading[1]);
      const total = Number(leading[2]);
      if (number > 0 && total >= number && total <= 12) {
        return {
          number,
          total,
          ...(leading[3] ? { variant: leading[3].toLowerCase() as 'a' | 'b' } : {}),
        };
      }
    }
  }
  if (!hasEpisode) return null;

  const matches: AllMyChildrenPart[] = [];
  const pattern = /(^|[^0-9])(\d{1,2})-(\d{1,2})([ab])?(?!\d)/gi;
  for (const match of tail.matchAll(pattern)) {
    const number = Number(match[2]);
    const total = Number(match[3]);
    if (number > 0 && total >= number && total <= 12) {
      return {
        number,
        total,
        ...(match[4] ? { variant: match[4].toLowerCase() as 'a' | 'b' } : {}),
      };
    }
  }
  return null;
}

function cleanSubtitle(tail: string, part: AllMyChildrenPart | null): string | null {
  const hasClearWordBoundary = /[a-z0-9][A-Z]|[A-Z]{2}[a-z]/.test(tail) || /\s/.test(tail.trim());
  if (!hasClearWordBoundary) return null;
  let value = tail
    .replace(WEEKDAY_TOKEN, '')
    .replace(/(?:^|[^0-9])\d{1,2}-\d{1,2}[ab]?(?!\d)/gi, ' ')
    .replace(/^(?:\d{1,2})/, '')
    .replace(/\b(?:full|promo|teaser|preview|recap|clips?|interview|special|credits?)\b/gi, ' ')
    .replace(/[_.,;:()[\]{}]+/g, ' ')
    .replace(/(?<=[a-z0-9])(?=[A-Z])/g, ' ')
    .replace(/(?<=[A-Z])(?=[A-Z][a-z])/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (part) value = value.replace(/\b[a-b]\b/gi, ' ').replace(/\s+/g, ' ').trim();
  if (!value || value.length > 80 || !/[A-Za-z]/.test(value)) return null;
  return value;
}

function kindFor(stem: string, lengthSeconds?: number | null, part?: AllMyChildrenPart | null): AllMyChildrenKind {
  const folded = stem.toLowerCase();
  if (/opening.?credits?|credits?[-_ ]?only/.test(folded)) return 'credits';
  if (/amc.?through.?the.?years|through.?the.?years/.test(folded)) return 'compilation';
  if (/\brecaps?\b|recap/i.test(folded)) return 'recap';
  if (/promo|teaser|preview|newep[-_ ]{2,}/i.test(folded)) return 'promo';
  if (/\bclips?\b|clip/i.test(folded)) return 'clip';
  if (part || /\bpart\b/i.test(folded)) return 'part';
  if (typeof lengthSeconds === 'number' && lengthSeconds >= 1500 && lengthSeconds <= 4980) return 'full';
  return 'other';
}

/** Parse known filename facts only; absent or malformed fields remain null. */
export function parseAllMyChildrenFileName(
  fileName: string,
  lengthSeconds?: number | null,
): ParsedAllMyChildrenName {
  const stem = basename(fileName).replace(STEM_EXT, '').replace(/\.ia$/i, '');
  const parsedDate = parseDate(stem);
  const parsedEpisode = parseEpisode(stem);
  const tailStart = parsedEpisode.episode !== null
    ? parsedEpisode.end
    : parsedDate.date !== null
      ? parsedDate.end
      : 0;
  const tail = stem.slice(tailStart);
  const part = parsePart(tail, parsedDate.date, parsedEpisode.episode !== null);
  return {
    date: parsedDate.date,
    episode: parsedEpisode.episode,
    part,
    kind: kindFor(stem, lengthSeconds, part),
    subtitle: cleanSubtitle(tail, part),
  };
}

export function allMyChildrenWeekday(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split('-').map(Number);
  const valid = validDate(year, month, day);
  return valid ? WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] : null;
}
