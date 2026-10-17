// A short window of the day that follows the red "now" line, so the guide needs no side-scrolling.
// Pure helpers. Hours are grid hours (0-24, the viewer's local day).
export const DAY_HOURS = 24;
export const MIN_HOURS = 2;
export const MAX_HOURS = 8;
export const TARGET_PX_PER_HOUR = 150;
/** Where the red line sits inside the window when following (share of the window before it). */
export const LEAD_FRACTION = 0.25;
const SNAP_HOURS = 0.5;

export interface TimeWindow { startHour: number; endHour: number; hours: number; pxPerHour: number }

export function clamp(n: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, n)); }

/** Hours that fit comfortably: about TARGET_PX_PER_HOUR each, limited to 2-8 h. `preferred` wins when given. */
export function windowHoursFor(widthPx: number, preferred?: number | null): number {
  if (typeof preferred === "number" && Number.isFinite(preferred)) return clamp(Math.round(preferred), MIN_HOURS, MAX_HOURS);
  const w = Number.isFinite(widthPx) && widthPx > 0 ? widthPx : 960;
  return clamp(Math.floor(w / TARGET_PX_PER_HOUR), MIN_HOURS, MAX_HOURS);
}

/** Follow mode: red line about a quarter in, start snapped to 30 minutes so the grid moves rarely. */
export function followStart(nowHour: number, hours: number): number {
  const raw = nowHour - hours * LEAD_FRACTION;
  const snapped = Math.floor(raw / SNAP_HOURS) * SNAP_HOURS;
  return clamp(snapped, 0, DAY_HOURS - hours);
}

/** `panStart` null = follow now; a number = the user is browsing from that hour. */
export function computeWindow(nowHour: number, widthPx: number, panStart: number | null = null, preferredHours: number | null = null): TimeWindow {
  const hours = windowHoursFor(widthPx, preferredHours);
  const startHour = panStart === null ? followStart(nowHour, hours) : clamp(Math.round(panStart / SNAP_HOURS) * SNAP_HOURS, 0, DAY_HOURS - hours);
  const w = Number.isFinite(widthPx) && widthPx > 0 ? widthPx : 960;
  return { startHour, endHour: startHour + hours, hours, pxPerHour: w / hours };
}

/** Shift by half a window (Earlier / Later). Returns the new panStart. */
export function panBy(window: TimeWindow, direction: -1 | 1): number {
  return clamp(window.startHour + direction * (window.hours / 2), 0, DAY_HOURS - window.hours);
}

/** Lazy rendering: only blocks that intersect the window (with a small margin) get DOM. */
export function intersects(sHour: number, eHour: number, window: TimeWindow, marginHours = 0): boolean {
  return sHour < window.endHour + marginHours && eHour > window.startHour - marginHours;
}

/** Visible part of a block, in grid hours. */
export function clipToWindow(sHour: number, eHour: number, window: TimeWindow): { s: number; e: number } {
  return { s: Math.max(sHour, window.startHour), e: Math.min(eHour, window.endHour) };
}

export function redLineLeft(nowHour: number, window: TimeWindow): number | null {
  if (nowHour < window.startHour || nowHour > window.endHour) return null;
  return (nowHour - window.startHour) * window.pxPerHour;
}
