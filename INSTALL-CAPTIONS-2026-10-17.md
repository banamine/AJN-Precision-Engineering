# INSTALL: TV News captions in the channel player (2026-10-17)

Scope: Archive TV News channels only (the networks listed in `NEWS_NETWORKS`, `server/sources/archiveNews.ts`).
Every other channel, radio, podcast, classic TV, Rumble and live stream is untouched: the panel renders nothing for them and they make zero caption requests.

Built against the Oct 15 `ajn-source-for-replit-lean.zip`. Apply to the version Builder holds and tell me if a line does not match.

## What it does
Click a news channel -> it plays exactly as now. Under the video a panel shows what is being said, one 60 s caption slice at a time, in memory only.
Caption source per programme (from the item's public file list): `align` > `cc5` > `asr` > none.
- `align` / `cc5`: "Broadcast closed captions via Internet Archive"
- `asr`: "Automatic speech recognition by Internet Archive, not broadcaster captions" (machine transcript, may contain errors)
- none: "No captions for this program."  (CTV, France 24 and TRT World had no caption file on the items sampled)

Requests: only the Archive player's own routes, `https://archive.org/metadata/<ID>` once per programme, and `.../download/<ID>/<ID>.<align|cc5|asr>.srt?t=S/S+60`. Never a full-file request. No cookies. Spaced >= 1.8 s. On 429 it stops and shows "Captions paused" (honours Retry-After, cooldown default 30 s, max 120 s). 403/404/5xx show an explicit error; nothing is retried in a loop and nothing falls back to other media.

## Step 1: add 8 NEW files (copy from the zip, same paths)
```
server/captions/captionCore.ts
server/captions/captionService.ts
server/captions/routes.ts
src/news/captions/captionTrack.ts
src/news/captions/useCaptionTrack.ts
src/news/captions/CaptionPanel.tsx
test-captions.ts
test-captions-routes.ts
```

## Step 2: edit `server.ts` (2 lines)
After the line `import { registerFolderArtRoute } from './server/folderArt.js';` add:
```ts
import { registerCaptionRoutes } from './server/captions/routes.js';
```
After the line `registerFolderArtRoute(app);` add:
```ts
registerCaptionRoutes(app);
```
(It must stay above the catch-all that serves index.html, as `registerFolderArtRoute(app)` already is.)

## Step 3: edit `src/components/PlayerView.tsx` (4 edits)
a) After `import { FullShowStatus } from "./FullShowStatus";` add:
```tsx
import { CaptionPanel } from "../news/captions/CaptionPanel";
```
b) After `  const failuresRef = useRef(0);` (first line of `PlayerView`) add:
```tsx
  const playerWrapRef = useRef<HTMLDivElement | null>(null); // lets the caption panel find the player's <video>
```
c) Replace
```tsx
      <Fragment key={retryNonce}>
      <MinimalPlayer
```
with
```tsx
      <div ref={playerWrapRef}>
      <Fragment key={retryNonce}>
      <MinimalPlayer
```
d) Replace
```tsx
      </Fragment>
      <AvSyncControls
```
with
```tsx
      </Fragment>
      </div>
      <CaptionPanel nowPlaying={nowPlaying} getVideo={() => playerWrapRef.current?.querySelector("video") ?? null} />
      <AvSyncControls
```
Do not change `MinimalPlayer.tsx`, the engine, the guide, the proxy, or `archiveNews.ts`.

## Step 4 (optional): test script
In `package.json` "scripts" add: `"test:captions": "tsx test-captions.ts && tsx test-captions-routes.ts"`

## Verify (you run these; nothing here needs a login)
1. Offline tests: `npx tsx test-captions.ts` -> last line `20 checks passed`. `npx tsx test-captions-routes.ts` -> `route smoke ok: 5 HTTP checks, 2 fake-upstream requests`. Both use fake data and make zero archive.org requests.
2. Server, after deploy (replace HOST):
   - `curl -s "https://HOST/api/captions/plan?id=ALJAZ_20261017_050000"` -> JSON with `"source":"asr"` and the "not broadcaster captions" label.
   - `curl -s "https://HOST/api/captions/plan?id=FOXNEWSW_20261016_030000_Fox_News_at_Night"` -> `"source":"align"`.
   - `curl -s "https://HOST/api/captions/slice?id=ALJAZ_20261017_050000&src=asr&start=0"` -> `{"cues":[...]}` with several cues (`"empty":false`). Times are seconds from the programme start.
   - `curl -s -o /dev/null -w "%{http_code}\n" "https://HOST/api/captions/plan?id=../x"` -> `400`.
   - `curl -s -o /dev/null -w "%{http_code}\n" "https://HOST/api/captions/slice?id=ALJAZ_20261017_050000&src=asr&start=30"` -> `400`.
3. In the app (DevTools Network, filter "captions"):
   - Click Fox News / CNN: panel appears under the video with the broadcast-captions label; lines follow the picture; about 1 slice request a minute.
   - Click Al Jazeera or DW: ASR label.
   - Click CTV, France 24 or TRT World: "No captions for this program." (expected on items with no caption file).
   - Click a radio station, classic TV, or any non-news channel: NO panel and NO `/api/captions` requests.
   - Let a programme run through a 282 s clip change: the panel keeps going without a new plan request.
4. Regression: TV Guide opens, channels still play, Home still loads.

## Rollback
Delete the 8 new files; revert the 2 `server.ts` lines and the 4 `PlayerView.tsx` edits. Nothing else changed.

## Known limits (honest)
- Proven only with synthetic data: 20 offline checks, a 5-check HTTP smoke test, and 11 checks of the real hook and panel in headless Chromium against a fake player and fake API (not shipped; they need Playwright). Real-Archive behaviour comes from probes: cc5 and align slices on a Fox item, ASR slice on an Al Jazeera item (anonymous, 200). It has not yet run in your live app.
- Cue times: measured RELATIVE per slice for cc5. ASR/align time base was not measured; the code auto-detects an absolute slice, but one wrong guess would show lines at the wrong time. Check by eye on Al Jazeera.
- `cc5` text trails the speech by about 3-5 s (one sample of 6 cues). Tune `KIND_LEAD_SECONDS` in `src/news/captions/captionTrack.ts` if needed.
- Coverage varies by item and network; the panel says so rather than showing nothing.
- Captions need the 429 proxy fix for long watching; see BUILD_TEAM_NOTE_PROXY_BODY_CAP.md (separate, for ChatGPT).
- Full-type-check of the whole repo was not run (this sandbox has no repo dependencies). The new files pass `tsc --strict` on their own.
- Archive's reuse terms for this text are unclear; owner decision 2026-10-16 to show it in-app, memory only, labelled.
