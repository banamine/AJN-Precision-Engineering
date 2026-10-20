# AJN REPLIT PACK - RUNBOOK (read this first; it replaces pasting prompts one by one)

Pack date 2026-10-18. Scope: `banamine/AJN-Precision-Engineering` only (not AJN-pro-play-, not AJN-Media-Console).
Who does what: YOU (Replit agent) search the repo, place files, build, run the real mechanics and test. CLAUDE reviews every ZIP and reconfirms before anything goes to Google Builder. The OWNER relays ZIPs and sends one GO message per gate. Nobody pushes, merges or deploys from Replit.

## 1. How a gate works (applies to every gate)
1. Read this runbook, `docs/replit-starter/00_START_HERE.md`, `01_DELIVERY_PROTOCOL.md`, `04_PHASE_GATES.md`, then ONLY the job file for the gate.
2. Print the wiring map for what you will touch (file:line) before editing; print it again after.
3. Do exactly that gate. Use your own tools to search, read and place files; do not ask the owner where things are. Ask only for decisions the job file lists as owner decisions.
4. Run every test and script under `tools/net-guard.mjs` (`node --import ./tools/net-guard.mjs ...` or `NODE_OPTIONS="--import ./tools/net-guard.mjs"`). Print the guard line each time. Real Archive access happens only where the job file gives a budget, and then through the budgeted tool or script, run with `NET_GUARD=count` so the guard counts it independently (the guard's default BLOCK mode is for tests). When you start the production server for a gate that has an Archive budget, start it under the guard in COUNT mode as well and report its totals.
5. Run the real mechanics wherever Replit can: production build, real routes with curl, real Chromium DOM tests. Label stubs and fake players SYNTHETIC. Anything Replit cannot prove (real H.264 playback, audio sync, a real phone, Cloud Run, Google Builder) is NOT VERIFIED with the reason.
6. Update `STATE.md` (include it in the ZIP), package `deliver/AJN_PACK_<gate>.zip` per `01_DELIVERY_PROTOCOL.md`, and end with exactly:
   `GATE <Gn> DONE | ZIP READY: <path> <size> <sha256> | verdict: <PASS/PARTIAL/FAIL/BLOCKED> | NOT VERIFIED: <list> | owner decisions needed: <list or none>`
7. STOP. Do not start the next gate. Wait for the owner's message `GO <Gn>` (a job file that says "GO PART 2" means the GO message for that job's next gate).

## 2. Gates
| Gate | Job file | What | Needs before it starts |
|---|---|---|---|
| G0 | J0 | Setup, branch check, baseline numbers, wiring map, guard proof | nothing |
| G1 | J1 | Captions eligibility census (read-only) | G0 |
| G2 | J2 | Coverage matrix: search / Library / guide / Now Playing (read-only) | G0 |
| G3 | J3 | Radio song index Phase 1 (investigation; includes a 60-minute capture) | G0 |
| G4 | J4 | Prompt F Part 1: buffer gauge | G0 |
| G5 | J4 | Prompt F Part 2: server read-ahead | GO G5 after G4 reviewed |
| G6 | J5 | Prompt G Part 1: Classic duplicates | F reviewed |
| G7 | J5 | Prompt G Part 2: Live/VOD two-path | GO G7 |
| G8 | J6 | Captions build for eligible networks + WebVTT | GO G8 with the owner's network list |
| G9 | J6 | Captions: simplest cloud check | GO G9 |
| G10 | J7 | Coverage test + gap fixes | GO G10 with approved exclusion rules; G7 reviewed |
| G11 | J7 | Super-search design (no code) | GO G11 |
| GR2, GR3, GR4 | RECOMMENDATIONS.md | Optional recommendation ZIPs | GO GR2 / GR3 / GR4 |

Recommended order: G0, G1, G2, G4, G5, G6, G7, G8, G9, G10, G11, then G3 and the GR gates whenever the owner is away from the keyboard. The owner may reorder by sending a different GO.

## 3. Branch chain (never rebase across it)
`feat/library-allmychildren` (E, delivered) -> `feat/buffer-gauge-readahead` (F) -> `feat/classic-dedupe-live-alt` (G) -> `feat/coverage-audit` (I). Captions work (H) branches from `origin/main` as `feat/captions-eligible-networks`; Prompt C uses `investigate/radio-song-index-phase1` from `origin/main`. Each gate's patch must pass `git apply --check` against the previous gate's final commit; print the output.

## 4. What you may do on your own
Search and read any file in the repo; place and edit files that the gate names; create fixtures, scripts, tests and screenshots; run builds and tests; install nothing except through `npm ci`; start the production bundle as a plain background process (`PORT=3000 NODE_ENV=production node dist/server.cjs`); write reports; add a recommendation file when you notice something the pack did not ask for.

## 5. What you must not do
Push, merge, deploy, create Replit workflows/deployments/agents, edit `.replit` or `replit.nix`; touch the protected core beyond the named minimum wiring (UnifiedPlaybackEngine, BroadcastTVGuide, PlayerStore, StatusIndicatorBar, ChannelManager, SchedulerEngine, PluginHost, ArchiveProvider, IPTVProvider, DiagnosticsHUD); weaken an existing test, limit or budget to make something pass (propose it and wait); run any test unguarded; read or print secrets; copy Archive descriptions, uploader e-mails or caption text into any file; claim an owner decision that was not given; start a gate without its GO.

## 6. Recommendations and extra ZIPs
If you notice a problem or improvement outside the gate, write `recommendations/R<n>_<slug>.md` (what, why, evidence, proposed change, risk). If you can fully implement and test it in isolation, also deliver it as its own drop-in ZIP `deliver/AJN_PACK_<gate>_REC<n>.zip` (same packaging rules), on a separate branch, NOT applied to the chain. The owner and Claude decide.

## 7. Known facts every gate inherits (dated 2026-10-18)
- Classic TV raw schedule is 33,520,269 bytes against a 33,554,432 cap (34,163 bytes of headroom). Do not add fields to schedule programs; any change that grows it must say so and propose lazy loading.
- All My Children manifest: 1,436 rows (817 Episodes + 619 Extras), admission floor 30 s because `test-extra-channels.ts` requires durationSeconds >= 30. The owner's rule is a 10 s floor; do not change either without a decision.
- Restricted Archive items are normal for TV news: they play as bounded clip windows (`?exact=1&start&end`, 206). Do not exclude news clip windows. Loan-gated sets (for example av-911) stay excluded.
- Media proxy: responses <= 8 MiB slices, never > 32 MiB (Cloud Run). Typecheck needs `NODE_OPTIONS=--max-old-space-size=1200` or more and can exceed 5 minutes in the foreground: run it in the background.
- The sandbox Chromium cannot decode H.264: use fake players for DOM tests and say so.
- Archive politeness: read-only, 1.5-1.8 s spacing, max 2 concurrent, no media downloads (HEAD or `Range: bytes=0-0`/bounded slices only), stop on 403/429, never retry in a loop.
