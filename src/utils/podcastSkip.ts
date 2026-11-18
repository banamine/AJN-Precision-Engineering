/* Podcast skip buttons (+15s / +30s / +1m, and -15s in the dock): one rule for "is this an on-demand podcast episode" and one way to skip,
 * shared by the full player (PlayerChrome) and the bottom dock (MiniPlayerDock) so they can never disagree. Pure, no React. */

/** Full player buttons, in order. */
export const SKIP_FORWARD_SECONDS = [15, 30, 60] as const;
/** The dock is narrow: one rewind (to undo an overshoot) and one forward. */
export const DOCK_SKIP_BACK_SECONDS = 15;
export const DOCK_SKIP_FORWARD_SECONDS = 30;
/** Taps closer together than this add onto the last target instead of re-reading a (possibly stale) currentTime. */
export const PENDING_SEEK_MS = 1000;

export interface PodcastItemLike { channelId?: string | null; isLive?: boolean; programId?: string | null }

/** On-demand podcast episode by id: the episode lists (`podcast-<show>`) and the feed channels (`pod-<source>`).
 *  NOT the 24/7 "Fresh first" stack (`pod-network-*`): it is synced to the wall clock, so seeking it would break the guide. */
export function isPodcastItem(item?: PodcastItemLike | null): boolean {
  if (!item || item.isLive) return false;
  if (String(item.programId ?? '').includes(':live:')) return false;
  const id = String(item.channelId ?? '');
  if (id.startsWith('podcast-')) return true;
  return id.startsWith('pod-') && !id.startsWith('pod-network');
}

/** The single gate for showing the buttons: a podcast episode whose length is known (live / unloaded streams report NaN or Infinity). */
export function isPodcastOnDemand(item: PodcastItemLike | null | undefined, duration: number): boolean {
  return isPodcastItem(item) && Number.isFinite(duration) && duration > 1;
}

/** Clamp a seek target into the episode, stopping 0.5 s before the end so a skip never rolls into the next item. */
export function clampSkipTarget(target: number, duration: number): number | null {
  if (!Number.isFinite(target) || !Number.isFinite(duration) || duration <= 1) return null;
  return Math.max(0, Math.min(duration - 0.5, target));
}

export function skipLabel(seconds: number): string {
  const a = Math.abs(seconds);
  const sign = seconds < 0 ? '-' : '+';
  return a % 60 === 0 ? `${sign}${a / 60}m` : `${sign}${a}s`;
}
export function skipAriaLabel(seconds: number): string {
  const a = Math.abs(seconds);
  const span = a % 60 === 0 ? `${a / 60} minute${a === 60 ? '' : 's'}` : `${a} seconds`;
  return `${seconds < 0 ? 'Skip back' : 'Skip forward'} ${span}`;
}

const pending = new WeakMap<HTMLMediaElement, { target: number; at: number }>();

/** Move the playhead by `deltaSeconds`. Rapid taps stack (+30, +30 = +60) even while the first range slice is still loading and
 *  currentTime has not caught up. Returns the target it set, or null when the media has no usable length. */
export function skipMedia(media: HTMLMediaElement, deltaSeconds: number, now: number = Date.now()): number | null {
  const prev = pending.get(media);
  const base = prev && now - prev.at < PENDING_SEEK_MS ? prev.target : media.currentTime;
  const target = clampSkipTarget(base + deltaSeconds, media.duration);
  if (target === null) return null;
  pending.set(media, { target, at: now });
  try { media.currentTime = target; } catch { pending.delete(media); return null; }
  media.addEventListener('seeked', () => {
    const cur = pending.get(media);
    // Only forget the target once the playhead has really arrived near it (an earlier, superseded seek can fire 'seeked' first).
    if (cur && Math.abs(media.currentTime - cur.target) < 1.5) pending.delete(media);
  }, { once: true });
  return target;
}
