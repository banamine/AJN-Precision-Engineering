# AJN Full Fixed Drop-In Report

## Baseline
Source: `ajn-precision-engineering (1).zip`
Files in supplied archive: 1166

## Surgical repairs applied

1. `src/MinimalPlayer.tsx`
   - AudioBridge/AudioContext is now explicitly restricted to `mediaType === "audio"`.
   - Video playback uses the native video transport without entering the audio visualizer/normalization pipeline.
   - The audio visualizer is rendered only for audio playback.
   - This prevents the audio-player diagnostic pipeline from becoming a second video transport.

2. `src/telemetry.ts`
   - Removed the `Math.random()` fallback from telemetry event IDs.
   - Uses `crypto.randomUUID()` when available.
   - Uses a timestamp + monotonic module sequence as the deterministic fallback.

3. `package.json`
   - Added `npm run test:player-separation`.

4. `test-player-separation.mjs`
   - Static regression check for audio/video pipeline separation.
   - Static regression check that telemetry does not use `Math.random()`.

## Verification performed in this environment

PASS:
`node test-player-separation.mjs`

The full dependency install/build was not completed in this environment because `npm install` timed out. Therefore this package is **source-repaired but not claimed as production-runtime verified**.

## Important source boundary

The supplied ZIP does not contain:
- `src/components/LocalMediaPanel.tsx`
- `src/localM3u.ts`
- `src/localMediaEpg.ts`

Those PR #33 Local Media files were not fabricated into this package.

## Phase 3 required on Windows/Builder

After installing dependencies:
1. `npm run lint`
2. `npm run build`
3. `npm run test:player-separation`
4. Run the application.
5. Verify a real video opens and plays without the AudioBridge visualizer taking ownership.
6. Verify an audio item still opens the AudioBridge visualizer.
7. Verify News/Archive playback and recently-played resume.
8. Capture browser Console/Network evidence for any playback failure.
