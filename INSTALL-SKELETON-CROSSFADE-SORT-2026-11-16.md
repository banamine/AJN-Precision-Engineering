# Install: guide skeleton + audio fade + Library sort (2026-11-16)

Paths are relative to the repo root `B:\AJN Precision Engineering\AJN-Precision-Engineering\repo`.
NEW   src/components/GuideSkeleton.tsx, src/utils/audioFade.ts, test-audio-fade.ts, test-library-sort.ts
EDIT  src/EpgGuide.tsx, src/MinimalPlayer.tsx, src/components/LibraryView.tsx, server/libraryIndex.ts, server.ts
EDIT files are whole-file replacements made from your local copies read 2026-11-16. If AI Studio or GitHub changed them since, compare first.

What changed
- TV Guide: the spinner + "Loading..." (EpgGuide.tsx, the `isLoading || channels === null` branch) is now a skeleton with the real grid's shape (toolbar, time ruler, 8 channel rows). Pulse stops for reduced-motion users. No fake data.
- Audio: switching tracks fades the playing track out (300 ms) before the next loads, then fades the new one in (700 ms) once sound starts. Only when audio is really playing; not for pause/mute/video/same source. Opt out: localStorage `ajn_audio_crossfade` = `off`.
- Library: "Sort by" dropdown beside the item count: Default/Best match, Name (A-Z), Date added (newest), Genre. Sorted on the server across ALL pages (not just the 24 on screen); choice is remembered; page resets to 1 on change.

Build notes
- The Web Audio bridge feeds one element at a time, so this is fade-out then fade-in, not an overlap. A true overlap needs the bridge (use-audio-normalization.ts) changed; not done.
- Auto-advance with a preloaded next track is left gapless (no fade; the old track already ended).
- The next track now fades up to the volume slider's value (new elements used to start at full volume).
- Date added = `indexedAt` (when the record entered the library index). Guide-derived items are stamped at each refresh, so they cluster at the top; ties sort by name. Genre = the item's first Library category label.

PowerShell steps
1. cd "B:\AJN Precision Engineering\AJN-Precision-Engineering\repo"
2. git status                       (note anything uncommitted)
3. git checkout -b feature/skeleton-fade-sort
4. Expand-Archive -Path "$HOME\Downloads\AJN_Skeleton_Crossfade_Sort_Dropin_2026-11-16.zip" -DestinationPath . -Force
5. npx tsx test-audio-fade.ts        expect: 12 lines, all "ok"
6. npx tsx test-library-sort.ts      expect: 5 lines, all "ok"
7. npm run lint                      expect: no errors
8. npm run dev, then check:
   a. TV Guide (hard reload, or throttle network in DevTools): skeleton shows, then the grid replaces it without a jump.
   b. Play a music album, press next/pick another track: old track dips out, new one rises. Slider volume is respected.
   c. Library: Sort by Name / Date added / Genre; go to page 2 and confirm the order continues.
