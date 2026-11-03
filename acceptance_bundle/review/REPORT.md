# AJN Redesign Slice A/B — owner acceptance evidence

Base reviewed: `9b9c1e2f8eaf051b7f4da53f70aaec7000029b2c`.
Source drop-in: `AJN_REDESIGN_SLICE_AB_2026-11-03.zip` (attached unchanged).
No app source files were edited during this verification; the diff below compares the accepted ZIP's five source files with the requested base.

## Radio presets test
Command: `NET_GUARD=block npx tsx test-radio-presets.tsx`
Result: PASS (exit 0).
Exact output:
`PASS radio presets: store rules, refusals, bad data, injectable storage, bar markup (5 slots, empty, filled, active, paused, non-radio)`

## Live dock
Selected through the app's Radio panel: Classic Hits 109 (70s–90s main channel).
Actual stream URL: `https://broadcast.classichits109.com/70s-90s`.
At both 1376×900 and 390×844, the existing `<audio>` was unpaused, `currentTime` advanced, `readyState=3`, `errorCode=null`, and the dock showed `LIVE`.
Computed LIVE pill: text `rgb(15, 17, 23)`, background `rgb(239, 68, 68)` at both viewports.

## Failure / Retry
The normally labelled `Animation+ [Geo-blocked]` feed actually played in this environment (HLS playlists and segments returned 200), so it did not produce a failure state.
To exercise the error UI without setting any app/React status, the browser run refused the real configured Classic Hits stream host at the network layer (`net::ERR_CONNECTION_REFUSED`). The actual audio element emitted `MediaError` code 4; the dock showed status `failed` and a visible `Retry Classic Hits 109` button at both viewports. This proves the UI response to a real media-element network failure, not an upstream outage.

## Dock and RadioDock DOM checks
- Nothing playing: one connected floating RadioDock button; desktop rect 1241.375,832,110.625×44; mobile rect 267.375,724,110.625×44.
- Live dock, panel closed: exactly one RadioDock button, portaled into `#radio-dock-slot`; dock count 1.
- Radio panel open with live dock mounted: dock count 1, panel open, RadioDock toggle count 0 (it is intentionally not rendered while its panel is open).
- Panel closed: exactly one toggle returns to `#radio-dock-slot`.
- `#player`: player route reached via the dock's Expand control while the real radio stream was playing; dock count 0 and one connected RadioDock button outside the slot.
- Dock closed via X: dock count 0; one connected RadioDock button outside the slot at both sizes. Clicking it reopened the Radio panel; the panel is open and toggle count 0.
- Across all captured states, the maximum number of `#radio-dock-button` elements was 1. No detached/orphaned button was observed. Browser page errors: 0.

## Screenshots
The evidence ZIP includes paired desktop/mobile captures for: nothing playing; real live dock; Radio panel open with dock mounted; Player page; dock dismissed by X; Radio reopened after dismissal; failure with Retry visible.

## Exact source diff
`Slice-A-B-git-diff-9b9c1e2.patch` is the unified diff of only these five files relative to the base above.
