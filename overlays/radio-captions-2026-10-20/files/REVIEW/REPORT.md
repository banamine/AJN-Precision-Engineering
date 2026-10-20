Input SHA-256 — owner export: `002749be159fb37413495bdfd0273475b8dfdaf21ca9a4a9ee2d154577249353`; all-in-one overlay: `1f4243577e5f160c5f96688cc0067ad1f9ae57fee277ce5b7dffe98b88fab047`; job instructions: `2248922fd1be150a75a4105323a6b1f6a5db0a10820be0e0d3039086d86ecbb8`; AudioSlim pack: not attached, no SHA.

# Radio Captions Strip — Review

**Verdict: PASS for the requested offline implementation and browser checks.** No Archive request was made. Work was performed in a temporary copy, recorded branch name `feat/radio-captions-strip`; no commit, push, merge, or deploy.

## Base and guardrails

- Applied the owner export first, then `AJN_ALL_IN_ONE_DROPIN_2026-10-20.zip`. Its `SHA256SUMS.txt` verified every listed overlay member. No optional `AJN_PACK_AUDIOSLIM_2026-10-20.zip` was attached, so none was applied.
- The ~56 TS2307 errors under `full-files-for-export-baseline/` were ignored as instructed. Focused typecheck used a temporary config for the changed files and their imports.
- `server/audioAsr.ts`, `server/audioAsrRoutes.ts`, `server/captions/*`, the news caption parser/track helpers, `test-captions.ts`, and `test-captions-routes.ts` were not edited. The G18B API labels and `source: "asr"` remain as shipped.
- Radio display label is exactly `RADIO CAPTIONS VIA INTERNET ARCHIVE · MACHINE-GENERATED (ASR, MAY CONTAIN ERRORS)`. The existing `KIND_LEAD_SECONDS.asr` remains `0`.
- All API cue responses and transcript-like text in this job were synthetic; the visible ASR/provenance label is the required fixed label. Browser network interception blocked external hosts; Archive physical requests: **0**.
- Radio activates only for identifiers matching `^The_Alex_Jones_Radio_Show_\d{8}_\d{6}$`; invalid IDs are off with no request.

## E1 — shared slice logic, numeric examples

The synthetic in-memory cues use the supplied G18B anchor counts and first/last cue times: slice 0 has 17 cues (`0.15–58.20 s`); slice 60 has 19 cues (`60.12–118.43 s`). Intermediate cue times are evenly spaced test data and all cue text is synthetic fixture IDs, not transcript text.

| Playhead | `wantedSlices` | Current synthetic cue @ absolute start | `before` count |
|---:|---|---|---:|
| 10.0 s | `[0]` | `SYNTHETIC_FIXTURE_T0_02` @ 7.406 s | 2 |
| 58.9 s | `[0, 60]` | `SYNTHETIC_FIXTURE_T0_16` @ 58.200 s | 4 |
| 60.2 s | `[60]` | `SYNTHETIC_FIXTURE_T60_00` @ 60.120 s | 4 |
| 118.0 s | `[60, 120]` | `SYNTHETIC_FIXTURE_T60_17` @ 115.191 s | 4 |

The 60.2 s history includes four preceding cues from the retained slice 0, matching `SliceStore`/`visibleLines` behavior.

## E2 — no double offset

At playhead `62.0 s`, current cue start is `60.12 s`. Adding the slice start a second time would yield `120.12 s`, which is after the playhead and is rejected by the test. The hook uses the audio element’s program-relative `currentTime`; the server’s absolute cue starts are not shifted again.

## E3 — hook and request-budget behavior

Headless Chromium with a fake audio playhead: one plan request; slice starts `[0, 60, 7080]`; pausing at `95 s` added no request; seeking to `7080 s` requested that aligned slice. Total was `4/20` requests in the minute and `4/100` for the test session. Failed slice starts are attempted once.

## E4 — failure and validation states

- Plan `404` → “No captions for this program.” (`none`).
- Slice `503` → `error`, preserving the server message: `synthetic slice unavailable`.
- Slice `429`, `Retry-After: 7` → paused state showing the seven-second countdown; one slice attempt, no automatic retry.
- Invalid radio identifier → no panel and `0` requests.

## E5 — browser, dimensions, and screenshots

The radio strip appeared without a click and advanced from synthetic cue `T0_00` to `T0_01` as the stubbed 10-second audio playhead moved to `4.2 s`. The full required label was visible in both captures. `max-h-28` remains on the grey history region.

| Chromium viewport | Radio strip height | News strip height | Result |
|---|---:|---:|---|
| 390 × 844 | 69.41 px | 69.70 px | PASS |
| 1440 × 900 | 53.70 px | 69.70 px | PASS |

`REVIEW/screens/` contains:

- `radio-caption-390.png` — phone, synthetic audio playing, full radio label and changing current cue.
- `radio-caption-1440.png` — desktop, same automatic radio strip.
- `news-caption-unchanged-1440.png` — News strip alone, with its original “BROADCAST CLOSED CAPTIONS VIA INTERNET ARCHIVE” label and synthetic cue.

The browser run blocked `36` external-host attempts before network access; all API responses and audio were served from local stubs. No Archive data or text was fetched.

## E6 — News tests and output preservation

Active News caption tests found and run:

- `test-captions.ts`: **20 checks passed**; baseline and final stdout SHA-256 are both `0b0b2b4961eb45669900128c9be1afc91f9c4da9d5a3e2456a2f400cd55b0019`.
- `test-captions-routes.ts`: **5 HTTP checks, 2 fake-upstream calls**; baseline and final stdout SHA-256 are both `61f5a6154fd4de67a6e3eb060b98022dd33c2bd530a2acd17da9e98d360dc929`.
- The planning DOM string from `CaptionPanel` matches the pre-change render byte-for-byte (SHA-256 `3c8569c19e9efd082b916d2b55e15f34827e93646b8293388f7f5353dd41fd30`). `test-caption-strip-output.tsx` checks the original News state markup/test IDs against exact expected HTML.

### Diff-style changed-file list

```text
M  src/components/PlayerView.tsx
D  src/components/AudioAsrTranscriptPanel.tsx
M  src/news/captions/CaptionPanel.tsx
A  src/news/captions/CaptionStrip.tsx
A  src/news/captions/RadioCaptionPanel.tsx
M  src/news/captions/useCaptionTrack.ts
A  src/news/captions/useRadioCaptionTrack.ts
A  test-caption-strip-output.tsx
A  test-radio-caption-browser-entry.tsx
A  test-radio-caption-browser.html
A  test-radio-caption-browser.mjs
A  test-radio-caption-fixtures.ts
A  test-radio-caption-track.ts
```

## Verification and request ledger

- Node `v22.22.0`.
- `NODE_OPTIONS=--max-old-space-size=1400 ./node_modules/.bin/tsc -p tsconfig.radio-captions.temp.json --noEmit` — PASS, no output.
- `tsx test-radio-caption-track.ts` — PASS, numeric examples above.
- `tsx test-caption-strip-output.tsx` — PASS, all states/test IDs and News baseline markup.
- `tsx test-captions.ts` and `tsx test-captions-routes.ts` — PASS, byte-identical baseline outputs.
- `PUPPETEER_EXECUTABLE_PATH=/repl/tools/bin/chromium node --import tsx test-radio-caption-browser.mjs` — PASS, E3–E5, all screenshot checks.
- Full production build was not run; the scoped Vite dev/browser run and focused typecheck cover the changed modules. No Archive requests were made; the browser interceptor blocked external hosts, and API tests used local/fake responses only.

The timing of ASR cue starts relative to verified spoken word boundaries was **not measured**: the available fixtures contain no ground-truth word alignment. Therefore no ASR lead was inferred.

## NEXT BUILD OUTLINE

1. Keep the server-side ASR API and source fields unchanged.
2. Keep radio ASR visibly distinct from broadcaster captions.
3. If wording is changed later, update only `RADIO_CAPTION_DISPLAY_LABEL`; owner decision required before using “BROADCAST CLOSED CAPTIONS”.
4. Keep the radio strip on the shared caption state, slice store, and request-budget implementation.
5. I will NOT re-test: Phase 1/2, G17, G18B channel/M4A, audio-guide size, proxy 206, visualizer, or the TV News caption behavior beyond the named regression tests.
