import type { RumbleBaseline, RumbleItem } from "./types";
import { rankNewsWall } from "./rank";

/** Channel that must always hold a wall slot (user requirement: RT News 24/7). */
export const PINNED_CHANNEL_ID = "news-rt";

export interface WallSource {
  /** Stable key for selects and React lists. */
  key: string;
  /** Rumble EMBED id (not the page id). */
  embedId: string;
  label: string;
  detail: string;
  viewers?: number;
  pinned?: boolean;
  backup?: boolean;
}

/**
 * Backup / rotation candidates taken from the Embed dialog export of 2026-09-30.
 * Embed ids only; they are live streams and may end, so the UI labels them as backups.
 */
export const BACKUP_STREAMS: readonly WallSource[] = [
  { key: "backup-v7e115e", embedId: "v7e115e", label: "Red Pill News", detail: "Backup" },
  { key: "backup-v7e0s1u", embedId: "v7e0s1u", label: "Barry Cunningham", detail: "Backup" },
  { key: "backup-v7e179m", embedId: "v7e179m", label: "Jimmy Dore", detail: "Backup" },
  { key: "backup-v7dxe6a", embedId: "v7dxe6a", label: "War Room Live", detail: "Backup" },
  { key: "backup-v7e134a", embedId: "v7e134a", label: "Kim Iversen", detail: "Backup" },
  { key: "backup-v7e13ii", embedId: "v7e13ii", label: "Absolute Storm", detail: "Backup" },
  { key: "backup-v7e13oc", embedId: "v7e13oc", label: "Nick DiPaolo", detail: "Backup" },
  { key: "backup-v7dznoi", embedId: "v7dznoi", label: "BEERatthePARADE", detail: "Backup" },
  { key: "backup-v7e0sy4", embedId: "v7e0sy4", label: "Just The News", detail: "Backup" },
  { key: "backup-v7d2asy", embedId: "v7d2asy", label: "Alex Jones Network replays (Ron Gibson)", detail: "Backup" },
  { key: "backup-v7bhj6q", embedId: "v7bhj6q", label: "LindellTV 24/7", detail: "Backup" },
  { key: "backup-v7e0hug", embedId: "v7e0hug", label: "David Knight Show", detail: "Backup" },
].map((source) => ({ ...source, backup: true }));

export function embedUrl(embedId: string): string {
  return `https://rumble.com/embed/${encodeURIComponent(embedId)}/?pub=4`;
}

/** Accepts a bare embed id or an embed URL. Returns null for anything else. */
export function parseEmbedId(input: string): string | null {
  const text = String(input ?? "").trim();
  const fromUrl = text.match(/^https:\/\/rumble\.com\/embed\/(v[a-z0-9]{3,12})\/?(?:[?#].*)?$/i);
  if (fromUrl) return fromUrl[1].toLowerCase();
  const bare = text.match(/^(v[a-z0-9]{3,12})$/i);
  return bare ? bare[1].toLowerCase() : null;
}

export function toSource(item: RumbleItem, baseline: RumbleBaseline): WallSource {
  const channel = baseline.channels.find((entry) => entry.id === item.channelId);
  return {
    key: `${item.channelId}:${item.embedId}`,
    embedId: item.embedId,
    label: channel?.name ?? item.channelId,
    detail: item.title,
    viewers: item.viewers,
    pinned: item.channelId === PINNED_CHANNEL_ID,
  };
}

/** Pinned always-on slot first, then the highest-viewer live streams (max 1 per channel, 2 per network). */
export function buildNewsWall(baseline: RumbleBaseline, max = 4): RumbleItem[] {
  if (max <= 0) return [];
  const pinned = baseline.items.find((item) => item.channelId === PINNED_CHANNEL_ID && item.state === "live");
  const rest = rankNewsWall(
    { ...baseline, items: baseline.items.filter((item) => item.channelId !== PINNED_CHANNEL_ID) },
    { max: pinned ? max - 1 : max },
  );
  return pinned ? [pinned, ...rest] : rest;
}

/** Every stream a panel can switch to: live items by viewers, then the backups. */
export function listPickerSources(baseline: RumbleBaseline): WallSource[] {
  const live = baseline.items
    .filter((item) => item.state === "live")
    .sort((a, b) => (b.viewers ?? 0) - (a.viewers ?? 0))
    .map((item) => toSource(item, baseline));
  const known = new Set(live.map((source) => source.embedId));
  return [...live, ...BACKUP_STREAMS.filter((source) => !known.has(source.embedId))];
}
