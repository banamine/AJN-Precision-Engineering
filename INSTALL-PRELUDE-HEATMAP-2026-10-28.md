# Drop-in: Prelude backdrop video + small heat-map (archive-music player only)
Base: `main` @ 8063eb2 (includes PR #134). Built 2026-10-28. Apply on a NEW branch from main, e.g. `feat/prelude-heatmap`. Do not merge until the checks below pass.

## What changes
| File | Change |
|---|---|
| `src/MinimalPlayer.tsx` | 2 imports, 1 const, `preAnalyserRef` destructured, 2 persistent flags, 3 elements inside the archive-music stage branch ONLY (backdrop video, heat-map, two small toggles). Live radio / video branches untouched. |
| `package.json` | adds `test:heatmap-color` and appends it to `npm test` |
| NEW `src/components/PreludeBackdropVideo.tsx` | silent looping backdrop; reduced-motion = poster; pauses when tab hidden/off-screen; error = renders nothing; typed slot reserved for a later YouTube source |
| NEW `src/components/HeatmapStrip.tsx` | rolling spectrogram, reads the EXISTING pre-gain analyser only; no new audio nodes, no random values; paused = stops drawing; unreadable = "Heat-map unavailable" |
| NEW `src/utils/heatmapColor.ts` | pure bin->row and colour helpers |
| NEW `test-heatmap-color.ts` | unit tests + static guards (no Math.random, no Web Audio nodes, no analyser setting changes, extras only inside archive-music branch) |
| NEW `public/media/prelude-loop.mp4` (2.0 MB, silent, 9.25 s, seam baked in) and `prelude-loop-poster.jpg` | static assets |

Not touched: `use-audio-normalization.ts`, `ArchiveMusicSpectrum.tsx`, `AudioVisualizerOverlay.tsx`, live radio path, proxy, server.

## Apply (PowerShell, in the repo folder on main)
```powershell
git switch -c feat/prelude-heatmap
# copy the zip contents over the repo root (overwrites src/MinimalPlayer.tsx and package.json, adds the new files)
git status --short
```
If main has moved since 8063eb2, do NOT overwrite the two big files: use `git apply --3way prelude-heatmap.patch` for them and copy only the NEW files.

## Verify
1. `npm run test:heatmap-color` -> `heatmap-color: all checks passed`
2. `npm run lint` -> no errors (not run against the full repo by Claude: only the new files were type-checked in isolation)
3. `npm run build` -> succeeds, and `dist/media/prelude-loop.mp4` exists
4. Browser, play any archive-music track (channel id `item-music-*`):
   - dim glass-tile video behind the stage; existing bars still draw; coloured strip scrolls along the bottom edge (>= 640 px wide)
   - Pause -> bars flat, strip stops moving (picture stays), video keeps looping
   - Skip track -> strip clears
   - "Backdrop" / "Heat-map" buttons (top right of the stage) toggle each layer; choice survives reload (`ajn_prelude_video_enabled`, `ajn_heatmap_enabled`)
   - Console: `performance.getEntriesByType('resource').filter(r=>r.name.includes('prelude-loop'))` shows the mp4 loaded; no errors
   - Live Radio view: DOM has NO `[data-testid=prelude-backdrop]` and NO `[data-testid=archive-heatmap]`
5. `npm run test:audio-singleton` still passes (one AudioContext, one MediaElementSource).

## Rollback
`git restore src/MinimalPlayer.tsx package.json` and delete the 6 new files / `public/media`.
