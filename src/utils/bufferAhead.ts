/** Seconds of audio/video already downloaded ahead of the playhead. Real measurement from the element's buffered ranges; 0 when unknown. */
export function bufferAheadSeconds(media: { currentTime: number; buffered: TimeRanges }): number {
  const t = media.currentTime;
  try {
    for (let i = 0; i < media.buffered.length; i += 1) {
      const start = media.buffered.start(i);
      const end = media.buffered.end(i);
      if (t >= start - 0.25 && t <= end + 0.25) return Math.max(0, end - t);
    }
  } catch { /* the browser can clear the ranges during a source swap */ }
  return 0;
}

export type DockStatus = 'playing' | 'paused' | 'buffering' | 'failed';

/** The dock's one status word. `reconnectAttempt` is 0 unless the player is retrying right now (data-reconnect on the media element; the player removes it when it gives up or has recovered). */
export function isReconnecting(status: DockStatus, reconnectAttempt: number): boolean {
  return reconnectAttempt > 0 && status !== 'playing';
}

export function dockStatusLabel(status: DockStatus, isLive: boolean, aheadSeconds: number, reconnectAttempt: number): string {
  if (isReconnecting(status, reconnectAttempt)) return aheadSeconds >= 1 ? `Reconnecting · ${Math.floor(aheadSeconds)}s` : 'Reconnecting';
  if (isLive && status === 'playing') return 'LIVE';
  return status;
}
