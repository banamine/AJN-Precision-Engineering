# AJN Replit queue (index) - updated 2026-10-20

Purpose: one place where the build team (Replit) can fetch every queued job and its helper files. NOTHING here is applied to main. Do not merge this branch. Do not push to GitHub from Replit; deliver ZIPs to the owner.

## BASE (updated 2026-10-20, overrides the base line in rule 1 below)
BASE = owner export ZIP + all-in-one overlay (branch overlay/p2-plus-captions-2026-10-20, overlays/all-in-one-2026-10-20/, sha256 1f424357...fab047) + RADIOCAPTIONS pack (this branch, overlays/radio-captions-2026-10-20/, sha256 f1a2d3c8...b1cfb, delete AudioAsrTranscriptPanel.tsx). Fetch both from GitHub yourself; the owner only attaches the export. Report the SHA-256 of all three.

## Base rule (overrides every older job file)
The older job files (queue/03..09, runbook/) were written against a branch chain (feat/library-allmychildren -> feat/buffer-gauge-readahead -> ...). IGNORE the branch chain. Source of truth is Google AI Studio (Builder), not GitHub main. For every job:
1. BASE = the newest owner export ZIP attached by the owner (ajn-precision-engineering.zip) + overlay https://raw.githubusercontent.com/banamine/AJN-Precision-Engineering/overlay/p2-plus-captions-2026-10-20/overlays/AJN_DROPIN_P2_PLUS_CAPTIONS_2026-10-19.zip (SHA-256 f9121711f49d684eb8d8354d95584c2471a8248f5fc8676fa172bafbbfccd70c) extracted on top. Phase 1 and Phase 2 are already in; do not redo them.
2. Work in a temp copy. Never edit uploaded ZIPs. No push, no merge, no deploy. Deliver a ZIP of only the new/changed files with UPLOAD_ORDER.txt, ROLLBACK.txt and sha256s.
3. Do not change: ASR/caption behaviour, the visualizer, the proxy (server/proxyRange.ts, archiveFetch), read-ahead, HLS, watchdogs, the Classic TV schedule/manifest. Ignore the ~56 TS2307 errors inside full-files-for-export-baseline/.
4. First report line = SHA-256 of the export and the overlay. If the overlay hash differs: STOP.
5. Follow LEAN MODE V3 (below) in every job.

## LEAN MODE V3
- Do NOT re-test what is known to work: Phase 1 (read-ahead off by default, buffer gauge), Phase 2 (AMC rotation, Library 1176 raw / 620 grouped), bounded 206 slices <= 8 MiB through /api/archive/proxy, the visualizer, existing caption code, the untouched build.
- Test ONLY what you just built: unit tests for new files + ONE worked example per feature showing the real link, the real file path and the real math (slices = ceil(total / 8,388,608); no slice > 8 MiB; last ends at total-1).
- Include the offline Cloud Run smoke test pattern (production bundle, PORT from env, NODE_ENV=production, NET_GUARD=block, /api/health, truthful JSON errors, isUrlSafe refusal, < 32 MiB, clean SIGTERM) whenever you add a server route.
- Archive: use only the working public route (collection_details page, page_target=audio, hits_per_page=0) and /metadata. Spacing >= 1.8 s with the fixed G1B-FU helper (sha256 399f70b8...). Stop on 403/429/Retry-After or two 5xx in a row. Count redirect hops. Keep numbers only: no titles/descriptions/transcripts in outputs.
- Every report ends with NEXT BUILD OUTLINE (<= 15 lines: what you propose next, files, tests, and "I will NOT re-test: ..."). The owner accepts or corrects it before the next run.
- Mark anything unproven NOT VERIFIED with the reason. No Math.random, no fake telemetry, no silent fallbacks, no `any`.

## Queue (run in this order; the owner sends "GO <job>" each time)
| # | File | What | Status | Needs |
|---|---|---|---|---|
| 1 | queue/01_NOW_GO_G17BUILD_G18PROBE_LEAN.txt | Build G17 Classic Radio Theatre + G18 INFOWARS Archive RADIO probe/plan (no code for G18) | RUNNING / next | export + overlay |
| 2 | queue/02_G18_PART2_background_infowars_archive_radio.txt | G18 Part 2: build the "INFOWARS Archive RADIO" channel under Talk Radio (radio_asr) | WAITING | owner accepts job 1's NEXT BUILD OUTLINE ("GO G18 PART 2") |
| 3 | queue/03_J5_G6_G7_classic_dedupe_live_alt.md | G6 Classic duplicates, G7 Live/VOD two-path | QUEUED | G6 first; owner GO per gate |
| 4 | queue/04_J6_G8_G9_captions_build_cloud.md | G8 captions for eligible networks + WebVTT, G9 cloud check | QUEUED | owner's network list; ASR behaviour stays as is |
| 5 | queue/05_J7_G10_G11_coverage_fix_super_search.md + 05b_G10_ADDENDUM_DEFGP_TAGS.txt | G10 coverage test + gap fixes (+ tag filters, def_gp ingest, documentaries rotation), G11 super-search design (no code) | QUEUED | G7 reviewed; owner-approved exclusion rules |
| 6 | queue/06_J3_G3_song_index_phase1.md | G3 radio song index phase 1 (investigation, 60-minute capture) | QUEUED, run when owner is away | none |
| 7 | queue/07_GO_G15_G16_ASR_PROBES.txt | G15/G16 ASR probes | QUEUED | owner inputs |
| 8 | queue/08_G12_G14_radio_live_link_audio_view_PLAN.md | G12-G14 radio live link + audio view (spec only; no GO prompt yet) | PLAN | owner inputs; Claude writes the GO prompt |
| 9 | queue/09_GR2_GR3_GR4_recommendations.md | Optional: headroom, moov probe, guarded test runner | OPTIONAL | owner GO |

Deferred / on hold: diagnostics-canvas RAF loop cleanup (AudioBridgeStatus), spectrogram track-art fallback (Archive terms unchecked), optional Classic Radio Theatre 24/7 channel, `.afpk` scrubber (not recommended).
Finished and reviewed (reference only, do not rerun): done/ folder; G0, G1/G1B, G2/G2B/G2C, GT, G4, G5/G5B, Phase 1, Phase 2, GV, G17 probe.

## How the owner starts a job
Paste one line to Replit: "Read replit-queue/README.md from the repo branch replit/queue-2026-10-20 (raw URL base https://raw.githubusercontent.com/banamine/AJN-Precision-Engineering/replit/queue-2026-10-20/replit-queue/), then run job <N> only." Or download the whole folder as replit-queue.zip next to this README.

## Status 2026-10-20 (Claude)
- DONE + reviewed: G17 build (PASS), G18 probe, G18B (ACCEPT, live check pending). Combined drop-in: branch overlay/p2-plus-captions-2026-10-20, overlays/all-in-one-2026-10-20/.
- RULE: every Replit job must end with ONE combined drop-in ZIP (complete files at repo paths, UPLOAD_ORDER, ROLLBACK), attached as a file.
- Last queued job: queue/10_LAST_GO_ONLINE_VIEWERS_LEAN.txt (run only on owner GO).
- 2026-10-20: live check passed (P2, G17, G18B). NEXT = queue/01_NOW_GO_G6_CT_G7MEASURE_LEAN.txt (G6 dedupe + content-type fix + G7 measure only). Old G6/G7 brief kept under reference/.
- 2026-10-20: audio guide payload (19.45 MB raw with tz; limit rule 8 MiB advisory) must be fixed FIRST -> queue/01_NOW_GO_AUDIO_GUIDE_SLIM_LEAN.txt; G6 job is now 02_NEXT.
- 2026-10-20 QUEUE ORDER: 01 AUDIO_GUIDE_SLIM -> 02 RADIO_CAPTIONS (INFOWARS transcript as live news-style caption strip) -> 03 G6+CT-fix+G7 measure -> 04 G8/G9 -> 05 G10/G11 (+05b) -> 06 G3 -> 07 G15/G16 -> 08 G12-G14 plan -> 09 GR2-4 -> 10 ONLINE_VIEWERS (last).
- 2026-10-20: added 03b CAPTIONS_DAILY_CSV (daily caption CSV archive, 50 MB cap). HOLD until owner confirms D1-D4 (policy change on storing caption text, private repo, network list, radio meaning). Runs after 03 G6.
- 2026-10-20 FINAL QUEUE ORDER (files renumbered): 01 AUDIO_GUIDE_SLIM -> 02 RADIO_CAPTIONS -> 03 G6+CT+G7 measure -> 04 CAPTIONS_DAILY_CSV (owner decisions confirmed: store text yes; PUBLIC repo orphan data branch; 5 networks; radio = what the app played) -> 05 G8/G9 -> 06 G10/G11 (+06b) -> 07 G3 -> 08 G15/G16 -> 09 G12-G14 plan -> 10 GR2-4 -> 11 ONLINE_VIEWERS (last).

- 2026-10-20 (Claude): RADIOCAPTIONS reviewed ACCEPT and published as overlays/radio-captions-2026-10-20/. Queue job 02 is DONE (moved to done/). Remaining order: 01 AUDIO_GUIDE_SLIM (not yet returned; run first, base includes radio captions) -> 03 G6+CT+G7 measure -> 04 CAPTIONS_DAILY_CSV -> 05.. as listed. Owner does live testing on Builder and reports issues.
