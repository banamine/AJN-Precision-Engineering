# CAPTIONS BRIEF (read with 00_START_HERE.md for any captions / news-text job)

## What already exists (merged on main @ 68bd8d5, PR #99)
- Server: `server/captions/{captionCore,captionService,routes}.ts`. Routes `GET /api/captions/plan?id=` (picks align > cc5 > asr > none from the item's PUBLIC metadata file list) and `GET /api/captions/slice?id=&src=&start=` (one 60 s slice, times returned as programme seconds). Restricted to networks in `NEWS_NETWORKS` (`server/sources/archiveNews.ts`).
- Client: `src/news/captions/{captionTrack,useCaptionTrack,CaptionPanel}.ts(x)`, mounted in `src/components/PlayerView.tsx`. `CaptionPanel` is the on-screen caption display. It reads the playhead from the `<video>` element, position = clipStart + currentTime, fetches the current slice and the next one after 30 s, memory only.
- Tests: `test-captions.ts` (20 checks), `test-captions-routes.ts` (5 checks). There is no `npm run test:captions` script.
- Proven on the owner's PC (2026-10-17): Fox (align), Al Jazeera (asr), France 24 and RT Documentary (asr): displayed line == cue at playhead. Non-news channels request nothing.

## Safety rules (do not weaken)
- Only metadata (public) + time-sliced `?t=S/E` requests to caption files that Archive's own player requests. NEVER a full-file request to a private caption file.
- >= 1.8 s between upstream starts, process-wide. 429 -> exactly one request, then cooldown (Retry-After, cap 120 s, default 30 s), no retry. 403/404/5xx are explicit errors, no retry, no fallback.
- Caption TEXT is never stored, cached or logged server-side, and never copied into reports, ledgers, fixtures or screenshots. Reports carry numbers only: status, bytes, cue count, first-cue start.
- Empty body is NOT proof of "no captions" (a slice may hold no speech). Classify per item over 3 slices.

## Known facts (dated observations, re-verify)
- Subtitle file kinds: `.align.srt` and `.cc5.srt` = broadcast closed captions (US networks; cc5 trails align by about 3-5 s); `.asr.srt` / `.asr.vtt` / `.asr.txt` = Internet Archive machine transcript (label differently in the UI).
- Time bases measured: asr relative to slice (first cue ~0.85 s in the slice at 840), align relative. cc5 assumed relative, not exercised live.
- Coverage is PER ITEM, not per network: CTV, France 24 and TRT World had no subtitle file on some items and did on others.
- Newest items are 2-5 h behind real time (12-20 h for CNBC and Fox Business); use items >= 12 h old for tests.
- Open findings: no on/off control in CaptionPanel; no WebVTT parser anywhere (SRT only); first Fox cue held ~14 s on one item (real spacing or time-base error, unresolved).
- Archive reuse terms are unclear; the owner accepted the risk. Flag it once in the report; do not block on it.
- The cloud sandbox Chromium cannot decode H.264: real playback is NOT VERIFIED in Replit. Use a fake player for DOM tests and say so.

## Provided tool
`tools/captions-census.mjs` (read-only, no dependencies, self-test: `node tools/captions-census.mjs --selftest`). Usage: `node tools/captions-census.mjs --out <dir> FOXNEWSW CNNW ...`. Writes `ledger.ndjson` and `census.json`. Do not modify its safety limits (1.8 s gap, 80 requests, stop on 403/429).
