import type { BannedVideoChannel, BannedVideoItem, BannedVideoNetwork, BannedVideoSnapshot } from "./types";

export const BANNED_VIDEO_ID = /^v[a-z0-9]{6}$/;
const NETWORKS: readonly BannedVideoNetwork[] = ["ajn", "rav", "other"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** https only, host exactly banned.video (no subdomain, userinfo or port), path must start with `prefix`. */
export function isBannedVideoUrl(text: unknown, prefix: string): text is string {
  if (typeof text !== "string") return false;
  try {
    const url = new URL(text);
    return url.protocol === "https:"
      && url.hostname === "banned.video"
      && url.username === "" && url.password === "" && url.port === ""
      && url.pathname.startsWith(prefix);
  } catch {
    return false;
  }
}

export function embedUrlFor(id: string): string {
  if (!BANNED_VIDEO_ID.test(id)) throw new Error(`Not a banned.video id: ${id}`);
  return `https://banned.video/embed/${id}`;
}

function checkChannel(value: unknown, index: number): BannedVideoChannel | string {
  if (!isRecord(value)) return `channels[${index}] is not an object`;
  const { name, network, datedTitles } = value;
  if (typeof name !== "string" || !name.trim()) return `channels[${index}].name is missing`;
  if (typeof network !== "string" || !NETWORKS.includes(network as BannedVideoNetwork)) {
    return `channels[${index}].network must be ajn, rav or other`;
  }
  if (typeof datedTitles !== "boolean") return `channels[${index}].datedTitles must be true or false`;
  return { name, network: network as BannedVideoNetwork, datedTitles };
}

function checkItem(value: unknown, index: number, channelNames: Set<string>): BannedVideoItem | string {
  if (!isRecord(value)) return `items[${index}] is not an object`;
  const { id, rank, title, channel, durationSec, thumbnailUrl, watchUrl, maxHeight } = value;
  if (typeof id !== "string" || !BANNED_VIDEO_ID.test(id)) return `items[${index}].id is not a banned.video id`;
  if (typeof rank !== "number" || !Number.isInteger(rank) || rank < 1) return `items[${index}].rank must be a whole number from 1`;
  if (typeof title !== "string" || !title.trim()) return `items[${index}].title is missing`;
  if (typeof channel !== "string" || !channelNames.has(channel)) return `items[${index}].channel is not in the channels list`;
  if (typeof durationSec !== "number" || !Number.isFinite(durationSec) || durationSec <= 0) return `items[${index}].durationSec must be above 0`;
  if (!isBannedVideoUrl(thumbnailUrl, "/media/")) return `items[${index}].thumbnailUrl must be a https://banned.video/media/ URL`;
  if (!isBannedVideoUrl(watchUrl, `/v/${id}`)) return `items[${index}].watchUrl must be https://banned.video/v/${id}…`;
  if (!(maxHeight === null || (typeof maxHeight === "number" && Number.isInteger(maxHeight) && maxHeight > 0))) {
    return `items[${index}].maxHeight must be a whole number or null`;
  }
  return { id, rank, title, channel, durationSec, thumbnailUrl, watchUrl, maxHeight: maxHeight as number | null };
}

export type SnapshotCheck = { ok: true; snapshot: BannedVideoSnapshot } | { ok: false; error: string };

/** Never throws. Rejects the whole snapshot on the first problem so a bad file can't half-render. */
export function validateBannedVideoSnapshot(raw: unknown): SnapshotCheck {
  if (!isRecord(raw)) return { ok: false, error: "Snapshot is not an object." };
  if (raw.version !== 1) return { ok: false, error: "Snapshot version must be 1." };
  if (typeof raw.source !== "string") return { ok: false, error: "Snapshot source is missing." };
  if (!Array.isArray(raw.pages) || !raw.pages.every((p) => Number.isInteger(p))) return { ok: false, error: "Snapshot pages must be numbers." };
  if (typeof raw.scrapedAt !== "string" || Number.isNaN(Date.parse(raw.scrapedAt))) return { ok: false, error: "Snapshot scrapedAt is not a date." };
  if (!Array.isArray(raw.channels) || !Array.isArray(raw.items)) return { ok: false, error: "Snapshot needs channels and items lists." };

  const channels: BannedVideoChannel[] = [];
  for (let i = 0; i < raw.channels.length; i += 1) {
    const checked = checkChannel(raw.channels[i], i);
    if (typeof checked === "string") return { ok: false, error: checked };
    if (channels.some((c) => c.name === checked.name)) return { ok: false, error: `Channel listed twice: ${checked.name}` };
    channels.push(checked);
  }
  const names = new Set(channels.map((c) => c.name));
  const items: BannedVideoItem[] = [];
  const ids = new Set<string>();
  for (let i = 0; i < raw.items.length; i += 1) {
    const checked = checkItem(raw.items[i], i, names);
    if (typeof checked === "string") return { ok: false, error: checked };
    if (ids.has(checked.id)) return { ok: false, error: `Video listed twice: ${checked.id}` };
    ids.add(checked.id);
    items.push(checked);
  }
  return {
    ok: true,
    snapshot: {
      version: 1,
      source: raw.source,
      pages: raw.pages as number[],
      scrapedAt: raw.scrapedAt,
      channels,
      items: [...items].sort((a, b) => a.rank - b.rank),
    },
  };
}
