import type { RumbleBaseline, RumbleChannel, RumbleItem } from "./types";
import { rankNewsWall } from "./rank";
import { parseRumblePageUrl, rumblePageUrlForVideoId } from "../news/providers/rumble";

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
  /** Channel this source came from (absent for backups and custom pastes). */
  channelId?: string;
  /** ISO time of the import this pick came from; shown as "as of". */
  asOf?: string;
  /** True when the link lookup failed and the stored embed id was used instead. */
  unverified?: boolean;
  /** True when the embed id came from a live lookup in this session. */
  resolved?: boolean;
  /** Actual user paste time, separate from import/resolve times. */
  pastedAt?: string;
  /** Canonical video page URL; never used as an embed id. */
  pageUrl?: string;
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
    channelId: item.channelId,
    asOf: item.seenAt ?? baseline.generatedAt,
  };
}

/** Pinned always-on slot first, then the highest-viewer live streams (max 1 per channel, 2 per network). */
export function buildNewsWall(
  baseline: RumbleBaseline,
  max = 4,
  options?: { pastedSources: readonly WallSource[]; nowMs: number },
): RumbleItem[] {
  if (max <= 0) return [];
  const pinned = baseline.items.find((item) => item.channelId === PINNED_CHANNEL_ID && item.state === "live");
  if (options) {
    const available = baseline.items.filter((item) => item.channelId !== PINNED_CHANNEL_ID);
    const pasted = options.pastedSources
      .filter((source) => source.pastedAt && Number.isFinite(Date.parse(source.pastedAt)))
      .sort((a, b) => Date.parse(b.pastedAt!) - Date.parse(a.pastedAt!))
      .flatMap((source) => {
        const item = available.find((entry) => entry.channelId === source.channelId
          && entry.embedId === source.embedId && entry.state === "vod");
        return item ? [item] : [];
      });
    const live = rankNewsWall({ ...baseline, items: available }, { max: baseline.items.length });
    const fresh = (item: RumbleItem) => {
      const seen = Date.parse(item.seenAt ?? baseline.generatedAt);
      return Number.isFinite(seen) && options.nowMs - seen < 24 * 3_600_000;
    };
    const ordered = [...live.filter(fresh), ...pasted, ...live.filter((item) => !fresh(item))];
    const selected = pinned ? [pinned] : [];
    const used = new Set(selected.map((item) => item.channelId));
    const networks = new Map<string, number>();
    for (const item of ordered) {
      if (selected.length >= max) break;
      if (used.has(item.channelId)) continue;
      const network = baseline.channels.find((channel) => channel.id === item.channelId)?.network;
      if ((network === "ajn" || network === "rav") && (networks.get(network) ?? 0) >= 2) continue;
      selected.push(item);
      used.add(item.channelId);
      if (network === "ajn" || network === "rav") networks.set(network, (networks.get(network) ?? 0) + 1);
    }
    return selected;
  }
  const rest = rankNewsWall(
    { ...baseline, items: baseline.items.filter((item) => item.channelId !== PINNED_CHANNEL_ID) },
    { max: pinned ? max - 1 : max },
  );
  return pinned ? [pinned, ...rest] : rest;
}

export const WALL_PICKS_KEY = "rumble.wall.picks.v1";
export const MAX_WALL_PICK_CHARS = 32_000;
export interface WallPickStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export type WallPicks = Array<WallSource | null>;
export interface WallStorageResult { ok: boolean; error: string | null }

function storageFailure(detail: string): WallStorageResult {
  return { ok: false, error: `Panel pick storage failed: ${detail}` };
}

/** Rebuild only allowed fields; stored text cannot supply arbitrary player URLs. */
function cleanSavedSource(value: unknown): WallSource | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (typeof source.embedId !== "string" || parseEmbedId(source.embedId) !== source.embedId
    || typeof source.label !== "string" || !source.label.trim() || source.label.length > 200
    || typeof source.detail !== "string" || source.detail.length > 500) return null;
  if (source.channelId !== undefined && (typeof source.channelId !== "string"
    || !/^[a-z0-9_-]{1,100}$/i.test(source.channelId))) return null;
  for (const field of ["asOf", "pastedAt"] as const) {
    if (source[field] !== undefined && (typeof source[field] !== "string"
      || source[field].length > 40 || !Number.isFinite(Date.parse(source[field])))) return null;
  }
  if (source.pageUrl !== undefined && (typeof source.pageUrl !== "string"
    || source.pageUrl.length > 600 || !parseRumblePageUrl(source.pageUrl))) return null;
  if (source.viewers !== undefined && source.viewers !== null
    && (typeof source.viewers !== "number" || !Number.isFinite(source.viewers) || source.viewers < 0)) return null;
  for (const field of ["backup", "pinned", "resolved", "unverified"] as const) {
    if (source[field] !== undefined && typeof source[field] !== "boolean") return null;
  }
  return {
    key: `${source.channelId ?? "link"}:${source.embedId}`,
    embedId: source.embedId,
    label: source.label,
    detail: source.detail,
    ...(source.channelId !== undefined ? { channelId: source.channelId as string } : {}),
    ...(source.asOf !== undefined ? { asOf: source.asOf as string } : {}),
    ...(source.pastedAt !== undefined ? { pastedAt: source.pastedAt as string } : {}),
    ...(source.pageUrl !== undefined ? { pageUrl: parseRumblePageUrl(source.pageUrl as string)!.pageUrl } : {}),
    ...(typeof source.viewers === "number" ? { viewers: source.viewers } : {}),
    ...(source.backup === true ? { backup: true } : {}),
    ...(source.channelId === PINNED_CHANNEL_ID && source.pinned === true ? { pinned: true } : {}),
    ...(source.resolved === true ? { resolved: true } : {}),
    ...(source.unverified === true ? { unverified: true } : {}),
  };
}

function cleanWallPicks(value: unknown): WallPicks | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const picks: WallPicks = [];
  for (const entry of value) {
    if (entry === null) picks.push(null);
    else {
      const source = cleanSavedSource(entry);
      if (!source) return null;
      picks.push(source);
    }
  }
  return picks;
}

/** Manual duplicates may be saved; restoration keeps the first canonical channel only. */
export function uniqueWallPicks(picks: readonly (WallSource | null)[]): WallPicks {
  const used = new Set<string>();
  return Array.from({ length: 4 }, (_, index) => {
    const pick = picks[index] ?? null;
    if (!pick?.channelId) return pick;
    if (used.has(pick.channelId)) return null;
    used.add(pick.channelId);
    return pick;
  });
}

export function loadWallPicks(storage: WallPickStorage | null): { picks: WallPicks; error: string | null } {
  const empty = (): WallPicks => [null, null, null, null];
  if (!storage) return { picks: empty(), ...storageFailure("browser storage is unavailable.") };
  try {
    const raw = storage.getItem(WALL_PICKS_KEY);
    if (raw === null) return { picks: empty(), error: null };
    if (raw.length > MAX_WALL_PICK_CHARS) return { picks: empty(), ...storageFailure("saved picks are oversized; using defaults.") };
    const parsed = JSON.parse(raw);
    const picks = parsed?.version === 1 ? cleanWallPicks(parsed.panels) : null;
    if (!picks) return { picks: empty(), ...storageFailure("saved picks are invalid; using defaults.") };
    return { picks: uniqueWallPicks(picks), error: null };
  } catch {
    return { picks: empty(), ...storageFailure("saved picks could not be read; using defaults.") };
  }
}

export function saveWallPicks(picks: WallPicks, storage: WallPickStorage | null): WallStorageResult {
  const clean = cleanWallPicks(picks);
  if (!clean) return storageFailure("panel data is invalid.");
  if (!storage) return storageFailure("browser storage is unavailable; loaded for this visit only.");
  try {
    const text = JSON.stringify({ version: 1, panels: clean });
    if (text.length > MAX_WALL_PICK_CHARS) return storageFailure("panel data is oversized.");
    storage.setItem(WALL_PICKS_KEY, text);
    return { ok: true, error: null };
  } catch {
    return storageFailure("this browser refused to save the panel pick; loaded for this visit only.");
  }
}

export function clearWallPicks(storage: WallPickStorage | null): WallStorageResult {
  if (!storage) return storageFailure("browser storage is unavailable.");
  try {
    storage.removeItem(WALL_PICKS_KEY);
    return { ok: true, error: null };
  } catch {
    return storageFailure("this browser refused to clear saved panel picks.");
  }
}

/** Saved slot snapshots outrank server/default selection and are never re-resolved on reload. */
export function restoreWallSlots(baseline: RumbleBaseline, picks: WallPicks, nowMs: number): WallSource[] {
  const saved = uniqueWallPicks(picks);
  const pastedSources = saved.filter((source): source is WallSource => Boolean(source?.pastedAt));
  const defaults = buildNewsWall(baseline, baseline.channels.length,
    pastedSources.length ? { pastedSources, nowMs } : undefined,
  ).map((item) => toSource(item, baseline));
  const used = new Set(saved.flatMap((source) => source?.channelId ? [source.channelId] : []));
  const candidates = defaults.filter((source) => !source.channelId || !used.has(source.channelId));
  const lastSaved = saved.reduce((last, source, index) => source ? index + 1 : last, 0);
  const count = Math.min(4, Math.max(lastSaved, Math.min(4, defaults.length), saved.filter(Boolean).length + candidates.length));
  return Array.from({ length: count }, (_, index) => {
    if (saved[index]) return saved[index]!;
    const next = candidates.shift();
    if (next) return next;
    return { key: `empty-${index}`, embedId: "", label: "Choose a channel", detail: "No live selection available." };
  });
}

export function duplicateWallChannelNotes(slots: readonly WallSource[]): string[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const source of slots) {
    if (!source.channelId) continue;
    const previous = counts.get(source.channelId);
    counts.set(source.channelId, { label: source.label, count: (previous?.count ?? 0) + 1 });
  }
  return [...counts.values()].filter(({ count }) => count > 1)
    .map(({ label, count }) => `${label} is in ${count === 2 ? "two" : count} panels`);
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

/** One entry per channel in the panel's channel picker. */
export interface ChannelPick {
  channelId: string;
  label: string;
  network: RumbleChannel["network"];
  state: RumbleItem["state"];
  viewers?: number | null;
  /** Page URL placed in the paste box when this channel is picked. */
  pageUrl: string;
  /** Stored embed id, used only if the link lookup fails (shown as "unverified"). */
  embedId: string;
  title: string;
  asOf: string;
}

function whenValue(value: string | null | undefined): number {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : -Infinity;
}

/**
 * The channel's last known video: a live item if there is one (most viewers, then newest start),
 * otherwise the newest by publishedAt/startedAt. Undated items never beat dated ones. Never by views.
 */
export function lastKnownItem(baseline: RumbleBaseline, channelId: string): RumbleItem | null {
  const items = baseline.items.filter((item) => item.channelId === channelId);
  if (items.length === 0) return null;
  const live = items.filter((item) => item.state === "live");
  if (live.length > 0) {
    return [...live].sort(
      (a, b) => (b.viewers ?? 0) - (a.viewers ?? 0) || whenValue(b.startedAt) - whenValue(a.startedAt),
    )[0];
  }
  return [...items].sort(
    (a, b) => Math.max(whenValue(b.publishedAt), whenValue(b.startedAt)) - Math.max(whenValue(a.publishedAt), whenValue(a.startedAt)),
  )[0];
}

export function pageUrlForItem(item: RumbleItem): string {
  return item.pageUrl && item.pageUrl.startsWith("https://rumble.com/") ? item.pageUrl : rumblePageUrlForVideoId(item.videoId);
}

const NETWORK_ORDER: Record<RumbleChannel["network"], number> = { ajn: 0, rav: 1, other: 2 };

/** Channels that have a known video, grouped AJN -> RAV -> other, live first, then by name. */
export function listChannelPicks(baseline: RumbleBaseline): ChannelPick[] {
  const picks: ChannelPick[] = [];
  for (const channel of baseline.channels) {
    const item = lastKnownItem(baseline, channel.id);
    if (!item) continue;
    picks.push({
      channelId: channel.id,
      label: channel.name,
      network: channel.network,
      state: item.state,
      viewers: item.viewers,
      pageUrl: pageUrlForItem(item),
      embedId: item.embedId,
      title: item.title,
      asOf: item.seenAt ?? baseline.generatedAt,
    });
  }
  return picks.sort(
    (a, b) =>
      NETWORK_ORDER[a.network] - NETWORK_ORDER[b.network] ||
      Number(b.state === "live") - Number(a.state === "live") ||
      a.label.localeCompare(b.label),
  );
}

/** Channels with no known video yet (listed disabled in the picker so the gap is visible). */
export function channelsWithoutVideo(baseline: RumbleBaseline): RumbleChannel[] {
  return baseline.channels.filter((channel) => !baseline.items.some((item) => item.channelId === channel.id));
}

/** Age of the import in whole hours (null if the date is invalid). */
export function snapshotAgeHours(baseline: RumbleBaseline, nowMs: number = Date.now()): number | null {
  const time = Date.parse(baseline.generatedAt);
  return Number.isFinite(time) ? Math.max(0, Math.floor((nowMs - time) / 3_600_000)) : null;
}

/** How many channel picks were last read from Rumble at least `hours` ago. */
export function staleChannelCount(picks: readonly ChannelPick[], nowMs: number = Date.now(), hours = 24): number {
  return picks.filter((pick) => {
    const time = Date.parse(pick.asOf);
    return !Number.isFinite(time) || nowMs - time >= hours * 3_600_000;
  }).length;
}
