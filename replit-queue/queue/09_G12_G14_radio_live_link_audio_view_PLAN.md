# AJN Radio live link + AJN Audio view (director loop, icons, backgrounds) - investigation plan, QUEUED (2026-10-18)

Scope: `banamine/AJN-Precision-Engineering` only. Status: QUEUED, not started. Do not send to Replit until G0-G11 of the current pack are reviewed (see "Queue position").

## TL;DR
Two linked features, both for later: (1) put the AJN radio live link into the live radio station list, (2) add an "AJN audio view" of the player: visualizer with a small grey "AL" icon at bottom-left of the control bar that plays one looping muted video/GIF, plus icon images and backgrounds behind the visualizer when playback was started from the audio view. Both need owner input first (the links, the asset, and three wording questions below). Investigation comes before any build.

## Owner input needed BEFORE Phase 1 (nothing below can start without it)
1. The radio live link(s): exact URL(s), which station they belong to, and whether they are the same as the 11 live entries in `ajnResourceService.ts` (alex-aac, alex-mp3, alex-opus, alex-alt-aac, warroom, network-aac, two `audio.alexjoneslive.com:8443`). Paste them into the next Replit-bound message or a file in `N:\New Downloads\`.
2. The loop clip: the file (or link) for the "director" clip, and who owns it (rights). Claude cannot choose or generate it. Preferred format: short muted MP4/WebM loop, not a GIF (see risks).
3. Wording to confirm (I took a reading, tell me if wrong):
   - "grey bottom AL icon": read as a small grey button labelled "AL" (AJN Live? AJN Audio?) in the bottom-left of the audio view's control bar. Confirm the letters and what it stands for.
   - "keeps a GIF video playing as a warm similar to a police chase video": read as an ambient, always-looping, silent "live feed" style clip (like a helicopter chase feed) that gives the audio view some motion. Confirm that is the intent, and whether it plays only while audio plays, or always.
   - "only one": one clip, one slot, in the bottom-left of the control bar below the visualizer. Confirm: not a playlist of clips.
   - "backgrounds behind the visualizer": decorative backgrounds, not episode cover art. Confirm they are your own images or ones you own the rights to.

## What is already known (VERIFIED from project docs, not re-run today)
- Radio view and live sources: live audio list is UNVERIFIED (docs of 2026-10-03/04). `/api/ajn/proxy` rejects URLs with a port, so `:8443` links can only play direct. Live streams must play direct (32 MiB proxy rule). `stream.alexjones.media` was reported with `Access-Control-Allow-Origin: *` but not re-checked.
- The visualizer is `AudioBridgeStatus` (analyser-driven), mounted in `MinimalPlayer.tsx` and `DevModeView.tsx`. The analyser only works when the audio is CORS-readable; otherwise the honest "no spectrum" state is shown. No second audio engine, no fake spectrum.
- Rule from the Radio UI work: no invented cover art. Decorative backgrounds must be labelled decorative and never presented as episode art.
- Live-stream reconnect: `MinimalPlayer.tsx` had no bounded retry (audit 2026-10-04). A live link added without it will just stall.
- Radio presets (separate work, 2026-10-16/18) already define a live radio station list; the new link must go through that same list, not a second one.

## Investigation (Phase 1, read-only; produces evidence, changes nothing)
A. Live link. For each link: HTTP status, redirects, `Content-Type`, `icy-*` headers, CORS headers with `Origin: https://ajn-precision-engineering.ai.studio`, first bytes decode, and whether it plays in a real browser (`<audio>` with and without `crossorigin`). Run from the owner's Windows PowerShell (`curl.exe -sIL --max-time 20 "<url>"`, `curl.exe -sI -H "Origin: ..." "<url>"`) because the cloud sandbox cannot reach these hosts; Replit can try a budgeted version (max 10 requests, 1/s, stop on 403/429). Also find where the live station list is built (Radio presets, `ajnResourceService.ts`, liveTv sources) and name the single place the entry should go.
B. Audio view. Wiring map with file:line: where the audio player view renders, the control bar component, where `AudioBridgeStatus` sits, how "started from the audio view" is known (a state flag, not a guess), and what the persistent player does when the viewer leaves the page.
C. Loop clip. Format, duration, dimensions, bytes. Decide: GIF vs MP4/WebM. A GIF of 10 s at 480p is commonly several MB and has no pause or reduced-motion control; a muted `<video autoplay loop muted playsinline>` is far smaller. Measure the actual file before choosing. Where it is served from (bundled in `public/`, not proxied through `/api/archive/proxy`).
D. Assets. List of icons and backgrounds, bytes each, total bytes added to the bundle, and whether each is loaded lazily (only when the audio view opens).
E. Accessibility and honesty: `prefers-reduced-motion` stops the loop (shows a still frame); a visible pause control for the loop; text label on the "AL" button, not colour alone; the loop never implies a live picture of the station (add a label "decorative loop" or similar if it could be mistaken for live video).

## Implementation plan (Phase 2, only after Phase 1 is reviewed)
- P2.1 Live link: add the verified entry to the one live radio list. If the stream is not CORS-readable, play direct with the honest "no spectrum" state; add bounded reconnect (reuse the radio engine numbers from the audit: 8 attempts, 10 s stall, backoff) only if Phase 1 shows stalls, and only in the player, not in a second engine.
- P2.2 AJN audio view: a view mode of the existing player (not a new player). Bottom-left of the control bar, below the visualizer, one `AL` grey button. Pressing it shows/hides the single loop clip; the clip element is `muted`, `loop`, `playsinline`, `preload="none"` until shown. Nothing autoplays with sound.
- P2.3 Backgrounds and icons: layered behind the visualizer (CSS layer, `z-index` below the canvas), only when playback was started from the audio view (state flag). Lazy-loaded; no effect on other views.
- Do not touch: UnifiedPlaybackEngine, PlayerStore, StatusIndicatorBar, DiagnosticsHUD and the rest of the protected core beyond the named minimum wiring.

## Verification plan (Phase 3)
- Live link: curl output before/after; production-server route returns the entry; real browser plays it (owner test: NOT VERIFIED from Replit, no real audio output).
- Audio view: Chromium DOM tests at 390 px and 1440 px (SYNTHETIC player stub): AL button exists only in audio view; exactly one loop element; clip paused/hidden with reduced motion; backgrounds absent when playback started from another view; no second `<audio>` element; screenshots saved.
- Bundle: before/after bytes for the build; initial-load JS unchanged (assets lazy).
- Existing tests unchanged (radio-view, audio-bridge, singleton, player-honesty).
- NOT VERIFIED by design: real listening, real phone, Cloud Run, Google Builder.

## Risks
- Rights to the loop clip and background images (owner must confirm).
- A GIF can be large and cannot be paused; prefer MP4/WebM.
- Live URL may be CORS-blocked (no analyser) or port-restricted (`:8443` direct only).
- Looping video behind audio costs battery and data on phones; keep it off by default on small screens unless the owner says otherwise.
- Do not merge with Live TV/Classic work: separate branch.

## Queue position
After the current pack. Proposed gates (added to the ledger when the pack is next regenerated; not in the shipped zip):
| Gate | What | Needs |
|---|---|---|
| G12 | Investigation A-E above (read-only, one ZIP) | Owner supplies links + clip + answers to the wording questions; G11 reviewed |
| G13 | Live link into the live radio list (P2.1) | GO G13 after G12 reviewed |
| G14 | AJN audio view: AL button, loop, backgrounds/icons (P2.2, P2.3) | GO G14 after G13 reviewed |
Branch: from `origin/main` as `feat/radio-live-link-audio-view` (separate from the E-F-G-I chain).

## Addendum 2026-10-18 (07:43): owner-supplied "War Room Stream & Layout" brief reviewed
The brief is a standalone `index.html` (fixed full-screen muted looping `<video>` + frosted "news panel" + ticker) for the Alex Jones Network War Room audio feed. Review against doctrine (read from the pasted file; nothing run):
- CONFLICT with the earlier request: you first asked for ONE small clip slot at the bottom-left of the control bar under the visualizer; this brief is a full-screen background. Decision needed: (a) small clip slot only, (b) full-screen background only, (c) both (background behind the visualizer, small AL slot toggles it). Plan default until answered: (a), full-screen as a later option.
- Placeholder asset: the `<source>` is Google's public sample `ForBiggerBlazes.mp4` (hotlinked). Not your clip, not ours to ship, and a third-party hotlink can vanish. Must be replaced by the real loop bundled with the app.
- Fabricated panel text: "Real-time intelligence breakdown streaming directly from the network feed", "ANALYSIS IN PROGRESS // SECURING TRANSMISSION CHANNEL..." and the pulsing "Exclusive Audio Feed" badge are hardcoded and imply a live analysis/transmission that does not exist (fake telemetry rule). The panel must show real data only: `nowPlaying` title/show, real status pill (RECORDED / LIVE AUDIO from `mediaType`/`isLive`), and the Daily News Digest only after its source is verified. Pulse animation only when truly live, and not under `prefers-reduced-motion`.
- Standalone page vs app: `body{overflow:hidden}` and `position:fixed; z-index:-1` would fight the app shell and the persistent player. Needs to be a view mode inside the existing player, scoped CSS, no global resets.
- Codec section is not applicable and partly unverified: a short local loop needs one H.264 MP4 plus an optional WebM/VP9 source; HEVC/AV1 are not universally playable, CBR and 2-4 s segments are for live streaming, not a looped file, and the "30-50% lower bitrate" claim comes from a marketing blog, so it is not evidence. We will measure the real clip instead (bytes, duration, dimensions).
- Contrast: footer `#777` at 11 px on near-black is marginal; check in Phase 1.
- No visualizer in the brief: the layout must keep `AudioBridgeStatus` (real analyser or honest "no spectrum") above the video layer.
- Naming: keep the AJN network War Room (Alex Jones / Harrison Smith) labelled separately from Real America's Voice "Bannon's War Room"; never merge.

## Next action
Owner: paste the radio live link(s), send the loop clip and background/icon images (or say where they live), and answer the three wording questions. Then Claude writes the Replit job file for G12.

## Addendum 2 (07:51): owner decisions + seed ideas for the summary news panels (PLANNING ONLY, positions/timing not set)
Owner decisions: layout = BOTH (full-screen loop behind the visualizer, small clip slot / AL button toggles it). Clicking the slot switches Audio mode <-> Video mode. Summary news panels show in AUDIO mode only; Video mode shows loop + visualizer + controls, no panels.
Existing hosts (from the 2026-10-15 decision doc, repo export exp21): `RadioBriefingPlayerOverlay.tsx` already puts the briefing in the live-radio audio stage under the station card; `DailyBriefing.tsx` on Home; `GET /api/digest` (503 when not loaded). Reuse these, no second panel system. Source content must be real (digest items, verified TV Third Eye block only after terms review); each item shows its timestamp/source; hide stale items; empty = explicit line.
Behaviour options (A-E) and the decision table are in the chat reply of 2026-10-18; open items: panel position, rotation interval, number of panels, pause on hover/focus/touch, reduced-motion = static list, data refresh cadence, what shows when the digest is unavailable.

## Addendum 3 (07:55): plan CLOSED for now
Owner chose Claude's suggestions: panels = single rotating panel (C) on phones, quad staggered rotating panels (D) at >= 1440 px, same cards, flat stack (A) as fallback; Audio mode only; pause on hover/focus/touch; static list under reduced-motion; real data only, each card with source + time, items older than 3 h hidden, explicit line when the feed is unavailable. Panel position, interval, panel count and tap behaviour stay OPEN and are set after Replit's G12 report. Still needed: radio live link(s), loop clip, icon/background images, meaning of "AL". No further work on this plan until then.
