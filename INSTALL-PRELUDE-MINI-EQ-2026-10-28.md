# Drop-in: Prelude backdrop video + mini multicolor equalizer (archive-music player only)
Base: `main` @ 8063eb2 (includes PR #134). Replaces the earlier heat-map zip (the orange strip is gone). Apply on a NEW branch from main, e.g. `feat/prelude-mini-eq`. Do not merge until the checks below pass.

## What you get
- Silent looping 3D glass backdrop video behind the music stage (dim, with a dark scrim so text stays readable).
- Mini multicolor equalizer (24 bars, violet -> pink -> red -> orange -> yellow -> green -> cyan -> blue) on the cover tile, driven by the SAME analyser as the blue bars.
  - No cover image: the tile is the music-note icon, and the bars FILL it (tall, up to 85% of the tile; note dimmed behind).
  - Cover image present: the bars OVERLAY the artwork (lower, up to 48%, soft dark vignette so the art still shows).
  - Paused: flat stubs. Analyser unreadable: draws nothing (the existing "Spectrum unavailable" label still shows).
- Two small toggles top-right of the stage: "Backdrop" and "Mini EQ" (remembered: `ajn_prelude_video_enabled`, `ajn_mini_eq_enabled`).
- The orange heat-map strip is removed entirely.

## Files
| File | Change |
|---|---|
| `src/MinimalPlayer.tsx` | archive-music branch ONLY: 2 imports, 1 const, 2 flags, backdrop video, 2 toggles, mini EQ inside the cover tile (`relative` added to the tile). Live radio / video branches untouched. |
| `package.json` | adds `test:mini-eq`, appended to `npm test` |
| NEW `src/components/MiniEqVisualizer.tsx`, `src/components/PreludeBackdropVideo.tsx`, `src/utils/miniEqBars.ts`, `test-mini-eq.ts` | |
| NEW `public/media/prelude-loop.mp4` (2.0 MB, silent, 9.25 s seamless) + `prelude-loop-poster.jpg` | |

Not touched: `use-audio-normalization.ts`, `ArchiveMusicSpectrum.tsx`, `AudioVisualizerOverlay.tsx`, live radio, proxy, server.

## Apply (PowerShell, repo folder on main)
```powershell
git switch -c feat/prelude-mini-eq
# copy the zip contents over the repo root
git status --short
```
If main moved since 8063eb2, do NOT overwrite `src/MinimalPlayer.tsx` / `package.json`: use `git apply --3way mini-eq-prelude.patch` and copy only the NEW files.

## Verify
1. `npm run test:mini-eq` -> `mini-eq: all checks passed`
2. `npm run lint` -> no errors (Claude type-checked only the new files in isolation)
3. `npm run build` -> succeeds; `dist/media/prelude-loop.mp4` exists
4. Play an archive-music track:
   - cover tile with NO art: coloured bars fill the tile; with art: bars sit over the lower part of the art
   - pause -> bars flat; skip -> bars follow the new track
   - "Mini EQ" / "Backdrop" buttons toggle each layer; survives reload
   - Live Radio view: no `[data-testid=mini-eq]` and no `[data-testid=prelude-backdrop]` in the DOM
5. `npm run test:audio-singleton` still passes.

## Rollback
`git restore src/MinimalPlayer.tsx package.json`; delete the 6 new files and `public/media`.
