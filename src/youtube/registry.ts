import rawRegistry from "../data/youtubeChannels.json";
import { validateYoutubeRegistry } from "./validate";
import type { YoutubeChannel, YoutubeChannelRegistry } from "./types";

export { pickRandomChannels } from "./pick";

if (!validateYoutubeRegistry(rawRegistry)) {
  throw new Error("The supplied YouTube channel registry failed validation.");
}

export const YOUTUBE_REGISTRY: YoutubeChannelRegistry = rawRegistry;
export const YOUTUBE_CHANNELS: readonly YoutubeChannel[] = YOUTUBE_REGISTRY.channels;
export const YOUTUBE_DEFAULT_SLOTS: readonly string[] = YOUTUBE_REGISTRY.defaultSlots;

export function findYoutubeChannel(id: string): YoutubeChannel | undefined {
  return YOUTUBE_CHANNELS.find((channel) => channel.id === id);
}
