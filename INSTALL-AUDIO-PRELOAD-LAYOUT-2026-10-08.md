# Audio preload + layout zones (2026-10-08)
Copy these files over the repo (same paths), then rebuild/republish. No new dependencies, no server change.

- src/MinimalPlayer.tsx            hidden next-track element + adoption; audio zones
- src/components/PlayerView.tsx    pickNext() shared rule, resolveNext prop, one schedule fetch per item
- src/components/PlayerChrome.tsx  audio controls = own glass bar under the stage
- src/components/AudioVisualizerOverlay.tsx  audio canvas fills only the stage; video strip sits above the transport
- src/App.tsx                      toPlayableSrc moved to src/utils/playableSrc.ts (import only)
- src/utils/playableSrc.ts         NEW
- test-audio-preload-layout.mjs    NEW (playwright; AJN_TEST_URL=<app> node test-audio-preload-layout.mjs)

Verify after republish: play any audio channel/track; in DevTools Network a request for the NEXT file appears ~45 s before the end;
at the end the new track starts with no pause. Layout: art centred, bars behind it, controls bar underneath, nothing overlapping.
