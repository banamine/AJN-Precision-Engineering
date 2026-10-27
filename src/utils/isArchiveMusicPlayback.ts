/** Archive music playlists use audio program rows whose channel IDs start with item-music-. */
export function isArchiveMusicPlayback(mediaType?: string, channelId?: string): boolean {
  return mediaType === "audio" && Boolean(channelId?.startsWith("item-music-"));
}
