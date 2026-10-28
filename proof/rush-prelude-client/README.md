# Rush Morning Update client proof

## Build and tests (Node 22)
- `npm run typecheck`: PASS (exit 0)
- `npm run build`: PASS (exit 0; Vite reported the existing large-chunk advisory)
- `test-rush-next-client.ts`: PASS
- `test-rush-next.ts`: PASS
- `test-rush-retry.ts`: PASS
- `test-rush.ts`: PASS
- `npm test`: PASS (Puppeteer, EPG lifecycle, Archive music title/mode)

## Production API metadata
- `GET /api/rush/episode/2005-12-08`: HTTP 200. The first item ID contains `morning-update`; its track is `kind: video`, `.ia.mp4`, 94.47 seconds. The following full-show item has three MP3 tracks. The first item does not have an episode-level `role` in the live response, so the client recognizes the legacy ID.
- `GET /api/rush/episode/2016-12-29`: HTTP 200. Morning Update is `unavailable: true`; the full-show item has three MP3 tracks.

## Live media playback
- Morning Update MP4 played in Chromium: `currentTime 1.06s`, `readyState 4`, no media error; the local-date seen marker was set by native `playing`.
- The same video's native `ended` path selected Hour 1; its audio reached `currentTime 0.62s` with no media error.
- All six physical media responses in that run were HTTP 206 and at most 8 MiB. Start gaps were 3747, 2806, 1646, 2625, and 3216 ms (minimum 1646 ms).
- A later separate Hour 1 proxy check returned HTTP 503 twice. Further Rush media requests were stopped. The reload, unavailable, skip, and test-report screenshots are UI-state checks using the captured production API responses; those captures block media requests. No production media is substituted or presented as live in those screenshots.
