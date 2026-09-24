# Builder handoff — known issues and rules

Canonical tree: this repository, branch `fix/p1`. Nothing outside it is authoritative
(no drop-in folders, no redo archives, no ChatGPT ZIPs).

## Rules
- One pipeline: M3U / Archive → source contract (`server/sources/*`) → Program → `/api/archive/proxy` → `<video>`.
- Archive links are used exactly as given. Only exception: item-level `/download/<ID>/<ID>.mp4`.
- Restricted TV News plays as clips: `/download/<ID>/<ID>.mp4?exact=1&start=S&end=E` (282 s windows).
- No fallback/demo media. Failures surface as `sourceStatus` (`upstream_error`, `restricted`, `partial`).
- `npm ci` with the committed `package-lock.json`, Node 22.

## Status of reported issues
- `GET /api/schedule?guide=cable-tv` terminating Node: **not reproducible on this tree.**
  Verified 2026-09-23: returns 200, server stays up, with Archive unreachable (fast
  `upstream_error`). The crash report came from the historical drop-in/redo variants.
  If it recurs, capture `stderr` of `node dist/server.cjs` and the exact commit.
- Full-length TV News MP4s return 403 from Archive (expected). Covered by clip programs.
- Live verification of clip playback happens in CI (`Real Archive playback gates`).

## Verify
```
npm ci && npx tsc --noEmit && npm run build
npx tsx test-source-contracts.ts && npx tsx test-source-archive-news.ts && npx tsx test-cable-news-guide.ts
PORT=3000 NODE_ENV=production node dist/server.cjs
```
