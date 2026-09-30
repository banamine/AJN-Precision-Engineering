import type { RumbleBaseline, RumbleItem } from "./types";

export interface NewsWallRankOptions {
  max?: number;
}

const DEFAULT_MAX = 4;

function startedAtValue(value: string | null | undefined): number {
  return value ? Date.parse(value) : Number.NEGATIVE_INFINITY;
}

export function rankNewsWall(
  baseline: RumbleBaseline,
  opts: NewsWallRankOptions = {},
): RumbleItem[] {
  const max = opts.max ?? DEFAULT_MAX;
  if (max <= 0) return [];

  const channelNetworks = new Map(baseline.channels.map((channel) => [channel.id, channel.network]));
  const candidates = baseline.items
    .filter((item) => item.state === "live")
    .sort((a, b) => {
      const viewerDelta = (b.viewers ?? 0) - (a.viewers ?? 0);
      if (viewerDelta !== 0) return viewerDelta;
      return startedAtValue(b.startedAt) - startedAtValue(a.startedAt);
    });

  const selected: RumbleItem[] = [];
  const usedChannels = new Set<string>();
  const networkCounts = new Map<"ajn" | "rav", number>();

  for (const item of candidates) {
    if (selected.length >= max) break;
    if (usedChannels.has(item.channelId)) continue;

    const network = channelNetworks.get(item.channelId);
    if ((network === "ajn" || network === "rav") && (networkCounts.get(network) ?? 0) >= 2) {
      continue;
    }

    selected.push(item);
    usedChannels.add(item.channelId);
    if (network === "ajn" || network === "rav") {
      networkCounts.set(network, (networkCounts.get(network) ?? 0) + 1);
    }
  }

  return selected;
}
