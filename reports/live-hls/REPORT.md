# Live HLS (Pluto) restart investigation — 2026-10-25

**Result: Phase 1 complete; stop before Phase 2. Neither suspect A nor suspect B met its confirmation criteria. No playback behavior was changed.**

## Inputs and environment

- AI Studio export SHA-256: `c030952ddf815fbe34ffa3a6418d0a93dfa466a4a44ee534eef213a04b3dc62d` (215,017,216 bytes).
- Classifier overlay SHA-256: `06b39dba38fc5bf6052cab29f5faa6b281218f98df6b10e6cbff7cec487398de` (3,047 bytes).
- Applied export first, then the two-file classifier overlay, in `/tmp/ajn-live-hls-20261025-01/tree`. The source archives were not modified.
- `src/MinimalPlayer.tsx` was 64,699 bytes at the required fingerprint check.
- Node `v24.22.1`, npm `11.19.1`. This job did not specify Node 22.
- The test-only HLS event hook is guarded by `import.meta.env.DEV`. The production build passed the check that `__ajnHlsProbeEnabled` is absent; the diagnostic client build contains one occurrence.

## Baseline gate

| Command | Result |
|---|---|
| `npm ci` | PASS, exit 0; 323 packages installed. npm reported 11 high audit findings; no dependency audit remediation was in scope. |
| `npx tsc --noEmit` | PASS, exit 0. |
| `npm run build` | PASS, exit 0; Vite built 1,902 modules and the production demo guard passed. Vite printed its existing large-chunk warning. |
| `npx tsx test-archive-failure.ts` | PASS, exit 0; output: `archive failure: all passed`. |
| `npm run test:bannedvideo` | PASS, exit 0; output included `PASS [bannedvideo] snapshot, validation, air dates, AJN/RAV, 4-panel allocator (2000-step no-duplicate run)` and `PASS BANNED VIDEO tab order, /bannedvideo deep link, and #bannedvideo hash`. |

After adding the DEV-only diagnostic event hook, `npx tsc --noEmit` and `npm run build` passed again. The production bundle had no probe hook. `NODE_ENV=development npx vite build --mode development` plus the server bundle command succeeded for the diagnostic run.

After adding the probe dependency, `npm ci --ignore-scripts --registry=https://registry.npmjs.org/` passed (324 packages; 11 high audit findings). `playwright-core` is pinned to `1.64.1`; every `resolved` URL in the resulting lockfile starts with `https://registry.npmjs.org/`. Final `npx tsc --noEmit`, `npm run build`, `npx tsx test-archive-failure.ts`, `npm run test:bannedvideo`, and `node --check tools/checks/live-hls-probe.cjs` all exited 0. The build again printed only the existing large-chunk warning; the production demo guard passed.

## Probe

The probe selected the first matching live-TV entry: **Anime x HIDIVE** (`live-animexhidive-us-sd`), program entry 0, **The Demon Girl Next Door**, playlist host `jmp2.uk`.

Commands:

```sh
NODE_ENV=production PORT=3100 AJN_BOOT_WARMERS=0 node dist/server.cjs
curl --max-time 1 -fsS http://127.0.0.1:3100/api/health
LD_LIBRARY_PATH=/nix/store/24w3s75aa2lrvvxsybficn8y3zxd27kp-mesa-libgbm-25.1.0/lib \
  AJN_TEST_URL=http://localhost:3100 npm run test:live-hls
```

The app was first built with `npm run build`; a separate diagnostic client was then generated using `NODE_ENV=development npx vite build --mode development`, and the server bundle was refreshed with `npx esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs`. The final server used `NODE_ENV=production` so the app served the production server environment with the separately built diagnostic client. The health endpoint returned `{"status":"ok",...,"archive":"unknown"}` within five seconds. `AJN_BOOT_WARMERS=0` disabled boot warmers; the app’s regular health/background work remained enabled.

The final probe exited **0** and wrote `BEFORE.json` and `BEFORE.md`. It sampled state every 2 seconds through a 60-second clean period, the 25-second forced segment block, recovery, S2, and the complete 600-second S3 control.

### Results

| Scenario | Evidence | Gate result |
|---|---|---|
| S1 — forced stall | 12 Pluto/Siloh segment requests blocked for 25 s. Playback recovered 4.02 s after unblocking. Status never showed `Reconnecting…`; `media.load()` stayed at the three startup calls, with none during the block. A `networkError/levelParsingError` marked fatal occurred during the block. | **A NOT CONFIRMED.** The required status and `media.load()` evidence were absent. |
| S1 backward-time check | The initial summary had included the pre-block clean period, making `backwardJump=true` misleading. Recalculation over the forced-block/recovery samples only (using the pre-block snapshot as baseline) gives `false`. Raw samples remain in `BEFORE.json`; the corrected probe now scopes this metric to the scenario interval. | No post-block backward jump observed. |
| S2 — Start Over / previous-track | Start Over was not visible. MediaSession `previoustrack` was supported; currentTime after the action was 93.753 s, with seekable range 75.167–105.100 s. It did not move to the range start or zero. | **B NOT CONFIRMED.** |
| S3 — 10-minute control | Full 600 s completed. The probe’s time-discontinuity rule detected two backward jumps: 387.565→340.200 s at `21:11:23.575Z`, and 392.122→352.336 s at `21:12:49.847Z`. There were no `media.load()` calls after startup. The first followed `bufferStalledError` and a `seeking` event; the second followed an `aborted` HLS error and a `seeking` event. The probe counted 7 qualifying HLS error events; the retained event array contains 9 `ERROR` events total. | Record **2 unforced backward time discontinuities**. Their cause is unresolved; they do not by themselves confirm A or B. |

`BEFORE.json` contains no stream URL, caption text, or media bytes. `BEFORE.md` includes the timestamped two-second timeline and event summary.

## Probe issues and corrections

1. An earlier Vite-middleware probe was discarded: its HMR websocket reported that port 24678 was already in use. It is not used as evidence.
2. The first full production-server probe completed the playback scenarios but failed while serializing the report: `TypeError: Converting circular structure to JSON` (`loader → context → frag`). HLS.js can place an object in an error event’s `reason`. The DEV-only recorder now retains only scalar event fields and omits `reason`. The circular-fixture serialization check, typecheck, production build, and corrected full probe passed.
3. The first S1 summary’s backward-jump metric included the clean-before period. It was corrected to compare from the pre-block snapshot through the forced-block/recovery interval. The existing raw samples were sufficient to recompute this field without another live playback run. An offline assertion passed: S1 post-block backward jump `false`, S3 discontinuities `2`, A/B `NOT_CONFIRMED`.

## Stop decision and remaining verification

The job requires stopping when neither A nor B is confirmed. Therefore no Phase 2 runtime fix, `AFTER` run, recovery unit suite, or five-minute desktop/phone follow-up was run. Draft review PR: https://github.com/banamine/AJN-Precision-Engineering/pull/127 (`fix/live-hls-recovery` → `base/aistudio-2026-10-25b`). It is evidence-only and unmerged; there was no deployment or main-branch change.

The PR's only GitHub check, `AJN integrity guard`, failed (run `40235953357`, job `121297455389`). The annotation reported exit code 1. Re-running the guard against this AI Studio export tree produced the exact reason: `missing required file: Dockerfile`. The export/base does not contain Dockerfile, while its inherited integrity manifest requires it. I did not add Dockerfile or modify the base because this gate is evidence-only and the ZIP is specifically for the AI Studio export. This CI blocker needs an owner decision; it is not evidence that either HLS suspect is confirmed.

Not verified: why S3 has two time discontinuities; whether the same behavior occurs on another Pluto channel or device; the five-minute phone and desktop runs. Start Over was not available in this channel’s UI.

## Build outline for owner review

No runtime patch is proposed from this evidence. For a follow-up measurement, first correlate each S3 backward jump with the app’s retry/status transitions, HLS instance lifecycle, seekable-range movement, and the playlist’s discontinuity sequence. If a reproduction proves A, change only the HLS-owned recovery path to resume at the live edge via hls.js and reserve instance rebuild for a failed subsequent watchdog window; keep native-HLS behavior and the existing teardown order. If a reproduction proves B, target the live edge for live-HLS Start Over/previous-track while leaving VOD and Archive behavior unchanged. Add the corresponding decision and live-edge unit tests, then rerun the real probe and five-minute desktop/phone checks. Do not implement either change unless its trigger is confirmed.
