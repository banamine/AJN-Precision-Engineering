# AJN Builder V1 — Execute, Verify, Fix Only Proven Defects

## Phase 1
1. Install dependencies.
2. Run `npm run lint` and `npm run build`.
3. Inspect Search -> `/api/search` -> `/api/archive/resolve` -> player.
4. Confirm no generated `{identifier}/{identifier}.mp4` URLs are used for Search playback.

## Phase 2
Only fix build/runtime defects demonstrated by evidence. Do not replace the player, proxy, EPG, scheduler, or add a second media pipeline.

## Phase 3 acceptance
- Search a TV News topic.
- Play Instant starts real video.
- Add 2-6 results to My News Chain.
- Refresh: chain persists.
- Open TV Guide: My News Chain appears as a channel.
- Select a chain program: playback starts.
- Let a chain item end: next saved item plays.
- Existing Guide channels still play.
- No HTML error page is passed to `<video>`.

Return exact build output, browser evidence, URLs/statuses, files changed, and final commit/build identity.
