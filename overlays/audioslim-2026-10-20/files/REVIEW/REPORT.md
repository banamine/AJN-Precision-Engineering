BASE SHA-256 — owner export: `002749be159fb37413495bdfd0273475b8dfdaf21ca9a4a9ee2d154577249353` | all-in-one overlay: `1f4243577e5f160c5f96688cc0067ad1f9ae57fee277ce5b7dffe98b88fab047` | RadioCaptions overlay: `f1a2d3c85834ada38cdfeb992e336c120a1f16c8aed9f11b6c7ddcb55a9b1cfb`

# AUDIO GUIDE SLIM — 2026-10-20

**Verdict: PARTIAL.** Audio-light behavior and focused verification pass. The production smoke exits nonzero on an existing Classic-TV XML track-count assertion (details below); it was not changed or suppressed.

## Scope and provenance

- Temporary review tree only; uploaded ZIPs were not edited. No Git metadata exists in the owner export, so no real branch or commit could be created. Requested branch designation: `feat/audio-guide-light`.
- No dependency, lockfile, ASR, caption, visualizer, proxy, range-fetch, HLS, or read-ahead behavior was changed.
- Archive access was blocked. **Physical Archive request starts: 0.** The Cloud Run smoke guard recorded 63 blocked outbound attempts total. Its pre-existing synthetic ASR smoke response was returned in-memory by the guard, not fetched from Archive. Chromium blocked every non-local request: 0 Archive and 0 other external requests.
- Node: `v22.22.0`. The targeted typecheck included changed files and their imports and excluded `full-files-for-export-baseline/` (the instructed ~56 TS2307 errors).
- `src/EpgGuide.tsx` is exactly 25 changed lines (16 additions, 9 deletions), at the stated client-core ceiling.

## E1 — payload measurements

All figures are from the offline production bundle, local cached channel data, fixed test clock, `NET_GUARD=block`. Raw bytes are decoded JSON; gzip bytes are wire sizes.

| Request | Raw bytes | gzip wire bytes | Result |
|---|---:|---:|---|
| `/api/schedule?guide=audio-podcasts` | 16,472,936 | 1,761,138 | Pass; equals the recorded pre-change Cloud Run smoke fixture byte count and is below 24 MiB |
| `...?guide=audio-podcasts&tz=420` | 19,111,602 | 1,960,098 | Pass; below 24 MiB |
| `...?guide=audio-podcasts&tz=420&light=1` | 5,507,202 | 458,452 | Pass; header `X-AJN-Light-Raw-Bytes: 5507202`; below the 6 MiB target (6,291,456) and hard 8 MiB limit (8,388,608) |
| `...?guide=audio-podcasts&channel=item-music-00s-radio-hits-2024&tz=420` | 529,762 | 66,501 | Pass; returns the full 376-row channel |

The same fixture contains 111 channels. Its default response has 12,051 programs. The long-loop music channel has 376 programs in the full response and exactly 3 in the light response. Light IDs are `ia-0fcc41964684:d81`, `ia-315320bc03e4:d82`, and `ia-0e6e0b89fa6c:d83`.

## E2–E6

| Gate | Result | Evidence |
|---|---|---|
| E2 row equality | **PASS** | The budget test deep-compares IDs and time fields between the `&channel=...&tz=420` response and the same channel in the full timezone response. All 3 light IDs are a subset of that channel’s current-plus-next-two rows. |
| E3 exports | **PASS** | Pre-change and final hashes match: `epg.xml` `d1055ce1213ba405c89a6dbb9091a1ccbd4c875246007428364c4b494cf2b8d6`; `playlist.m3u` `dc78896c145a39e2e3230b6f9a2a5de43a51e6eaae22b931d4bee2104201d07c`. |
| E4 Chromium | **PASS** | Synthetic-only screenshots are 390×844 and 1440×900. Per viewport: initial light response 6,907 bytes; demo radio retains 9 rows; one full-channel request includes `tz`; click plays the exact clicked demo program ID; full rows become visible after 719 ms (phone) / 728 ms (desktop) against a 600 ms stub; no external requests. The phone groups the complete schedule as 24 hourly blocks; desktop shows 30 tracks. |
| E5 failure/retry | **PASS** | The synthetic channel endpoint returns 503 once; the guide displays its explicit row error and Retry control; the second request succeeds. 2 endpoint requests per viewport, no fabricated rows. |
| E6 flag-off | **PASS** | With `AJN_AUDIO_LIGHT=0`, `light=1` and no-light requests return byte-identical full bodies: 19,111,602 bytes. The light raw-byte header is absent. Physical Archive starts: 0. |

The browser request log and screenshots are in `REVIEW/`; every displayed schedule/title in them is synthetic.

## Consumer audit

| Consumer | Existing data use | Audio-light disposition |
|---|---|---|
| `EpgGuide.tsx:259-292,337-376,871-905` | Main schedule, program selection, per-channel row fetch | Initial audio request uses light+timezone. A click requests the full channel with timezone. Loading, failure, and retry states remain explicit. |
| `groupProgramsForGrid.ts:83-88`; `BlockCell.tsx:24-63,81-113` | Groups narrow music tracks into hourly blocks and opens track drawer | Sparse (`programsComplete:false`) music rows remain individual program blocks; grouping is used after full rows load, avoiding a misleading “3 of 3” sparse block. |
| `TodayView.tsx:84-118` | On-now/next schedule | Audio request uses light+timezone. A stale audio cache is not displayed as current; refresh failure leaves the error/retry state rather than stale rows. Classic cache display policy is unchanged. |
| `loadSchedule.ts:8-29`; `HomeLiveStrip.tsx:18,37-54,116-122` | Shared schedule cache and on-now strip | Audio uses the separate sparse cache and light+timezone. Stale audio refresh rejects rather than silently returning stale rows, so the Home strip exposes its error/retry state. |
| `EpgGuide.tsx:301-317` | Guide schedule refresh | A stale cached schedule may remain visible only with the existing “showing last loaded version” refresh-error notice; it is not presented as a successful fresh refresh. |
| `RadioDock.tsx:159`; `RadioPresetsBar.tsx:97` | Current radio item or saved preset passed to playback | Not schedule-array consumers; no change. |
| `home/digestModel.ts:50` | RSS digest entries tagged with the audio guide ID | Does not read guide schedule rows; no change. |
| `utils/continuity.ts:16,42`; `components/PlayerView.tsx:103-117,184` | Continuity scans programs; player fetches a channel’s next-track schedule | Player fetch remains a full no-light channel request; not trimmed by this route. |
| `guide/liveTune.ts:27-72` | Tunes an already selected program by its times and media type | Receives the selected row; no schedule fetch or change. |
| `data/homeFeatures.ts:35` | Static Audio & Music navigation metadata | Not a schedule reader; no change. |
| `server.ts:73-85,163-166`; `server/channelExport.ts:50-85` | Full guide snapshots for exports | Export path remains no-light. E3 hashes are unchanged. |

## Verification and blocker

| Check | Status | Output / note |
|---|---|---|
| Node runtime | **PASS** | `node -v` → `v22.22.0` |
| Focused TypeScript | **PASS** | `NODE_OPTIONS=--max-old-space-size=1400 node_modules/.bin/tsc --noEmit -p REVIEW/audioslim-tsconfig.json` → exit 0, no diagnostics; the review config is included and excludes the instructed baseline directory. |
| Production build | **PASS** | `npm run build` → exit 0. Vite emitted its existing >500 kB chunk advisory; server bundle completed. |
| New audio-light schedule/client tests | **PASS** | Three-row selection, wrap, identity, untouched channels, invalid inputs, cache separation, stale-audio rejection/display policy and audio URL checks. |
| Grouping test | **PASS** | `test-group-programs-for-grid.ts` → `grouping tests passed`; full schedule grouping remains covered. |
| Existing Classic light unit test | **PASS** | `test-classic-light-schedule.ts` → now+next2, title index, empty/restricted rows, timezone validation, 2 MiB fixture budget. |
| Synthetic browser suite | **PASS** | 390×844 and 1440×900; exact program ID, 503/retry, 9-row radio fixture, measured row timing, zero external traffic. |
| Production Cloud Run smoke | **PARTIAL / exit 1** | Health, request-size limits, audio checks, exports, flag-off, shutdown, and network guard passed. The unchanged Classic-TV XML comparison fails: 26,717 schedule rows vs 26,098 `<programme>` entries (difference 619). `server/channelExport.ts:38-41,79-82` emits XML only for programs with valid absolute start/stop times. This is an existing Classic fixture/assertion mismatch; no Classic export code or test assertion was changed. |

**Classic TV light byte identity: NOT VERIFIED.** Per L1, only the existing Classic light unit test was run; it passes but does not print before/after HTTP raw bytes. The Classic light helper and its response logic were not changed. A Classic browser/API byte comparison was intentionally not run.

Other not verified: live Archive behavior (prohibited for this job); real media playback; the full repository typecheck outside the focused changed/import graph. The ~56 instructed baseline TS2307 errors were excluded. The root smoke command remains exit 1 until the separate Classic XML mismatch is reviewed; no fix was made because Classic TV is protected in this gate.

## Changed files

The 16 repo-path files listed in `UPLOAD_ORDER.txt` are the only AudioSlim additions/modifications versus the owner export + all-in-one + RadioCaptions base. No package manifest or lockfile changed. `UPLOAD_ORDER.txt` and `ROLLBACK.txt` at the ZIP root are package instructions; do not upload those two files into the repository. Review evidence is separate under `REVIEW/`.

**Stopped after job 01.** No next job was started.
