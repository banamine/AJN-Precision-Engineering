# Task 8 Handoff

[read from code: b4d50af] Scope: this handoff applies only to the AJN Precision Engineering repository and the `fix/p1` work leading to PR #68.  
[read from code: b4d50af] This document is documentation-only; it does not authorize code, manifest, workflow, or `tsconfig.json` changes.

## CI Gate

[CI-verified: run #478 / 36688054091, merge ref bb2db68, PR head b4d50af] Task 7 is green across the required three jobs: Lint; Build and pure regression suite; Server, playback, API, and visual regression.  
[CI-verified: run #478 / job 109798392198] Lint completed successfully, including the TypeScript check and Audio ownership invariant.  
[CI-verified: run #478 / job 109798575219] The production build and the Build/pure-regression steps completed successfully, including the Canonical playback slice contract.  
[CI-verified: run #478 / job 109799165696] The integration job completed successfully, including playback, API, accessibility, audio/video, browser journey, Real Archive playback, and visual regression steps.

## Canonical Playback Slice

[CI-verified: run #478 / job 109798575219] The Canonical playback slice contract completed successfully in the Build and pure regression suite.  
[read from code: b4d50af] `src/utils/archivePlayback.ts` requires a canonical `/download/` Archive path before constructing the same-origin `/api/archive/proxy?path=` URL.  
[read from code: b4d50af] `CLOUD_RUN_DEPLOYMENT_CONTRACT.md` states that the media proxy serves bounded 206 slices of at most 8 MiB and must never return one response larger than 32 MiB.

## Deployment Contract

[read from code: b4d50af, CLOUD_RUN_DEPLOYMENT_CONTRACT.md] Production deployment is one Cloud Run service containing the Express API and built SPA in one process.  
[read from code: b4d50af, CLOUD_RUN_DEPLOYMENT_CONTRACT.md] The repository deployment contract uses Node 22 and npm; the Docker image uses `npm ci --ignore-scripts --no-audit --no-fund`, while `.github/workflows/ajn-deploy.yml` uses plain `npm ci --no-audit --no-fund` so the production playback gate has Chrome available.  
[read from code: b4d50af, CLOUD_RUN_DEPLOYMENT_CONTRACT.md] Deployment uses `gcloud run deploy --source .`; `ajn-production-dist` is a CI artifact for integration checks and is not the deployment artifact.  
[read from code: b4d50af, CLOUD_RUN_DEPLOYMENT_CONTRACT.md] The contract requires CI gates to pass on `main` before deployment.

## Open Archive Availability

[CI-verified: run #478 / Real Archive playback logs] The CI validator reported: `Probing 12 manifest candidates... 12/12 passed`.  
[CI-verified: run #478 / Real Archive playback logs] Earlier CI runs recorded 12/12 and 12/14 candidate results; the 12/14 run identified `BorderPatrol1937` and `HolidayInn1942Colorized` as real-playback failures.  
[read from code: b4d50af, CLOUD_RUN_DEPLOYMENT_CONTRACT.md] Manifest entries that fail real playback remain an open handoff item; candidate count varies by run.  
[not verified: user-reported repeated CI log review] Seven CNNW clips were unavailable at Archive storage with HTTP 403 in 4 of 4 runs reviewed by the user; the test records this as an external availability condition, not a playback pass.  
[not verified: user-reported repeated CI log review] The CNN 403 condition remains an open item and is not treated as an application playback failure or as evidence of successful playback.

## Other observations

[CI-verified: run 36690773110] `test.js` prints `Fox News Source URL: undefined` without asserting it.
[CI-verified: run 36690773110] The web manifest request is served as HTML (`Manifest: Line: 1, column: 1, Syntax error`) and `/favicon.ico` returns HTTP 404.
[CI-verified: run 36690773110] The server warm-up resolver and the test resolver report different kept/dropped sets in the same run, so validator population is not stable.
[CI-verified: run 36690773110] Live health was 1263/1515.

## CI Playback Coverage

[CI-verified: run #478 / Real Archive playback logs] The CI playback gate probes CNN content.  
[not verified] FOX, MSNBC, BBC, and NTD do not have equivalent CI playback coverage in the current gate.  
[not verified] Absence of CI coverage is not evidence that those sources fail or pass real playback; they require live testing.

## Movie Validator

[CI-verified: run #478 / validator logs] The corrected current validator result is 12/12: `Probing 12 manifest candidates... 12/12 passed`.  
[CI-verified: prior CI evidence reviewed by user] Earlier runs produced 12/12 and 12/14 results.  
[CI-verified: prior CI evidence reviewed by user] The 12/14 run's two failures were `BorderPatrol1937` and `HolidayInn1942Colorized`.  
[read from code: b4d50af] Those identifiers remain in `src/data/moviesClassicsManifest.json`; this handoff does not edit that manifest.
[read from code: b4d50af] 12/14 and 12/12 are different validator populations: before the current 12-candidate probe, the resolver dropped `BorderPatrol1937` and `HolidayInn1942Colorized`.

## Known Gaps

[read from code: b4d50af] M3U ingestion yields `Channel` + `ChannelSource` but no `Program`/`MediaAsset`.
[read from code: b4d50af] `classicM3uContract` is used only by `test-source-contracts.ts`, not production.
[read from code: b4d50af] No `PlaybackPlan` exists.
[read from code: b4d50af] The two M3U parsers (`guideRegistry.parseM3u` and `classicM3uContract`) quote differently.

## Known Stale Manifest Paths

[read from code: b4d50af, CLOUD_RUN_DEPLOYMENT_CONTRACT.md] `V1_FILE_SHA256.txt` still lists the old `test-429.ts` path.  
[read from code: b4d50af, CLOUD_RUN_DEPLOYMENT_CONTRACT.md] `AJN_FULL_REBUILD_MANIFEST.json` still lists the old `test-429.ts` path.  
[read from code: b4d50af, CLOUD_RUN_DEPLOYMENT_CONTRACT.md] These remain open handoff items and are not corrected by Task 8.

## Commit Range

| Task | Commit range | Status |
|---|---|---|
| Task 5 | `cea1207` | [read from code: prior task record] Accepted task range. |
| Task 6 | `a6a7deb` .. `068a0d8` | [read from code: prior task record] Accepted task range. |
| Task 7 | `f4361a4` .. `b4d50af` | [CI-verified: run #478 / 36688054091] Accepted after the full three-job CI gate completed green. |

## User Live-Test Checklist

[not verified: requires user live testing] The following checks remain outside the CI evidence and must be exercised before merge:

1. [not verified] Search results: confirm normal results render and can be selected for playback.
2. [not verified] Search empty state: confirm an empty result is represented explicitly rather than as fabricated media.
3. [not verified] Search error state: confirm upstream/search failure is surfaced explicitly.
4. [not verified] Cable guide: confirm the guide loads, displays current/upcoming entries, and selection reaches the expected playback path.
5. [not verified] Audible playback: confirm a selected video produces audible media through the intended audio route.
6. [not verified] Range probe: send a `Range: bytes=0-` request to `/api/archive/proxy` and confirm HTTP `206` with a response slice no larger than 8 MiB. Nothing from `fix/p1` is deployed; run this against a local build of the branch. Merging PR #68 auto-deploys.
7. [not verified] `/api/health`: confirm the deployed service returns its expected health response. Nothing from `fix/p1` is deployed; run this against a local build of the branch. Merging PR #68 auto-deploys.
8. [not verified] FOX playback: test a real current FOX news item.
9. [not verified] MSNBC playback: test a real current MSNBC news item.
10. [not verified] BBC playback: test a real current BBC news item.
11. [not verified] NTD playback: test a real current NTD news item.

## Gate Status

[CI-verified: run #478 / 36688054091] Task 7 is complete and green.  
[read from code: b4d50af] Task 8 contains documentation only.  
[not verified: user live testing] The live-test checklist remains outstanding.  
[not verified: merge decision] No merge is authorized by this document.  
[not verified: deployment] No deployment is authorized by this document.  
[read from code: b4d50af] The open Archive availability, CI coverage, validator-history, stale-path, and Known Gaps items remain open.
[read from code: b4d50af] Known Gaps remain open: M3U ingestion yields Channel + ChannelSource but no Program/MediaAsset; classicM3uContract is test-only; no PlaybackPlan exists; the two M3U parsers quote differently.
[read from code: b4d50af] Product-level Known Gap: Archive direct-MP4 is not a viable news playback source; a different source is needed (see the queued Free-TV/iptv-org review).

