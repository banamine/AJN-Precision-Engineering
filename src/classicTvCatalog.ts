/**
 * Classic TV catalog integration point.
 *
 * This module intentionally keeps catalog discovery separate from the player.
 * The authoritative source is the organized Archive.org M3U catalog documented
 * in the AJN Google Cloud drop-in material. Runtime resolution is fail-closed:
 * no invented media URLs are generated here.
 */

export const CLASSIC_TV_M3U_ROOT =
  "https://archive.org/download/daily-highlights/daily-highlights-organized/m3u_files/";

export interface ClassicTvCatalogEntry {
  title: string;
  playlistUrl: string;
  category: string;
}

const EXCLUDED_TERMS = [
  "ajn",
  "alex",
  "war room",
  "news",
  "radio",
  "audio",
  "music",
  "podcast",
];

export function isClassicTvTitle(title: string): boolean {
  const normalized = title.trim().toLowerCase();
  if (!normalized) return false;
  return !EXCLUDED_TERMS.some((term) => normalized.includes(term));
}

export function buildClassicTvPlaylistUrl(filename: string): string {
  const clean = filename.trim().replace(/^\/+/, "");
  if (!clean || clean.includes("..")) {
    throw new Error("Invalid Classic TV playlist filename");
  }
  return new URL(clean, CLASSIC_TV_M3U_ROOT).toString();
}
