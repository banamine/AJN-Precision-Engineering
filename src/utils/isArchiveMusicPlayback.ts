/** Archive music playlists use audio program rows whose channel IDs start with music- or item-music-. */
export function isArchiveMusicPlayback(mediaType?: string, channelId?: string): boolean {
  return mediaType === "audio" && /^(item-)?music-/.test(channelId ?? "");
}
