import type { AirDate } from "./types";

/**
 * Air date from a title. Only used for channels whose titles carry real air dates
 * (snapshot channel flag `datedTitles`). banned.video's own "age" is UPLOAD age, not air date.
 *
 * Handles: "March 4th, 2008", "Aug 1, 2001", "October 24th, 1999", source typo "Aoril",
 * "(Classic 1997)", "(Classic 1990's)", "mid 1990's". Weekday words are ignored (they are
 * wrong in several source titles). Returns null when nothing trustworthy is found.
 */
const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, aoril: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MIN_YEAR = 1950;

function plausibleYear(year: number, now: Date): boolean {
  return year >= MIN_YEAR && year <= now.getUTCFullYear();
}

export function parseAirDate(title: string, now: Date = new Date()): AirDate | null {
  const text = String(title ?? "");

  // "Month Day(st|nd|rd|th)?, Year"
  const full = text.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+((?:19|20)\d{2})\b/);
  if (full) {
    const month = MONTHS[full[1].toLowerCase()];
    const day = Number(full[2]);
    const year = Number(full[3]);
    if (month && day >= 1 && day <= 31 && plausibleYear(year, now)) return { year, month, day };
  }

  // Decade: "1990's" / "1990s"
  const decade = text.match(/\b((?:19|20)\d0)['’]?s\b/);
  if (decade) {
    const year = Number(decade[1]);
    if (plausibleYear(year, now)) return { year, month: null, day: null };
  }

  // "Classic 1997" (with or without parentheses)
  const classic = text.match(/\bClassic\s+((?:19|20)\d{2})\b/i);
  if (classic) {
    const year = Number(classic[1]);
    if (plausibleYear(year, now)) return { year, month: null, day: null };
  }

  return null;
}

export function formatAirDate(date: AirDate): string {
  if (date.month === null) return `${date.year}`;
  const monthName = new Date(Date.UTC(2000, date.month - 1, 1)).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return date.day === null ? `${monthName} ${date.year}` : `${monthName} ${date.day}, ${date.year}`;
}
