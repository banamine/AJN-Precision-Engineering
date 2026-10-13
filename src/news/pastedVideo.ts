import type { RumbleBaseline, RumbleItem } from "../rumble/types";
import { validateBaseline } from "../rumble/logic";
import type { ResolvedMedia } from "./contract";
import { handleOfUrl } from "./importer";
import { parseRumblePageUrl } from "./providers/rumble";
import { lastKnownItem } from "../rumble/wall";

function cleanThumbnail(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "hugh.cdn.rumble.cloud"
      && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Save one verified pasted video without making other channels look fresher. */
export function applyPastedVideo(
  baseline: RumbleBaseline,
  media: ResolvedMedia,
  pageUrl: string,
  now: Date,
): { baseline: RumbleBaseline; channelId: string | null; changed: boolean } {
  const handle = handleOfUrl(media.authorUrl);
  const channel = handle ? baseline.channels.find((entry) => handleOfUrl(entry.url) === handle) : undefined;
  if (!channel) return { baseline, channelId: null, changed: false };

  const page = parseRumblePageUrl(pageUrl);
  if (!page) throw new Error("The resolved link is not a Rumble video page.");
  if (lastKnownItem(baseline, channel.id)?.embedId === media.embedId) {
    return { baseline, channelId: channel.id, changed: false };
  }
  const seenAt = now.toISOString();
  const item: RumbleItem = {
    channelId: channel.id,
    videoId: page.id,
    embedId: media.embedId,
    pageUrl: page.pageUrl,
    title: media.title,
    thumbnailUrl: cleanThumbnail(media.thumbnailUrl),
    publishedAt: null,
    seenAt,
    durationSec: media.durationSec,
    kind: "vod",
    state: "vod",
    viewers: null,
  };
  const kept = baseline.items
    .filter((entry) => entry.channelId !== channel.id)
    .map((entry) => ({ ...entry, seenAt: entry.seenAt ?? baseline.generatedAt }));
  const next: RumbleBaseline = {
    version: baseline.version + 1,
    generatedAt: seenAt,
    channels: baseline.channels,
    items: [...kept, item],
  };
  const { valid, errors } = validateBaseline(next);
  if (!valid) throw new Error(`Pasted video produced an invalid list: ${errors.slice(0, 3).join("; ")}`);
  return { baseline: next, channelId: channel.id, changed: true };
}
