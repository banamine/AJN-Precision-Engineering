# AJN consolidated Builder drop-in — 2026-10-07
Contains everything from today in one pass: RT Documentary channel + Info card fix, Movies restore (18 films), Movies daily rotation, EPG tune-in Play button + 4–6h window.
Install: unzip over the project root (same relative paths). Overwrites 9 existing files, adds 10 new ones. Do NOT touch dailyHighlights.ts (not included).
Overwritten: guideRegistry.ts, server.ts, src/App.tsx, src/EpgGuide.tsx, src/MinimalPlayer.tsx, src/components/ShowInfoButton.tsx, src/data/moviesClassicsManifest.json, test-cable-news-guide.ts, test-movies-classics.js.
New: server/dailyRotation.ts, server/rtDocumentary.ts, src/data/rtDocumentaryIndex.json, src/guide/liveTune.ts, src/guide/timeWindow.ts, src/showinfo/fallback.ts, test-daily-rotation.ts, test-epg-tune-window.ts, test-rt-documentary.ts, tools/*.py
Checked on a fresh copy of the Builder export: tsc clean; build OK; test-epg-tune-window, test-daily-rotation, test-rt-documentary, test:movies-classics(+producer, manifest-resolve) pass.
Update 2 (playback): src/MinimalPlayer.tsx now reconnects in place (3 tries, resumes at the same position) on network/proxy errors and after 45 s of buffering, instead of skipping to the next item. Definite failures (403/404/410/not streamable) still skip at once.
