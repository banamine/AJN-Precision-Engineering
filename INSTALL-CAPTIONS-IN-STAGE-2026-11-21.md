# AJN: captions + news moved INTO the viewport, and the news fix (2026-11-21, update 1)

Apply over the 7:20 AM export (it already contains the Captions + Lock-on zip). 4 files, same paths in the repo.

## What changed
1. **Captions and news now live inside the audio stage** (the big dark box with "On air"). The separate panel under the stage is gone, so the page is about 190 px shorter and should fit without scrolling. The round show art and side art are hidden on podcast episodes (they sat where the captions now are). Episodes with no transcript show the show art, the title and "No transcript for this episode" in the left panel, plus the news on the right.
2. **News fix.** Your screenshot said "Digest unavailable (HTTP 429)": the app *server's* own request to GitHub Pages was refused with 429. From here the same file loads fine (HTTP 200, `access-control-allow-origin: *`). When the server cannot load the digest, the carousel now reads the same public file straight from the browser (same URL and same parser as the server and the News Cube) and says so under the carousel: "Loaded directly: the app server could not reach the digest (HTTP 429)." If both fail you see both reasons. This also fixes the Radio page carousel, which uses the same component.

## Files
`src/components/PodcastStage.tsx`, `src/components/NewsCarousel.tsx`, `src/hooks/useDirectDigest.ts` (new), `src/MinimalPlayer.tsx`
`src/MinimalPlayer.tsx` is based on your 7:20 AM export and differs from it only by: the `podcastStageSource` line, the stage min-height switch, hiding art/side art, mounting `<PodcastStage .../>` inside the stage, and removing the old mount under the stage.

## Test
1. Play a Kuhner episode. Captions and the news sit inside the stage; no panel below it; no page scroll on a normal window.
2. News: story with its picture, Prev/Next, "n / total". If you still see "Loaded directly..." the server digest is still being refused; the news should still show.
3. Phone width: captions fill the stage; the news hides below tablet width (by design).
4. An episode with no transcript (e.g. Tucker Carlson): art + title + "No transcript for this episode" + news on the right.

## Verified vs not
Verified (Chromium, real Kuhner file and real transcript, server digest forced to fail with HTTP 429, live digest file served to the direct fetch): panel inside the stage, list fills the height (273 px in a 384 px stage), carousel loaded directly with the right notice and a picture, no transcript layout, phone width (no horizontal overflow), tsc clean, tests pass. Not verified: your deployed server's digest after the 429 clears (the direct read covers it either way); the Prev/Next buttons look faint only in my test page because it does not load cockpit.css (the app does).
