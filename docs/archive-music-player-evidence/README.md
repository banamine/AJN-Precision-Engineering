# Archive music player browser evidence

Captured from the local app in Chromium after the Archive-only redesign. The Archive item was `item-music-00s-radio-hits-2024`, “Viva La Vida” by Coldplay.

## Archive music

- `archive-playing-desktop.jpg` — 1440×1000; actual playback with the analyser bars changing.
- `archive-paused-desktop.jpg` — 1440×1000; paused with a flat spectrum baseline.
- `archive-playing-phone.jpg` — 390×844; phone stage and controls during playback.
- `archive-paused-phone.jpg` — 390×844; phone stage and controls while paused.
- `archive-phone-panels.jpg` — 390×844; the three Archive panels, including the single Up Next list.

Browser checks:

- The existing `/api/archive/proxy` returned the track as `audio/mpeg` with `206 bytes 0-5721226/5721227`; artwork requests returned `image/jpeg` with `200`.
- The playing spectrum samples changed between frames; the paused canvas had zero non-baseline pixels.
- The player DOM had one media element, one Now Playing panel, one Up Next list, six upcoming rows, no side-art thumbnails, and no On Air badge.
- Selecting an Up Next item on both desktop and phone, and selecting a Recently Played item, changed the selected Archive program.
- `ArchiveMusicSpectrum` creates no Web Audio nodes. It reads the authoritative runtime analyser, cancels its animation frame, and disconnects its resize observer. Archive-mode player cleanup releases its media source through the existing runtime; shared analyser nodes remain owned by that runtime.

## Live-radio parity

- `live-radio-main-before.png` — `origin/main` at `02938ae`.
- `live-radio-feature-after.png` — the feature branch, captured with the same route, station, and 800×600 viewport.

In both runs, Classic Hits 109 returned `audio/mpeg` with status `200`, playback time advanced, the existing radio stage and audio controls were present, and Archive panels were absent. The analyzer state was `idle`/silence in both runs. The visible live-radio layout matched.
