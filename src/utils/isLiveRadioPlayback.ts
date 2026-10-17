import type { MediaType, NowPlayingMedia } from "../types";

/**
 * The Live Radio contract requires IDs to start with "radio:" and uses the
 * canonical program ID "<station id>:live:d0". Do not over-validate the station
 * suffix; the server contract permits IDs beyond the curated examples.
 */
export function isLiveRadioPlayback(
  mediaType: MediaType | undefined,
  nowPlaying: Pick<NowPlayingMedia, "channelId" | "programId"> | null | undefined,
): boolean {
  const channelId = nowPlaying?.channelId;
  if (mediaType !== "audio" || !channelId?.startsWith("radio:") || channelId.length <= "radio:".length) return false;
  return nowPlaying?.programId === `${channelId}:live:d0`;
}
