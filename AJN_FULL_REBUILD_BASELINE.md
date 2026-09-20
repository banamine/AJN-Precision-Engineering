# AJN Full Rebuild — Phase 1/2 Repair Baseline

## Phase 1 evidence

Source: uploaded Builder project export supplied on 2026-09-19.

The supplied runtime log shows:
- Vite production build succeeds.
- Archive News endpoints return HTTP 200 for several collections.
- The browser repeatedly reports `Maximum update depth exceeded`.

The runtime source contained two concrete React render-loop hazards:

1. `src/App.tsx` called `setNowPlaying()` from inside the functional updater passed to
   `setRecentlyPlayed()`. State updater functions must remain pure; cross-state writes can
   be re-entered while React processes queued updates.
2. `src/components/AudioBridgeStatus.tsx` called `setSignalActive()` on every animation
   frame. That caused a React render for every RAF tick even though the visualizer itself
   only needs a state change when the signal crosses active/inactive state.

## Phase 2 repairs

### `src/App.tsx`
Playback state and Recently Played state are now updated independently. The existing
Recently Played item is read before the state update, then `setNowPlaying()` and
`setRecentlyPlayed()` are issued as separate operations.

### `src/components/AudioBridgeStatus.tsx`
Signal state is now guarded by a ref and only updates when the boolean active/inactive
state changes. The canvas continues to render from the real AnalyserNode every frame.

### `src/MinimalPlayer.tsx`
The existing audio/video separation is retained:
- video uses the native `<video>` element and `playerType="skip"` for the audio bridge;
- audio uses the `<audio>` element and the existing AudioBridge diagnostics path.

## Verification included

`test-runtime-loop-guards.mjs` checks the repaired state-update boundaries and the
audio/video separation contract.

`test-player-separation.mjs` remains in the project for the existing player regression
contract.

## Phase 3 required on Builder

Run:

```bash
npm install
npm run test:runtime-loop-guards
npm run test:player-separation
npm run lint
npm run build
```

Then load the application and verify:
1. no `Maximum update depth exceeded` errors;
2. selecting media still enters the Player view;
3. video does not instantiate the AudioBridge pipeline;
4. audio retains the visualizer;
5. Archive/News playback still resolves through the existing transport path.

This package does not claim browser/runtime verification beyond the supplied Phase 1 log
and the included static regression checks.