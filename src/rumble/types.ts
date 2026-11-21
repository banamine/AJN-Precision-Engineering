import type { ResolveFailure } from "../news/contract";

export type RumbleNetwork = "ajn" | "rav" | "other";

export interface RumbleChannel {
  id: string;
  network: RumbleNetwork;
  name: string;
  url: string;
}

export type RumbleItemKind = "live" | "continuous_live" | "vod" | "short";
export type RumbleItemState = "live" | "ended" | "vod";

export interface RumbleItem {
  channelId: string;
  videoId: string;
  embedId: string;
  /** Optional full video page URL from the export. If absent, one is built from videoId (any slug resolves). */
  pageUrl?: string | null;
  title: string;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  startedAt?: string | null;
  /** When this item was last read from Rumble (export time). Falls back to baseline.generatedAt. */
  seenAt?: string | null;
  durationSec: number | null;
  kind: RumbleItemKind;
  liveStreamId?: string;
  state: RumbleItemState;
  viewers?: number | null;
}

export interface RumbleBaseline {
  version: number;
  generatedAt: string;
  channels: RumbleChannel[];
  items: RumbleItem[];
}

/** Read-only slot check (GET /api/rumble/slots/status). One entry per BAKED baseline item. */
export type SlotCheckStatus = "ok" | "failed" | "unchecked" | "unchecked-embed-only";
export type SlotLiveHint = "live" | "ended-or-vod";

export interface SlotStatus {
  channelId: string;
  videoId: string;
  status: SlotCheckStatus;
  /** Set when status is "failed" (the resolver's typed reason) or "unchecked" because the pass stopped early. */
  reason?: ResolveFailure;
  resolvedAt: string | null;
  /** null unless status is "ok"; never defaulted to false. */
  titleChanged: boolean | null;
  /** Does the resolver's embed id equal the baseline's embedId (the id the wall actually plays)? null unless status is "ok". */
  embedIdMatches: boolean | null;
  /** HINT only (durationSec 0 on a live item = still live). null unless status is "ok" and the item is live. */
  liveHint: SlotLiveHint | null;
}

export interface SlotStatusReport {
  ok: true;
  checkedAt: string;
  baselineVersion: number;
  baselineGeneratedAt: string;
  counts: { ok: number; failed: number; unchecked: number; uncheckedEmbedOnly: number };
  /** The failure that made the pass stop early ("rate-limited" or "timeout"), else null. */
  stoppedEarly: ResolveFailure | null;
  slots: SlotStatus[];
}
