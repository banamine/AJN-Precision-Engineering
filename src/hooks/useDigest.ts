// Shared /api/digest state for the Radio page and persistent radio player.
import { useSyncExternalStore } from "react";
import { digestStore } from "../utils/digestStore";

export { DIGEST_POLL_MS } from "../utils/digestStore";
export type { DigestResponse, DigestView } from "../utils/digestStore";

export function useDigest() {
  return useSyncExternalStore(digestStore.subscribe, digestStore.getSnapshot, digestStore.getSnapshot);
}
