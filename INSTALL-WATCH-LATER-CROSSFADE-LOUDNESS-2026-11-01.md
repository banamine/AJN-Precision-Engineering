# Install: page cross-fade + Watch Later + loudness batch (2026-11-01)

Files in this ZIP (all paths relative to the repo root `B:\AJN Precision Engineering\AJN-Precision-Engineering\repo`):
NEW   src/utils/watchLater.ts, src/components/WatchLaterView.tsx, test-watch-later-store.ts, tools/loudness/{lib.mjs,normalize-batch.mjs,normalize-batch.test.mjs,README.md}
EDIT  src/App.tsx, src/components/Navigation.tsx, src/components/PlayerView.tsx, src/MinimalPlayer.tsx, src/types.ts, src/nav/lastView.ts, package.json
These EDIT files are whole-file replacements made from your local copies read on 2026-11-01. If AI Studio or GitHub changed them since, compare first.

What changed
- App.tsx: pages cross-fade (150 ms) using `motion/react` AnimatePresence (mode popLayout). TV Guide and the persistent player are deliberately OUTSIDE it (they stay mounted so audio keeps playing and the guide keeps its scroll). Reduced-motion users get no animation.
- Watch Later: new `#watch-later` page, nav item right after History (desktop and mobile), bookmark button next to the heart in the player. Saved by hand, or automatically once >= 50% of an item has played and it is not finished; removed again when it is finished (95% or last 5 s). Items you remove by hand are not re-added this session. Live radio / live streams are refused with a visible message. Limit 200 (refuses, never drops). Local storage only (`ajn.watchLater.v1`), not cloud-synced.
- MinimalPlayer/PlayerView: the progress callback now also passes the real media duration (needed for "half played"); nothing is guessed when duration is unknown.

PowerShell steps (run in order; wait for each prompt to return)
1. cd "B:\AJN Precision Engineering\AJN-Precision-Engineering\repo"           (instant)
2. git status                                                                  (2 s; note anything uncommitted)
3. git checkout -b feature/watch-later-crossfade                              (instant)
4. Expand-Archive -Path "$HOME\Downloads\ajn-watchlater-crossfade-loudness-2026-11-01.zip" -DestinationPath . -Force   (5-10 s; adjust the zip path)
5. npm run test:watch-later          (about 15 s)  expect: every line starts with "ok"
6. npm run lint                      (1-3 min)     expect: no errors
7. npm run build                     (2-4 min)     expect: "built in ..." and dist\server.cjs written
8. npm run dev                       (about 20 s to start) then open the app and check:
   a. Home -> History -> Radio: a quick fade, no flash. Start audio, switch pages: audio keeps playing.
   b. Play something with a known length, seek past halfway, switch page: a "Saved to Watch Later" note appears and the item is on the Watch Later page (nav, next to History).
   c. Let it finish (or seek to the last seconds): it disappears from Watch Later.
   d. Reload on #watch-later: you land on the Watch Later page.

Loudness batch (optional, separate)
9. winget install Gyan.FFmpeg        (1-2 min; then CLOSE and reopen PowerShell)
10. npm run test:loudness           (about 40 s)  expect all "ok"
11. node tools/loudness/normalize-batch.mjs --in "<your audio folder>" --out "<new output folder>" --dry-run   (time depends on file count; about 1 s per minute of audio)
    then run again without --dry-run. Read normalize-log.csv: PASS rows are done; REVIEW rows need your decision.
Target defaults to -16 LUFS / -1.5 dBTP. If Google gives a different spec, add --lufs and --tp.
