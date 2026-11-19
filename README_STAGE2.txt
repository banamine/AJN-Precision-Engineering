AJN Uniform Shell - Stage 2 v4 (2026-11-18) - includes stage 1 v3 files, so install this ONLY (not stage 1 separately).
 src/App.tsx               Home and Radio use the fixed-height shell; page never scrolls, one scroll region inside each
 src/components/HomeView.tsx  "On now" wall: 2x2 below 1024px, 4 across at >=1024
 src/index.css             + .ajn-screen-main / .ajn-scroll-region (plus all stage 1 CSS)
 src/components/PlayerWidget|PlayerView|MiniPlayerDock.tsx  unchanged from stage 1 v3
Limit: Radio keeps its existing layout/drawers inside the one scroll region; the full Stage/Now playing/Presets/list reflow is not done yet.
 + audio Full player: compact stage (PlayerView.tsx class + index.css)
