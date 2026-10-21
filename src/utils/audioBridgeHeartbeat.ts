export interface MediaPlaybackStateLike {
  readyState: number;
  networkState: number;
  paused: boolean;
  error: { code: number } | null;
}

export function audioPlaybackHeartbeatState(media: MediaPlaybackStateLike) {
  const playbackResult = media.error
    ? 'media-error'
    : !media.paused && media.readyState >= 2
      ? 'playing'
      : media.readyState === 0
        ? 'not-ready'
        : 'waiting';
  return {
    playbackResult,
    mediaReadyState: media.readyState,
    mediaNetworkState: media.networkState,
    mediaPaused: media.paused,
    mediaErrorCode: media.error?.code ?? null,
  };
}
