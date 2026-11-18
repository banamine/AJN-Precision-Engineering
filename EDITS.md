# AJN Podcast Skip Buttons (2026-11-17)
Skip buttons for podcast episodes so a listener can jump past an ad read.
- **Full player** (PlayerChrome): a row of three buttons under the controls: +15s, +30s, +1m.
- **Bottom dock** (MiniPlayerDock): -15s (undo an overshoot) and +30s. On desktop they sit beside Play. On a phone they get their own row under the bar (like the radio Prev/Next row), 48 px tall, because the main row has no room at 390 px.
- Shown ONLY for an on-demand podcast episode (`podcast-<show>` lists and `pod-<source>` feed channels) whose length is known. Never for live radio, music, concerts or the 24/7 "Fresh first" stack (`pod-network-*`).
- Quick taps stack: +30s twice within 1 second = +60s, even while Archive.org is still loading the first piece (`utils/podcastSkip.ts`, one shared helper for both players).
- A skip never goes below 0 or past 0.5 s before the end.
- Keyboard: NOT changed. The player already ignores keys while you type in a box or slider, and Shift+Arrow is already 30 s.
- Rush (`rush-vod`) is NOT included; say so if you want it.

## Apply (repo root, about 5 seconds)
1. Copy the `src` folder from this zip over the repo's `src` folder (adds `src/utils/podcastSkip.ts`). Copy `test-podcast-skip.ts` into the repo root.
2. `python apply-edits.py`  -> expect: `applied 4 edits to src/hooks/usePersistentMedia.ts`, `applied 4 ... PlayerChrome.tsx`, `applied 1 ... MinimalPlayer.tsx`, `applied 5 ... MiniPlayerDock.tsx`. A second run says "already applied".

## Verify
- `npx tsx test-podcast-skip.ts` (about 10 s) -> `test-podcast-skip OK`
- In the app: play a podcast episode; tap +30s in the full player, then close it and use the dock. Tap +30s twice quickly -> about +60s. Start `AJN Podcasts 24/7` from the TV guide, a music track and a live radio station -> no skip buttons. Click the search box in Library, press the arrow keys -> the cursor moves, audio does not skip.
