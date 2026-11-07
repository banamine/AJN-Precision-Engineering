import type { DateStatus } from './types';

const TITLE_ZONE_REGEX = /\b(TST|PDT|EDT|EST|CDT|CST|MDT|MST|CET|CEST|GMT|UTC)\b/;

const TIME = String.raw`\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?`;
const HAS_Z = new RegExp(`${TIME}\\s*Z$`, 'i');
const HAS_OFFSET = new RegExp(`${TIME}\\s*[+-]\\d{2}:?\\d{2}$`);
const HAS_NAMED_UTC = new RegExp(`${TIME}\\s+(?:GMT|UTC|UT)$`, 'i');

/**
 * 'valid' only when the string carries an explicit zone (Z, numeric offset, GMT/UTC).
 * Zone-less strings are 'ambiguous' (never interpreted in the machine's local zone);
 * date-only strings are also 'ambiguous' by design. Fetch time is never substituted.
 */
export function classifyDate(raw: unknown): { status: DateStatus; iso?: string } {
  if (raw === undefined || raw === null || raw === '') return { status: 'missing' };
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? { status: 'malformed' } : { status: 'valid', iso: raw.toISOString() };
  }
  if (typeof raw !== 'string') return { status: 'malformed' };
  const str = raw.trim();
  if (!str) return { status: 'missing' };
  const ms = Date.parse(str);
  if (Number.isNaN(ms)) return { status: 'malformed' };
  if (!(HAS_Z.test(str) || HAS_OFFSET.test(str) || HAS_NAMED_UTC.test(str))) return { status: 'ambiguous' };
  return { status: 'valid', iso: new Date(ms).toISOString() };
}

/** A zone label inside a title (e.g. "TST") is reported separately and never alters a structured timestamp. */
export function checkTitleZoneLabel(title: string | null): string | null {
  if (!title) return null;
  const match = title.match(TITLE_ZONE_REGEX);
  return match ? match[1] : null;
}
