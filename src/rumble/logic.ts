import type {
  RumbleBaseline,
  RumbleChannel,
  RumbleItem,
  RumbleItemKind,
  RumbleItemState,
} from "./types";

export const RUMBLE_THUMBNAIL_HOST = "hugh.cdn.rumble.cloud";
const CONTINUOUS_LIVE_MS = 24 * 60 * 60 * 1000;

const timeValue = (value: string | null): number =>
  value ? Date.parse(value) : Number.NEGATIVE_INFINITY;

function stateRank(state: RumbleItemState): number {
  if (state === "live") return 0;
  if (state === "ended") return 1;
  return 2;
}

function kindRank(kind: RumbleItemKind): number {
  if (kind === "live") return 0;
  if (kind === "continuous_live") return 1;
  return 2;
}

export function classifyKind(
  item: Pick<RumbleItem, "state" | "publishedAt" | "kind">,
  nowMs = Date.now(),
): RumbleItemKind {
  if (item.state !== "live") return item.kind === "short" ? "short" : "vod";

  const startedAt = timeValue(item.publishedAt);
  if (Number.isFinite(startedAt) && nowMs - startedAt > CONTINUOUS_LIVE_MS) {
    return "continuous_live";
  }
  return "live";
}

export function sortItems(items: readonly RumbleItem[]): RumbleItem[] {
  return [...items].sort((a, b) => {
    const stateDelta = stateRank(a.state) - stateRank(b.state);
    if (stateDelta !== 0) return stateDelta;

    if (a.state === "live" && b.state === "live") {
      const kindDelta = kindRank(a.kind) - kindRank(b.kind);
      if (kindDelta !== 0) return kindDelta;
    }

    return timeValue(b.publishedAt) - timeValue(a.publishedAt);
  });
}

function channelMap(channels: readonly RumbleChannel[]): Map<string, RumbleChannel> {
  return new Map(channels.map((channel) => [channel.id, channel]));
}

function itemKey(item: RumbleItem): string {
  return item.videoId;
}

function isLive(item: RumbleItem): boolean {
  return item.state === "live" && (item.kind === "live" || item.kind === "continuous_live");
}

function sameTitle(a: RumbleItem, b: RumbleItem): boolean {
  return a.channelId === b.channelId && a.title === b.title;
}

export function reconcile(
  previous: RumbleBaseline,
  next: RumbleBaseline,
): RumbleBaseline {
  const nextChannels = channelMap(next.channels);
  const nextItems = [...next.items];

  for (const oldItem of previous.items) {
    if (!isLive(oldItem)) continue;

    const stillLive = next.items.some(
      (candidate) => candidate.channelId === oldItem.channelId && itemKey(candidate) === itemKey(oldItem) && isLive(candidate),
    );
    const titleReturnedAsVod = next.items.some(
      (candidate) =>
        sameTitle(candidate, oldItem) &&
        candidate.state === "vod" &&
        candidate.videoId !== oldItem.videoId,
    );

    if (!stillLive || titleReturnedAsVod) {
      const ended: RumbleItem = {
        ...oldItem,
        state: "ended",
        kind: oldItem.kind,
      };
      nextItems.push(ended);
    }
  }

  return {
    version: next.version,
    generatedAt: next.generatedAt,
    channels: next.channels.filter((channel) => nextChannels.has(channel.id)),
    items: sortItems(dedupeItems(nextItems)),
  };
}

function dedupeItems(items: readonly RumbleItem[]): RumbleItem[] {
  const seen = new Set<string>();
  const result: RumbleItem[] = [];
  for (const item of items) {
    const key = `${item.channelId}:${item.videoId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function validateUrl(value: string, field: string, errors: string[]): void {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") errors.push(`${field} must use https`);
  } catch {
    errors.push(`${field} must be a valid URL`);
  }
}

export function validateBaseline(baseline: RumbleBaseline): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const channels = channelMap(baseline.channels);
  const seenVideoIds = new Set<string>();

  if (!Number.isInteger(baseline.version) || baseline.version < 1) {
    errors.push("version must be a positive integer");
  }
  try {
    if (!Number.isFinite(Date.parse(baseline.generatedAt))) errors.push("generatedAt must be an ISO date");
  } catch {
    errors.push("generatedAt must be an ISO date");
  }

  for (const channel of baseline.channels) {
    validateUrl(channel.url, `channel ${channel.id} url`, errors);
  }

  for (const item of baseline.items) {
    const channel = channels.get(item.channelId);
    if (!channel) {
      errors.push(`item ${item.videoId} references unknown channel ${item.channelId}`);
    }

    const scopedVideoId = `${item.channelId}:${item.videoId}`;
    if (seenVideoIds.has(scopedVideoId)) {
      errors.push(`duplicate videoId within channel: ${item.channelId}/${item.videoId}`);
    }
    seenVideoIds.add(scopedVideoId);

    if (item.thumbnailUrl !== null) {
      try {
        const thumbnail = new URL(item.thumbnailUrl);
        if (thumbnail.protocol !== "https:" || thumbnail.hostname !== RUMBLE_THUMBNAIL_HOST) {
          errors.push(`item ${item.videoId} thumbnailUrl must use https://${RUMBLE_THUMBNAIL_HOST}`);
        }
      } catch {
        errors.push(`item ${item.videoId} thumbnailUrl must be a valid URL`);
      }
    }

    if (item.embedId === "") errors.push(`item ${item.videoId} embedId is required`);
    if (item.videoId === "") errors.push("videoId is required");
    if (item.state === "live" && !["live", "continuous_live"].includes(item.kind)) {
      errors.push(`live item ${item.videoId} must have live/continuous_live kind`);
    }
  }

  return { valid: errors.length === 0, errors };
}
