# AJN Final Candidate Baseline — 2026-09-07

## Purpose

This package is a clean drop-in candidate assembled from the current AJN runtime snapshot plus the verified Replit findings. It is intentionally **not** a claim of production certification.

## Decisions carried forward

- Preserve the existing authoritative player and single `<video>` path.
- Preserve the existing Archive proxy/range implementation.
- Preserve the existing TV Guide/EPG architecture.
- Preserve deterministic program selection and stable playback identity fields.
- Keep Archive TV News search in the Search destination; do not route search results into a fake `Cinema Vault` channel.
- Add a small persisted **My News** queue in Search (maximum 6 items) without introducing a second scheduler/player.
- Preserve real Archive TV News bounded playback behavior already demonstrated in the Google build.
- Remove the unrelated automatic `SciFi_Horror` background channel build from startup because it was not part of the requested real TV/news baseline.

## Replit findings incorporated as engineering constraints

1. HLS teardown must remain deterministic: `stopLoad → detachMedia → destroy → clear references` when an HLS session exists.
2. Deterministic switching tests are valuable but do not prove long-session memory stability.
3. Browser tests must use real Chromium/video where the claim is browser playback.
4. Real media inventory must distinguish REAL, TEST, DEMO/PLACEHOLDER, and UNKNOWN.
5. Failed real sources must remain failures; never replace them silently with demo media.
6. Archive metadata/actual derivative information is authoritative; do not assume every identifier has `{identifier}.mp4`.
7. The Replit experimental PlaybackController remains **experimental/not adopted** until it is proven against real hls.js/browser behavior.
8. Archive TV News full-file/private derivative failures must not be hidden by speculative resolver changes.

## Known limitations that remain explicit

- The current Search implementation retains the bounded TV News path used by the working Google baseline. This is a compatibility decision, not proof that every Archive TV News identifier has a valid public derivative.
- The existing MinimalPlayer contains TV News segment assumptions; these remain untouched in this candidate to avoid regressing the already-working Google playback path.
- Full browser playback verification requires deployment and foreground Chromium evidence; this package does not fabricate that evidence.
- The current package does not import the unverified Replit PlaybackController.

## Acceptance sequence

### Phase 1 — Build inspection

```bash
npm install
npm run lint
npm run build
git diff --check
```

### Phase 2 — Google sandbox

Verify Search → Watch Broadcast for one known working Archive TV News result. Capture the actual request, HTTP status, Content-Type/Range, readyState, networkState, `video.error`, and currentTime advancement.

### Phase 3 — Regression

- Search remains Search.
- Watch Broadcast opens the existing Player.
- Add to My News persists after refresh.
- No automatic Cinema Vault channel is created.
- TV Guide remains functional.
- Exactly one video element is present in the active player path.

## Do not do

- Do not pull unrelated GitHub branches into this candidate.
- Do not replace `server.ts` wholesale.
- Do not add another player or scheduler.
- Do not add demo streams to make tests appear successful.
- Do not treat `/api/health` or telemetry alone as playback proof.
