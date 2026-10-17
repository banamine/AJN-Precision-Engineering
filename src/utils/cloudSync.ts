// Manual "Sync to cloud" for the recently-played list. Sends to a PLACEHOLDER endpoint that stores nothing yet.
// Pure + injectable fetch so it is testable; no timers, no storage, no automatic sync.
import type { RecentlyPlayedItem } from "../types";

export const SYNC_ENDPOINT = "/api/sync/recently-played";
export const SYNC_TIMEOUT_MS = 10_000;

export type SyncResult =
  | { ok: true; received: number; stored: boolean; placeholder: boolean; message: string }
  | { ok: false; reason: string };

/** Only the fields a cloud copy needs; nothing else leaves the device. */
export function toSyncPayload(items: readonly RecentlyPlayedItem[], now: number = Date.now()) {
  return {
    version: 1 as const,
    clientTime: new Date(now).toISOString(),
    items: items.map((i) => ({
      id: i.id, title: i.title, src: i.src, subtitle: i.subtitle, channelName: i.channelName, channelId: i.channelId,
      guideId: i.guideId, programId: i.programId, mediaType: i.mediaType, archivePath: i.archivePath,
      progressSeconds: i.progressSeconds, updatedAt: i.updatedAt,
    })),
  };
}

export async function syncRecentlyPlayed(items: readonly RecentlyPlayedItem[], fetchImpl: typeof fetch = fetch, endpoint: string = SYNC_ENDPOINT): Promise<SyncResult> {
  if (items.length === 0) return { ok: false, reason: "Nothing to sync: play something first." };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), SYNC_TIMEOUT_MS);
  try {
    const res = await fetchImpl(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(toSyncPayload(items)), signal: ctl.signal });
    const data = await res.json().catch(() => ({} as Record<string, unknown>));
    if (!res.ok) return { ok: false, reason: typeof data.error === "string" ? data.error : `Sync failed: HTTP ${res.status}` };
    return { ok: true, received: Number(data.received ?? 0), stored: data.stored === true, placeholder: data.placeholder === true, message: typeof data.message === "string" ? data.message : "Sync request accepted." };
  } catch (e) {
    return { ok: false, reason: ctl.signal.aborted ? "Sync timed out after 10 seconds." : `Network error: ${e instanceof Error ? e.message : String(e)}` };
  } finally {
    clearTimeout(timer);
  }
}
