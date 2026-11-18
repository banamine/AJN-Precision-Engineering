import type { DigestView } from "../utils/digestStore";

export interface FillerHeadline { id: string; title: string; url: string; source: string }

/** Stage filler shows only when audio is playing, the signal meter cannot read it, and no other full-stage mode is active. */
export function stageFillerOn(o: { isPlaying: boolean; isVideo: boolean; meterState: "active" | "idle" | "unavailable"; radioBriefingOn: boolean; archiveMusicOn: boolean }): boolean {
  return o.isPlaying && !o.isVideo && o.meterState === "unavailable" && !o.radioBriefingOn && !o.archiveMusicOn;
}

/** Up to `max` real headlines from the shared news digest; empty while loading or when it is unavailable (no placeholders). */
export function pickHeadlines(view: DigestView, max = 4): FillerHeadline[] {
  const items = view.data?.digest?.top ?? [];
  const out: FillerHeadline[] = [];
  for (const it of items) {
    if (!it?.title || !/^https?:\/\//i.test(it.url ?? "")) continue;
    out.push({ id: it.id, title: it.title, url: it.url, source: it.source });
    if (out.length >= max) break;
  }
  return out;
}
