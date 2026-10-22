import type { NowPlayingMedia } from "../../types";
import { CaptionStrip } from "./CaptionStrip";
import { useCaptionTrack } from "./useCaptionTrack";

/** Text of what is being said for TV News channel programmes. Renders nothing for anything else (no requests either).
 *  `getVideo` finds the player's <video>; it must tolerate the element being swapped between clip windows. */
export function CaptionPanel({ nowPlaying, getVideo }: { nowPlaying: NowPlayingMedia; getVideo: () => HTMLVideoElement | null }) {
  const s = useCaptionTrack(nowPlaying.archivePath, getVideo);
  return <CaptionStrip state={s} />;
}
