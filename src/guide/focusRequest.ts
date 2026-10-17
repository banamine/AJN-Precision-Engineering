// "Open the guide AND land on this channel" (Home tiles, links). A tile asks once; the guide that owns the channel
// consumes the request when its schedule is loaded. Held (not fire-and-forget) because the guide often has not loaded yet
// when the request is made, and it expires so a request for a channel that never appears cannot linger.
export const FOCUS_EVENT = 'ajn:focus-channel';
export const FOCUS_TTL_MS = 15_000;

export interface ChannelFocusRequest { guideId: string; channelId: string; at: number }

let pending: ChannelFocusRequest | null = null;

export function requestChannelFocus(guideId: string, channelId: string, now = Date.now()): void {
  pending = { guideId, channelId, at: now };
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: { guideId, channelId } }));
}

/** The live request for this guide, or null (none, expired, or meant for another guide). Does not consume it. */
export function peekChannelFocus(guideId: string, now = Date.now()): ChannelFocusRequest | null {
  if (!pending) return null;
  if (now - pending.at > FOCUS_TTL_MS) { pending = null; return null; }
  return pending.guideId === guideId ? pending : null;
}

export function takeChannelFocus(guideId: string, now = Date.now()): ChannelFocusRequest | null {
  const r = peekChannelFocus(guideId, now);
  if (r) pending = null;
  return r;
}

export function clearChannelFocusForTests(): void { pending = null; }
