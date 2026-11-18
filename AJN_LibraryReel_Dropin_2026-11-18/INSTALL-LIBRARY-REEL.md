# Library homepage preview + viewer — drop-in (Plan A)

Copy these 7 files over your working copy (same paths), then publish. Nothing else changes; server.ts is untouched.

NEW
- server/homepageLibrary.ts            catalog + image route (/api/library/homepages, /api/library/homepage-image)
- src/library-reel/reelLogic.ts        pure rules (who gets it, date line, shuffle/history, zoom)
- src/library-reel/HomepageReel.tsx    the preview under the audio + the full-screen viewer
- test-homepage-library.ts             tests (not part of the build)

EDITED (full files)
- server/folderArt.ts     +2 lines: mounts the new routes
- src/utils/playerKeys.ts +2 lines: keys typed inside the viewer are ignored by the player
- src/MinimalPlayer.tsx   +3 lines: shows the preview for Alex Jones / Infowars audio only.
                          Based on the Browse Panel drop-in version (2026-11-17), so it keeps browseSlot and the diagnostics tap.

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
