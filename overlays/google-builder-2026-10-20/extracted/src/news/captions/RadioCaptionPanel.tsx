import { CaptionStrip } from "./CaptionStrip";
import { useRadioCaptionTrack } from "./useRadioCaptionTrack";

export function RadioCaptionPanel({ identifier, getAudio }: { identifier?: string | null; getAudio: () => HTMLAudioElement | null }) {
  const state = useRadioCaptionTrack(identifier, getAudio);
  return <CaptionStrip state={state} compact />;
}
