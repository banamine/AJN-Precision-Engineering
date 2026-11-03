import { CaptionStrip, type CaptionStripVariant } from "./CaptionStrip";
import { useCaptionTrack, type CaptionState } from "./useCaptionTrack";
import type { NowPlayingMedia } from "../../types";

type CaptionPanelProps =
  | { state: CaptionState; variant?: CaptionStripVariant }
  | { nowPlaying: NowPlayingMedia; getVideo: () => HTMLVideoElement | null; variant?: CaptionStripVariant };

/** Text of what is being said for TV News channel programmes. PlayerView supplies shared state;
 *  the legacy props remain for existing isolated test fixtures and callers. */
export function CaptionPanel(props: CaptionPanelProps) {
  if ("state" in props) return <CaptionStrip state={props.state} variant={props.variant} />;
  return <LegacyCaptionPanel {...props} />;
}

function LegacyCaptionPanel({ nowPlaying, getVideo, variant = "inline" }: { nowPlaying: NowPlayingMedia; getVideo: () => HTMLVideoElement | null; variant?: CaptionStripVariant }) {
  const state = useCaptionTrack(nowPlaying.archivePath, getVideo);
  return <CaptionStrip state={state} variant={variant} />;
}
