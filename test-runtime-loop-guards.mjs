import { readFileSync } from "node:fs";

const app = readFileSync("src/App.tsx", "utf8");
const bridge = readFileSync("src/components/AudioBridgeStatus.tsx", "utf8");
const player = readFileSync("src/MinimalPlayer.tsx", "utf8");
const playerView = readFileSync("src/components/PlayerView.tsx", "utf8");

if (app.includes("setNowPlaying(nextRecentlyPlayed);\n      return [nextRecentlyPlayed")) {
  throw new Error("App still nests setNowPlaying inside the setRecentlyPlayed updater");
}
if (!app.includes("const existing = recentlyPlayedRef.current.find((item) => item.id === id);")) {
  throw new Error("Recently Played lookup must use a ref so handlePlayProgram remains stable");
}
if (!app.includes("  }, []);\n\n  const handleEpgSelect")) {
  throw new Error("handlePlayProgram must not recreate on every Recently Played update");
}
if (!bridge.includes("signalActiveRef")) {
  throw new Error("AudioBridgeStatus lacks render-storm guard");
}
if (bridge.includes("setSignalActive(peak > 8 || average > 3)")) {
  throw new Error("AudioBridgeStatus still sets React state on every animation frame");
}
if (!player.includes('isAudio ? "audio" : "skip"')) {
  throw new Error("Video path must not attach the AudioBridge");
}
if (player.includes("readResumePosition = useCallback(() =>") && player.includes("[onProgressEvent, resumeKey]")) {
  throw new Error("readResumePosition must not depend on the unstable progress callback");
}
if (playerView.includes('onPlayEvent={() =>') || playerView.includes('onPauseEvent={() =>') || playerView.includes('onErrorEvent={(err) =>')) {
  throw new Error("PlayerView still passes unstable inline playback callbacks");
}
if (!playerView.includes("const handleProgressEvent = useCallback")) {
  throw new Error("PlayerView progress callback must be memoized");
}
if (player.includes("Math.random")) {
  throw new Error("Player source contains forbidden fake randomness");
}
console.log("PASS: AJN runtime loop guards, stable player callbacks, and audio/video separation");
