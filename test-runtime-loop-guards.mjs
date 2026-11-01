import { readFileSync } from "node:fs";

const app = readFileSync("src/App.tsx", "utf8");
const bridge = readFileSync("src/components/AudioBridgeStatus.tsx", "utf8");
const player = readFileSync("src/MinimalPlayer.tsx", "utf8");
const playerView = readFileSync("src/components/PlayerView.tsx", "utf8");

if (app.includes("setNowPlaying(nextRecentlyPlayed);\n      return [nextRecentlyPlayed")) {
  throw new Error("App still nests setNowPlaying inside the setRecentlyPlayed updater");
}
if (!app.includes("const recentlyPlayedRef = useRef(recentlyPlayed);") || !app.includes("recentlyPlayedRef.current = recentlyPlayed;")) {
  throw new Error("Recently Played state must be mirrored to a ref for stable playback callbacks");
}
if (!app.includes("recentlyPlayedRef.current.find((item) => item.id === id)") || !app.includes("  }, []);\n\n  const handleAdvanceProgram")) {
  throw new Error("handlePlayProgram must read the ref and remain stable across Recently Played updates");
}
if (!bridge.includes("signalActiveRef")) {
  throw new Error("AudioBridgeStatus lacks render-storm guard");
}
if (!bridge.includes("if (signalActiveRef.current !== nextSignalActive)")) {
  throw new Error("AudioBridgeStatus must only update signal state when the value changes");
}
if (!player.includes('isVideo ? "video" : "audio"') || !player.includes("if (isVideo) return;")) {
  throw new Error("Audio element setup must not run for video playback");
}
if (!player.includes("fnRef.current = { eventMeta, readResumePosition, saveResumePosition, clearResumePosition, reportPlaying, onPauseEvent, onProgramEnded, onErrorEvent };")) {
  throw new Error("Media event listeners must read current callbacks through the stable callback ref");
}
if (player.includes("Math.random")) {
  throw new Error("Player source contains forbidden fake randomness");
}
console.log("PASS: AJN runtime loop guards, stable player callbacks, and audio/video separation");
