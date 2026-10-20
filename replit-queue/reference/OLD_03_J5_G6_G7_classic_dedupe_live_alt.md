# J5 - Prompt G: Classic duplicates + Live/VOD two-path
GATES: G6 = Part 1 (Classic duplicates), G7 = Part 2 (Live alternate). Wait for "GO G6" / "GO G7".
BASE: final commit of `feat/buffer-gauge-readahead` (Prompt F). New facts from the E review: Classic TV raw schedule has only 34,163 bytes of headroom, so de-duplication should REDUCE size and nothing may add fields to schedule programs; All My Children admission floor is 30 s because of the existing test-extra-channels.ts.
STOP RULE: do exactly the gate(s) named below, deliver the ZIP, update STATE.md, then STOP and wait for the owner's GO message. Follow docs/replit-starter/00_START_HERE.md, 01_DELIVERY_PROTOCOL.md and 04_PHASE_GATES.md. Run every test under tools/net-guard.mjs.

ROLE: Builder and tester for AJN Precision Engineering only (not AJN-pro-play-, not AJN-Media-Console). Evidence first: raw command output, measured numbers, screenshots. No fake telemetry, no `any`, no invented data, and NO silent fallbacks: a viewer is never switched to different content without being told and choosing. Phases per part: Investigation -> Plan -> Implementation -> Verification. Do not start Part 2 until Part 1 is committed and tested.

BASE AND BRANCH: new branch `feat/classic-dedupe-live-alt` from the final commit of Prompt F's branch (`feat/buffer-gauge-readahead`). Do not merge, push or deploy. Node 22. One commit per part.

HARD RULES:
- Archive requests: 0 in all tests (injected stubs, local fake servers). Live-stream requests: Part 2 Phase 1 only, within the budget below.
- Proxy rules unchanged: responses never exceed 32 MiB, slices <= 8 MiB (server/proxyRange.ts). Do not change the proxy or PROXY_SLICE_BYTES.
- Protected core: do not rewrite UnifiedPlaybackEngine, BroadcastTVGuide, PlayerStore, StatusIndicatorBar, ChannelManager, SchedulerEngine, PluginHost, ArchiveProvider, IPTVProvider or DiagnosticsHUD. Minimum wiring only; list every touched line.
- Source playlists in m3u_files/ are NOT edited or deleted. Deduplication happens in the schedule build, with every dropped or demoted entry listed in a report.
- One implementation: reuse server/sources/classicM3u.ts, server/sources/liveTv.ts (checkLiveUrl, channel id scheme `live-<slug(tvgId||name)>`), src/guide/liveTune.ts, the existing identity helpers in src/utils/epgIdentity.ts.
- Never log URLs with signed query parameters.

PART 1 - CLASSIC DUPLICATES

Phase 1 (measure, report, change nothing): over the FULL Classic schedule as the server builds it (not the capped src/data/classicSnapshot.json), count duplicates by (a) identical mediaUrl/archivePath without query, (b) identical normalized title within one channel, (c) identical normalized title across channels, (d) same show + SxxExx (or "S-nn EP nn") across channels. For (b) and (c), compare the URLs: same title with different URLs is a "same-title variant", not a duplicate. Report counts per kind and per channel, and the 40 largest groups verbatim. Known examples to confirm or refute: `20110520 Dr Connett ROUND-TABLE` and `specialreport20150313 wellness` in both classic-ajn-archive-1 and classic-super-alex-jones-archive; Honeymooners "39 Episodes" parts 1-3 twice in classic-honeymooner-classic-movies; the 14 "September 11 2001" entries in classic-september-11-2001 (same file or 14 different files?); the two Dr. Judy Wood title variants in classic-fact-fake-news.
Phase 2 (plan): write the rule before building. Proposed: exact-URL duplicates across channels are kept in the channel that matches the content (owner decides ties) and shown elsewhere as "also in <channel>" rather than listed twice; exact-URL duplicates inside one channel are dropped (first wins); same-title different-URL entries are kept and labelled "Version 2" with the length/size so the viewer can tell them apart. State the effect on program counts and on the 32 MB classic-tv budget. No title is rewritten to hide a difference.
Phase 3 (build): a pure module (for example server/classicDedupe.ts) used by the schedule build, plus a DEDUPE report endpoint or script output listing kept, demoted and dropped ids. Keep program ids stable for kept entries.
Phase 4 (verify): unit tests for each kind, a test that no kept entry changes id, a test that the dropped list is complete (kept + dropped = input), count before/after on the full schedule, and the existing Classic tests unchanged (classic light guide, group-programs, guide-channel-index, archive-item-guide, aired-time, test-extra-channels, test-series, Prompt D/E/F tests).


PART 2 - LIVE ALTERNATE FOR SELECTED CLASSIC SHOWS

Goal: for selected Classic shows only, the viewer can choose "Watch VOD" or "Watch Live", and when VOD fails or stalls the app OFFERS the Live option. It never switches by itself.

Phase 1 (measure, report): live-stream budget 40 requests, 1 per second, descriptive User-Agent, stop on 403/429 (no retry). Take the two live lists exactly as server/sources/liveTv.ts does. For each candidate - Hogan's Heroes (iptv-org channel "Hogan's Heroes", Classic group), River Monsters (Rakuten channel "River Monsters"), I Love Lucy (iptv-org channel; Classic has only commercials, so expect NO episode overlap and report it as not applicable unless you find episodes) - report: channel id the app would create, URL host (no query), checkLiveUrl result, manifest status, whether the first segment answers, how the existing playback path handles it (direct vs playlist proxy; see scripts/live-tv-probe.ts and probe-results/), and CORS result. Also search the lists for any other Classic show names with a live channel, listing every candidate with an exact or contains match and marking noise (generic names such as "Classic Movies" are NOT show matches). State plainly: a live channel shows what is on now, not the VOD episode.
Phase 2 (plan): a data file src/data/liveAlternates.json (ASCII-only), one entry per selected show: { showKey, classicChannelId, liveChannelId, liveName, note }. Only listed shows get the option. Entries are added by the owner after reviewing Phase 1; ship only the entries Phase 1 verified. The live channel id is resolved at runtime from the live list; if it is not in the current list, the option is shown as unavailable with the reason, never hidden silently and never replaced.
Phase 3 (build):
1. A small resolver (src/guide/liveAlternate.ts, pure) mapping a Classic program to its live alternate or null.
2. UI on the existing player chrome: a "VOD | Live" switch for mapped shows; the current mode is shown in text, not colour alone, with a short note "Live shows what is airing now, not this episode".
3. VOD failure/stall prompt: reuse the existing failure and watchdog signals (20 s progress watchdog, 108 s start budget, stall recovery; do not change their timings). When one fires for a mapped show, show "VOD is not playing. Watch live instead?" with a button. No auto-switch. Dismissing it keeps the explicit error state.
4. If the live path also fails: show its real error (named state). No third fallback, no sample video.
5. Telemetry events (using the existing telemetry module, honest values only): vod_failed_live_offered, live_chosen, live_failed. No fake numbers.
Phase 4 (verify): unit tests for the resolver (mapped, unmapped, live channel missing from list); Chromium tests at 390 px and 1440 px with stubs: toggle works both ways; blocked VOD URL shows the prompt and the player does NOT change source until the button is pressed; live failure shows its own error; unmapped show has no toggle; screenshots in docs/classic-dedupe-live-alt/screens/. Existing tests unchanged (player-honesty, epg-tune-window, prefetch, thumbnail lane, classic light guide, Prompt F buffer tests). Archive requests = 0; list the Phase 1 live requests.


DELIVER:
1. Branch name and commit list (one per part).
2. docs/classic-dedupe-live-alt/REPORT.md: Phase 1 tables, the rule chosen and why, what was built, before/after counts, a VERIFIED / NOT VERIFIED table (not verified must name why: real viewer VOD outage, live stream stability over time, real phone, real Cloud Run), risks, rollback (data file empty = feature off; dedupe flag).
3. A flat ZIP of the FINAL versions of every file changed versus Prompt F's branch, at repo-relative paths, plus FILE_SUMMARIES.txt (one true line per file); list preview/test-only files separately.
4. One combined patch + the output of `git apply --check` against a clean checkout of the base you used.
5. Exact commands and outputs for tsc, build, every test added or touched, Node version, and request counts.
If a part cannot be finished safely, ship the finished part, mark the rest NOT DONE with the reason, and do not substitute assumptions for measurements.
