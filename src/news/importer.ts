import type { ResolvedMedia } from "./contract";
import { rumblePageUrlForVideoId } from "./providers/rumble";
import { validateBaseline } from "../rumble/logic";
import { lastKnownItem } from "../rumble/wall";
import type { RumbleBaseline, RumbleItem } from "../rumble/types";

/**
 * Paste-the-export importer. Pure: parse + diff + apply. The only network step (resolving a
 * video id to its real embed id) is done by the caller through the news resolver, because
 * page ids are NOT embed ids (v7g7f18 -> v7e123q).
 */
export const MAX_IMPORT_CHARS = 1_000_000;
export const MAX_IMPORT_ITEMS = 500;
const THUMB_HOST = "hugh.cdn.rumble.cloud";
const VIDEO_ID = /^v[a-z0-9]{3,12}$/;

export type RowStatus = "changed" | "new" | "unchanged" | "unresolved";

export interface ImportRow {
  channelId: string;
  channelName: string;
  status: RowStatus;
  current: { videoId: string; title: string; asOf: string } | null;
  /** Newest item in the export for this channel (live first, else newest dated). */
  candidate: RumbleItem;
  pageUrl: string;
  /** Filled after the lookup; required before a row can be applied. */
  embedId: string | null;
  note?: string;
}

export interface ImportPlan {
  ok: boolean;
  errors: string[];
  rows: ImportRow[];
  /** Channel handles in the export that are not in the baseline (never auto-added). */
  unknownHandles: string[];
  /** Baseline channels the export did not mention (left untouched). */
  untouchedChannels: number;
  invalidItems: number;
  invalidSamples: string[];
  generatedAt: string;
}

export function handleOfUrl(url: string | null | undefined): string | null {
  const match = /^https:\/\/(?:www\.)?rumble\.com\/(?:c|user)\/([^/?#]+)/i.exec(String(url ?? ""));
  return match ? match[1].toLowerCase() : null;
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function intOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

function cleanThumb(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === THUMB_HOST ? url.toString() : null;
  } catch {
    return null;
  }
}

interface RawItem {
  channelId?: unknown;
  videoId?: unknown;
  title?: unknown;
  thumbnailUrl?: unknown;
  publishedAt?: unknown;
  startedAt?: unknown;
  durationSec?: unknown;
  state?: unknown;
  kind?: unknown;
  viewers?: unknown;
}

/** Turn pasted export text into a diff plan. Never throws, never touches the network. */
export function parseExport(text: string, baseline: RumbleBaseline, now: Date = new Date()): ImportPlan {
  const empty = (errors: string[]): ImportPlan => ({
    ok: false, errors, rows: [], unknownHandles: [], untouchedChannels: baseline.channels.length,
    invalidItems: 0, invalidSamples: [], generatedAt: now.toISOString(),
  });

  const raw = String(text ?? "").trim();
  if (!raw) return empty(["Paste the JSON that tools/export-rumble.js copied."]);
  if (raw.length > MAX_IMPORT_CHARS) return empty(["That is too large (over 1 MB). Export one channel page at a time."]);

  let data: { items?: unknown; channels?: unknown; generatedAt?: unknown };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    return empty(["That is not valid JSON. Paste the whole export, from { to }."]);
  }
  if (!data || typeof data !== "object" || !Array.isArray(data.items)) {
    return empty(['No "items" list found. Paste the output of tools/export-rumble.js.']);
  }
  if (data.items.length === 0) return empty(["The export has no videos. Run it on a page that lists videos."]);
  if (data.items.length > MAX_IMPORT_ITEMS) return empty([`Too many items (${data.items.length}). Limit is ${MAX_IMPORT_ITEMS}.`]);

  // export channel id -> handle
  const exportHandles = new Map<string, string>();
  if (Array.isArray(data.channels)) {
    for (const channel of data.channels as Array<{ id?: unknown; url?: unknown }>) {
      const handle = handleOfUrl(typeof channel?.url === "string" ? channel.url : null);
      if (typeof channel?.id === "string" && handle) exportHandles.set(channel.id, handle);
    }
  }
  const baselineByHandle = new Map<string, RumbleBaseline["channels"][number]>();
  for (const channel of baseline.channels) {
    const handle = handleOfUrl(channel.url);
    if (handle) baselineByHandle.set(handle, channel);
  }

  const stamp = isoOrNull(data.generatedAt);
  const generatedAt = stamp && Date.parse(stamp) <= now.getTime() + 5 * 60_000 ? stamp : now.toISOString();

  const grouped = new Map<string, RumbleItem[]>();
  const unknown = new Set<string>();
  const samples: string[] = [];
  let invalid = 0;
  const reject = (why: string) => {
    invalid += 1;
    if (samples.length < 5) samples.push(why);
  };

  for (const entry of data.items as RawItem[]) {
    const videoId = typeof entry?.videoId === "string" ? entry.videoId.trim().toLowerCase() : "";
    if (!VIDEO_ID.test(videoId)) { reject(`bad video id: ${String(entry?.videoId).slice(0, 30)}`); continue; }
    const title = typeof entry.title === "string" ? entry.title.trim().slice(0, 300) : "";
    if (!title) { reject(`${videoId}: no title`); continue; }
    const state = entry.state === "live" ? "live" : entry.state === "vod" ? "vod" : null;
    if (!state) { reject(`${videoId}: unknown state`); continue; }

    const channelKey = typeof entry.channelId === "string" ? entry.channelId : "";
    const handle = exportHandles.get(channelKey) ?? (channelKey.startsWith("rumble-") ? channelKey.slice(7).toLowerCase() : "");
    const channel = handle ? baselineByHandle.get(handle) : undefined;
    if (!channel) { unknown.add(handle || channelKey || "(none)"); continue; }

    const startedAt = isoOrNull(entry.startedAt);
    const publishedAt = isoOrNull(entry.publishedAt);
    const kind = state === "live"
      ? (startedAt && now.getTime() - Date.parse(startedAt) > 86_400_000 ? "continuous_live" : "live")
      : "vod";
    const item: RumbleItem = {
      channelId: channel.id,
      videoId,
      embedId: videoId, // placeholder until the lookup returns the real embed id
      title,
      thumbnailUrl: cleanThumb(entry.thumbnailUrl),
      publishedAt: state === "live" ? null : publishedAt,
      startedAt: state === "live" ? startedAt : null,
      durationSec: state === "live" ? null : intOrNull(entry.durationSec),
      kind,
      state,
      viewers: state === "live" ? intOrNull(entry.viewers) : null,
      seenAt: generatedAt,
    };
    const list = grouped.get(channel.id) ?? [];
    if (!list.some((existing) => existing.videoId === videoId)) list.push(item);
    grouped.set(channel.id, list);
  }

  const rows: ImportRow[] = [];
  for (const channel of baseline.channels) {
    const incoming = grouped.get(channel.id);
    if (!incoming || incoming.length === 0) continue;
    const candidate = lastKnownItem({ ...baseline, items: incoming }, channel.id);
    if (!candidate) continue;
    const current = lastKnownItem(baseline, channel.id);
    rows.push({
      channelId: channel.id,
      channelName: channel.name,
      status: !current ? "new" : current.videoId === candidate.videoId ? "unchanged" : "changed",
      current: current ? { videoId: current.videoId, title: current.title, asOf: current.seenAt ?? baseline.generatedAt } : null,
      candidate,
      pageUrl: rumblePageUrlForVideoId(candidate.videoId),
      embedId: current && current.videoId === candidate.videoId ? current.embedId : null,
    });
  }

  const errors: string[] = [];
  if (rows.length === 0) errors.push("None of the videos belong to a channel in the News Wall list. Nothing to apply.");
  return {
    ok: rows.length > 0,
    errors,
    rows,
    unknownHandles: [...unknown].sort(),
    untouchedChannels: baseline.channels.length - rows.length,
    invalidItems: invalid,
    invalidSamples: samples,
    generatedAt,
  };
}

/** Record the lookup result on a row (or mark it unresolved, never applied). */
export function withLookup(row: ImportRow, result: { media: ResolvedMedia } | { reason: string }): ImportRow {
  if ("media" in result) return { ...row, embedId: result.media.embedId, note: undefined };
  return { ...row, status: "unresolved", embedId: null, note: result.reason };
}

export function appliableRows(rows: readonly ImportRow[]): ImportRow[] {
  return rows.filter((row) => (row.status === "changed" || row.status === "new") && row.embedId !== null);
}

/**
 * Build the next baseline. Only applied channels change; every other item keeps its own
 * "as of" (seenAt falls back to the old baseline time) so no channel looks fresher than it is.
 */
export function applyPlan(baseline: RumbleBaseline, plan: ImportPlan): RumbleBaseline {
  const rows = appliableRows(plan.rows);
  const replaced = new Set(rows.map((row) => row.channelId));
  const kept = baseline.items
    .filter((item) => !replaced.has(item.channelId))
    .map((item) => ({ ...item, seenAt: item.seenAt ?? baseline.generatedAt }));
  const added = rows.map((row): RumbleItem => ({ ...row.candidate, embedId: row.embedId as string, pageUrl: row.pageUrl }));
  const next: RumbleBaseline = {
    version: baseline.version + 1,
    generatedAt: plan.generatedAt,
    channels: baseline.channels,
    items: [...kept, ...added],
  };
  const { valid, errors } = validateBaseline(next);
  if (!valid) throw new Error(`Import produced an invalid list: ${errors.slice(0, 3).join("; ")}`);
  return next;
}
