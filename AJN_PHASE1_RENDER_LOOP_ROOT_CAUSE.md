# AJN Phase 1 — React Maximum Update Depth Root Cause

## Evidence

Builder runtime continued to report:

`Maximum update depth exceeded`

The previous static tests passed, but those tests only guarded two known patterns and did not exercise React's effect dependency graph.

## Root cause identified in the rebuilt source

The playback effect in `src/MinimalPlayer.tsx` depends on callback props that were recreated by `src/components/PlayerView.tsx` on every render:

- `onPlayEvent={() => ...}`
- `onPauseEvent={() => ...}`
- `onErrorEvent={(err) => ...}`
- `onProgressEvent={(position) => ...}`

`readResumePosition` also incorrectly included `onProgressEvent` in its dependency list even though it does not use that callback.

When the media effect updates local player state (for example from `loadedmetadata` / `play`), the parent rerenders, creates fresh callback identities, and the media effect can be torn down/recreated and call `media.load()` again. That can produce the React/media update cycle reported by Builder.

A second identity churn existed in `src/App.tsx`: `handlePlayProgram` depended directly on the `recentlyPlayed` array, so progress updates changed the callback identity and propagated into the player tree.

## Repair

1. `PlayerView.tsx` now memoizes all playback callback props with `useCallback`.
2. `MinimalPlayer.tsx` removes the unused `onProgressEvent` dependency from `readResumePosition`.
3. `App.tsx` keeps a `recentlyPlayedRef` mirror so `handlePlayProgram` remains stable while still reading the latest Recently Played data.
4. The existing AudioBridge animation-frame state guard remains in place.
5. Video continues to bypass the AudioBridge hook (`isAudio ? "audio" : "skip"`).

## Static verification

- `node test-runtime-loop-guards.mjs` — PASS
- `node test-player-separation.mjs` — PASS

## Required browser verification

Static tests are not sufficient to prove the React runtime is fixed. Builder must run the application and confirm that the browser console no longer reports `Maximum update depth exceeded` during:

1. initial Home load;
2. navigation to TV Guide;
3. opening Player;
4. video playback;
5. audio playback;
6. Recently Played progress updates.