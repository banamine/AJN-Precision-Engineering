import { useCaptionTrackAdapter, type CaptionApiBody, type CaptionPlan, type CaptionState } from "./useCaptionTrack";

export const RADIO_CAPTION_DISPLAY_LABEL = "RADIO CAPTIONS VIA INTERNET ARCHIVE · MACHINE-GENERATED (ASR, MAY CONTAIN ERRORS)";
const RADIO_IDENTIFIER = /^The_Alex_Jones_Radio_Show_\d{8}_\d{6}$/;

function retryAfterSeconds(body: CaptionApiBody | null, header: string | null): number {
  const raw = header ?? body?.retryAfter;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(120, Math.ceil(seconds));
  if (typeof raw === "string") {
    const date = Date.parse(raw);
    if (Number.isFinite(date)) return Math.max(1, Math.min(120, Math.ceil((date - Date.now()) / 1000)));
  }
  return 30;
}

/** Radio ASR is an adapter over the common playhead/slice/budget lifecycle, not a second caption engine. */
export function useRadioCaptionTrack(identifier: string | undefined | null, getAudio: () => HTMLAudioElement | null): CaptionState {
  const id = typeof identifier === "string" && RADIO_IDENTIFIER.test(identifier) ? identifier : null;
  return useCaptionTrackAdapter({
    id,
    memoKey: id ? `radio-asr:${id}` : "",
    planUrl: id ? `/api/audio-asr/${encodeURIComponent(id)}/plan` : "",
    sliceUrl: (start) => `/api/audio-asr/${encodeURIComponent(id ?? "")}/slice?t=${start}/60`,
    parsePlan: (status, body): CaptionPlan | null => {
      if (status === 404) return { source: "none" };
      if (status === 200 && body?.source === "asr") {
        return { source: "asr", kind: "asr", label: RADIO_CAPTION_DISPLAY_LABEL };
      }
      return null;
    },
    getMedia: getAudio,
    kind: "asr",
    label: RADIO_CAPTION_DISPLAY_LABEL,
    errorReason: (status, body) => String(body?.message ?? body?.error ?? `HTTP ${status}`),
    retryAfterSeconds,
    rateLimitMode: "single-attempt",
  });
}
