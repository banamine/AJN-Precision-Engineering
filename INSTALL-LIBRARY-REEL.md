# Library homepage preview + viewer — drop-in (Plan A)

IMPORTANT: unzip so that `src/` and `server/` land directly in the app folder. Do NOT drop the wrapper folder in as a subfolder.

Copy these 27 files over your working copy (same paths), then publish. Nothing else changes; server.ts is untouched.

NEW
- server/homepageLibrary.ts            catalog + image route (/api/library/homepages, /api/library/homepage-image)
- src/library-reel/reelLogic.ts        pure rules (who gets it, date line, shuffle/history, zoom)
- src/library-reel/HomepageReel.tsx    the preview under the audio + the full-screen viewer
- test-homepage-library.ts             tests (not part of the build)

NEW (picture)
- public/ajn-art/alex-show-round.jpg  your "ALEX JONES SHOW extras" image, fitted to a circle so the whole title shows. Used as the round cover for the 3 Alex Jones audio channels + INFOWARS Archive RADIO.

EDITED (full files)
- src/utils/radioPresets.ts, src/components/RadioPresetsBar.tsx  VISUALIZER FIX: the 5 preset buttons (AJN Alex Jones, Infowars, 109 Original/Classic Rock/Warm)
                          started a station without its live program id, so the app never allowed the signal meter ("Spectrum unavailable").
                          Now they pass "<station>:live:d0" like the station buttons lower on the page do. Recent-station buttons get the same.
- test-radio-preset-program-id.ts  test for this (not part of the build)
- server/folderArt.ts     +2 lines: mounts the new routes
- src/utils/playerKeys.ts +2 lines: keys typed inside the viewer are ignored by the player
- src/MinimalPlayer.tsx   +3 lines: shows the preview for Alex Jones / Infowars audio only: INFOWARS Archive RADIO, the live Infowars stream, and the three Alex Jones Radio Show / Depopulation channels in Audio & Podcasts.
                          Based on your 2026-11-18 export (keeps the Browse Panel and the audio fade).

Layout: on windows 768px wide or more the preview is a card inside the stage (about 300 px wide on a 1100 px window, larger on bigger windows, always clear of the round picture and never taller than the stage), to the right of the round picture (so it is visible without scrolling); on phones it sits under the stage as before.

What you will see (Infowars radio / Alex Jones audio only)
- Under the audio: "LIBRARY CAPTURE", a homepage picture that changes every 12 s with a soft fade, its date line
  (e.g. "10 Jun 2025 - 6:59 am UTC-05:00"), "Historical homepage. Not synchronized to this audio.", and Previous / Pause slideshow / Next.
- Click the picture or Expand: full-screen viewer with Fit page / Fit width / 100% / - / +, Close (or Esc), and one "Pause audio / Play audio" button.
  The audio keeps playing while you look; space, arrows, M, J/K/L do nothing to the audio while the viewer is open.
- Pauses itself while the mouse or keyboard focus is on it, when the tab is hidden, and after you press Previous/Next or open the viewer
  (press "Play slideshow" to resume). If your device asks for reduced motion: no auto-rotation and no fade; Previous/Next/zoom still work.
- Library unreachable: "Library temporarily unavailable", the last good picture stays.
- No archive words and no outside links anywhere in what the browser sees. Pictures come through this app only.

Checked here (real, on your machine)
- Tests pass: npx tsx test-homepage-library.ts
- Type check of the 5 new/edited TypeScript files: clean.
- Live run against the real library: catalog 200 "ok", 3,363 eligible captures (2022-07-17 to 2026-04-30), first call about 6 s, then cached 1 h.
  One image fetched: 200, image/jpeg, 271,762 bytes. Bad id -> 400, unknown id -> 404.
- Not checked: the full app build and the visual look in a browser (MinimalPlayer imports were not type-checked as a whole).

Size/build safety: 4 new files, 3 small edits, no data inlined, no new packages.

Your steps (PowerShell, from the repo folder)
1. Drop the zip contents over your repo (or Builder), same paths.            ~10 s
2. npx tsx test-homepage-library.ts   expect: homepage library tests passed     ~15 s
3. Publish from Builder; open the Infowars radio channel and play it. The preview shows under the audio.
Rollback: restore the 3 edited files from the Browse Panel version; delete the 4 new files.

Known limits (honest)
- No blurred backdrop behind the stage yet (left alone so the existing audio art stays untouched).
- Captures from May 2026 onward and some 2024 periods are absent by design (blank/challenge pages fall under the 100,000-byte screening line).
- The screening rule is a size check, not a review of each picture.
- Other places in the app still say "Archive" (separate sweep).


ROUND 2 - VISUALIZER (added 2026-11-18)
- src/MinimalPlayer.tsx   badge/bars only use the analyser when the audio is really connected to it. Podcasts without a meter now say "no signal meter for this source" instead of a false "silence".
- src/data/podcastSources.json  +9 podcasts flagged corsVerified (probed 2026-11-18, every redirect hop sends CORS headers): Kuhner Report, Red Eye Radio, Lead Pedal, Mat's Trucking Great, TalkCDL, Truck n Hustle, Rush Limbaugh Wisdom, Ben Ferguson, Clay & Buck. If one ever fails to load in meter mode the app retries without it, so sound is never lost.
- src/components/MiniPlayerDock.tsx  dock play / next / previous station now pass the live program id (same fix as the preset buttons).
Still without a meter (their audio hosts send no CORS headers; badge says so): Quash, Bannon War Room, Savage Nation, Pat Gray, Jeff Fisher, Radiolab.

ROUND 3 - STAGE FILLER (no empty stage when there is no meter)
- src/components/StageFiller.tsx, stageFillerLogic.ts (new), test-stage-filler.ts (test)
- src/MinimalPlayer.tsx   shows the filler only while audio plays AND the meter cannot read the source (podcasts such as Quash, Bannon, Savage Nation, Pat Gray, Jeff Fisher, Radiolab):
    left card "Now playing" (cover, title, show, length), right card "Headlines" (real items from the Daily News Digest; hidden if the digest is unavailable), and the existing background video behind them (follows your prelude-video toggle).
    Windows 768px wide or more: two cards. Narrower windows: one compact strip at the bottom of the stage (title, show, first headline). Live radio, library music, video and sources with a meter are unchanged.
    The Now playing card also shows the episode's own description (up to 5 lines) for podcasts, read from the show's feed through a new small route /api/podcast/episode-note (server/episodeNote.ts, mounted from server/folderArt.ts; no outside request). Back-catalog items and any text containing the word "archive" show no note.
    test-episode-note.ts is a test (not part of the build).

ROUND 4 - "ARCHIVE" -> "LIBRARY" WORDING (owner's rule; decisions: display-time swap, normal-user screens, folder-art alias only)
NEW  src/utils/libraryWording.ts       the one wording rule (Archive -> Library, Archived -> Recorded, hourly archives -> hourly recordings, Internet Archive / Archive.org -> the library)
NEW  src/utils/libraryWordingDom.ts    one observer that applies the rule to what is on screen: text, aria-label, title, alt, placeholder, page title. Never URLs, inputs or code. Opt out on any element with data-keep-wording.
EDIT src/main.tsx                      installs it (2 lines)
EDIT src/news-cube/chyronUi.tsx        removed the "Open on Archive.org" link (outbound archive.org link)
EDIT src/news-cube/TvChannelStrip.tsx  removed the "Open this minute on archive.org" link
EDIT src/utils/useFolderArt.ts + server/folderArt.ts  cover art now loads from /api/library/folder-art (the old /api/archive/folder-art URL still works)
NEW  test-library-wording.ts           test (not part of the build)
Not changed on purpose: /api/archive/proxy (protected), stored data files and source strings (the swap happens on screen), log lines, dev-only screens (Proxy Tester) are scrubbed too unless you add data-keep-wording.
Not covered by the on-screen swap: text drawn inside a canvas (for example News Cube faces) and text read aloud by anything other than the page.
CHECK after publishing - paste in the browser console on any page:
  [...document.body.innerText.matchAll(/archive/gi)].length          (expect 0; then browse Discover, Guide, Listen, Library, Search, a failing stream)
  [...document.querySelectorAll('[aria-label],[title],[alt],[placeholder]')].filter(e=>/archive/i.test(e.getAttribute('aria-label')+e.title+e.alt+e.placeholder)).length   (expect 0)
