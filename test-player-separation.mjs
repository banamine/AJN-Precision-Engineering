import { readFileSync } from "node:fs";

const player = readFileSync("src/MinimalPlayer.tsx", "utf8");
const telemetry = readFileSync("src/telemetry.ts", "utf8");

const requiredPlayerMarkers = [
  'const isAudio = mediaType === "audio";',
  'isAudio ? "audio" : "skip"',
  "{isAudio && (",
  "AudioBridgeStatus",
];

for (const marker of requiredPlayerMarkers) {
  if (!player.includes(marker)) {
    throw new Error(`Missing player separation marker: ${marker}`);
  }
}

if (telemetry.includes("Math.random")) {
  throw new Error("Telemetry event IDs must not use Math.random()");
}

if (!telemetry.includes("globalThis.crypto?.randomUUID")) {
  throw new Error("Telemetry must prefer crypto.randomUUID()");
}

console.log("PASS: audio/video player separation and deterministic telemetry fallback checks");
