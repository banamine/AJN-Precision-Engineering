import { readFileSync } from "node:fs";

const player = readFileSync("src/MinimalPlayer.tsx", "utf8");
const telemetry = readFileSync("src/telemetry.ts", "utf8");

const requiredPlayerMarkers = [
  'const isVideo = mediaType === "video";',
  'isVideo ? "video" : "audio"',
  "{isVideo ? (",
  'data-testid="audio-stage"',
  'data-testid="audio-host"',
  "if (isVideo) return;",
  "new Audio()",
  "AudioBridgeStatus",
];

for (const marker of requiredPlayerMarkers) {
  if (!player.includes(marker)) {
    throw new Error(`Missing player separation marker: ${marker}`);
  }
}

const videoBranch = player.indexOf("{isVideo ? (");
const videoElement = player.indexOf("<video", videoBranch);
const audioBranch = player.indexOf('data-testid="audio-stage"', videoBranch);
if (videoBranch < 0 || videoElement < videoBranch || audioBranch < videoElement) {
  throw new Error("Video sources must use the visible video element and audio sources the separate audio stage");
}

if (telemetry.includes("Math.random")) {
  throw new Error("Telemetry event IDs must not use Math.random()");
}

if (!telemetry.includes("const cryptoApi = globalThis.crypto;") || !telemetry.includes("cryptoApi.randomUUID()")) {
  throw new Error("Telemetry must prefer crypto.randomUUID()");
}

console.log("PASS: audio/video player separation and deterministic telemetry fallback checks");
