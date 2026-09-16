import type { AjnVisualAsset } from "./ajn-media";

/**
 * Curated display assets only. These URLs are never playback sources.
 */
export const AJN_VISUAL_ASSETS: readonly AjnVisualAsset[] = [
  {
    key: "alex-jones-show",
    title: "Alex Jones Show",
    imageUrl: "https://archive.org/download/daily-highlights/Alex%20Jones%20Show.png",
    category: "AJN",
  },
  {
    key: "war-room",
    title: "War Room",
    imageUrl: "https://archive.org/download/daily-highlights/warroom_thumb.jpg",
    category: "AJN",
  },
  {
    key: "classic-archive",
    title: "Classic Episodes",
    imageUrl: "https://archive.org/download/daily-highlights/Classic%20Archive.png",
    category: "Classic TV",
  },
  {
    key: "special-coverage",
    title: "Special Coverage",
    imageUrl: "https://archive.org/download/daily-highlights/Emergency%20Broadcast.png",
    category: "Special Coverage",
  },
  {
    key: "special-report",
    title: "Special Report",
    imageUrl: "https://dn720602.ca.archive.org/0/items/daily-highlights/Special%20Report.png",
    category: "Special Coverage",
  },
  {
    key: "emergency-broadcast",
    title: "Emergency Broadcast",
    imageUrl: "https://ia600602.us.archive.org/10/items/daily-highlights/emegency.png",
    category: "Special Coverage",
  },
] as const;

export const AJN_VISUAL_ASSET_MAP: Readonly<Record<string, AjnVisualAsset>> =
  Object.fromEntries(AJN_VISUAL_ASSETS.map((asset) => [asset.key, asset]));
