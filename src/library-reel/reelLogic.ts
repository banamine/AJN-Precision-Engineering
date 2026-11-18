/** Pure rules for the library homepage preview: who gets it, how a capture id becomes a date line, and shuffle/history.
 *  No React, no network, so it can be tested without a browser. */
import type { NowPlayingMedia } from "../types";

export const ROTATION_MS = 12_000;
export const MAX_HISTORY = 40;
export const MAX_LOAD_ATTEMPTS = 3;
export const ID_RE = /^\d{8}T\d{6}[+-]\d{4}$/;

/** Alex Jones / Infowars audio only, judged by the source's own channel and path, never by a loose title match. */
const INFOWARS_CHANNELS = new Set(["archive-infowars-radio", "radio:ajn-infowars-live-aac"]);
/** The Alex Jones audio channels in the Audio & Podcasts section (nwt-audio-alexjonesradioshow-…, nwt-audio-alex-jones-…). */
const ALEX_AUDIO_CHANNEL = /^nwt-audio-alex-?jones/;
/** Round cover for the Alex Jones audio channels in Audio & Podcasts (full show title fits inside the circle). */
export const ALEX_ROUND_ART = "/ajn-art/alex-show-round.jpg";
export function alexPodcastArt(channelId: string | undefined | null): string | undefined {
  return channelId && (channelId === "archive-infowars-radio" || ALEX_AUDIO_CHANNEL.test(channelId)) ? ALEX_ROUND_ART : undefined;
}
export function isInfowarsAudio(np: Pick<NowPlayingMedia, "channelId" | "archivePath" | "mediaType"> | undefined | null): boolean {
  if (!np || np.mediaType === "video") return false;
  if (np.channelId && (INFOWARS_CHANNELS.has(np.channelId) || ALEX_AUDIO_CHANNEL.test(np.channelId))) return true;
  return /\/The_Alex_Jones_Radio_Show_\d{8}_\d{6}\//.test(np.archivePath ?? "");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "20250610T065900-0500" -> "10 Jun 2025 - 6:59 am UTC-05:00". Uses the capture's own clock and numeric offset; never guesses a zone name or converts. */
export function formatDateLine(id: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})\d{2}([+-])(\d{2})(\d{2})$/.exec(id);
  if (!m) return null;
  const month = Number(m[2]); const day = Number(m[3]); const hour = Number(m[4]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || Number(m[5]) > 59) return null;
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${day} ${MONTHS[month - 1]} ${m[1]} - ${h12}:${m[5]} ${hour < 12 ? "am" : "pm"} UTC${m[6]}${m[7]}:${m[8]}`;
}

export function imageUrl(id: string): string { return `/api/library/homepage-image?id=${encodeURIComponent(id)}`; }

export interface ReelHistory { items: string[]; cursor: number }
export const emptyHistory = (): ReelHistory => ({ items: [], cursor: -1 });
export const canGoBack = (h: ReelHistory): boolean => h.cursor > 0;
export const canGoForwardInHistory = (h: ReelHistory): boolean => h.cursor >= 0 && h.cursor < h.items.length - 1;
export const currentOf = (h: ReelHistory): string | null => (h.cursor >= 0 ? h.items[h.cursor] ?? null : null);

/** A capture enters history only after it has loaded and been shown. Showing something new drops any "forward" captures. */
export function commitShown(h: ReelHistory, id: string): ReelHistory {
  let items = [...h.items.slice(0, h.cursor + 1), id];
  if (items.length > MAX_HISTORY) items = items.slice(items.length - MAX_HISTORY);
  return { items, cursor: items.length - 1 };
}
export const stepBack = (h: ReelHistory): ReelHistory => (canGoBack(h) ? { ...h, cursor: h.cursor - 1 } : h);
export const stepForward = (h: ReelHistory): ReelHistory => (canGoForwardInHistory(h) ? { ...h, cursor: h.cursor + 1 } : h);

/** Random capture that is not the current one and not one that already failed this round. null when nothing is left to try. */
export function pickCandidate(ids: readonly string[], current: string | null, failed: ReadonlySet<string>, rng: () => number = Math.random): string | null {
  const pool = ids.filter((i) => i !== current && !failed.has(i));
  if (pool.length === 0) return null;
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}

/** Zoom steps for the viewer, in percent of the capture's own pixel width. */
export const ZOOM_STEPS = [25, 50, 75, 100, 125, 150, 200, 300] as const;
export function zoomIn(pct: number): number { return ZOOM_STEPS.find((s) => s > pct) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]; }
export function zoomOut(pct: number): number { return [...ZOOM_STEPS].reverse().find((s) => s < pct) ?? ZOOM_STEPS[0]; }
