AJN Precision Engineering — source drop-in
Date: 2026-10-27
Base: d7bceb856772ff2a9cac4de789ad3a155d650955

Copy the files below to the same paths from the repository root. This archive
contains changed source/test files only; it excludes node_modules, dist output,
screenshots, and the local .replit file. The PNG proof set is stored separately
under proof/final-2026-10-27/{before,after}/ in the PR.

Included files:
scripts/build-rush-index.ts
server/rush.ts
src/App.tsx
src/components/AudioBridgeStatus.tsx
src/components/HomeView.tsx
src/components/Navigation.tsx
src/components/PlayerChrome.tsx
src/components/ajn-platform-redesign/AppearanceProvider.tsx
src/components/ajn-platform-redesign/theme.css
src/data/rushIndex.json
src/index.css
test-library-rank.ts
test-mute-indicator.ts
test-player-separation.mjs
test-runtime-loop-guards.mjs
test-rush.ts
vite.config.ts

Changes covered:
- Allow the Replit, Cloud Run, AI Studio, and localhost preview hosts.
- Correct the four failing tests: three stale expectations/fixtures and two
  real UI issues (callback stability and Audio Bridge render churn).
- Prefer playable H.264 IA Rush derivatives, with original public MPEG4 as a
  fallback; rebuild the role-tagged Rush index with validated dates and stable
  Archive.org paging.
- Add the High Contrast default and Paper/White/Slate appearance choices,
  adjustable typography/accent/background, contrast readout, reset, and
  persisted settings. Restyle the mapped real screens without changing the
  protected playback engines or introducing mock data.

Verification recorded on Node 22.23.4:
- npm ci completed; npm reported Firebase packages require Node >=24.12.0.
- NODE_OPTIONS=--max-old-space-size=4096 npm run typecheck: exit 0.
- npm run build: exit 0 (existing large-chunk and runtime-asset warnings remain).
- Focused player-separation, loop-guard, mute-indicator, library-rank, Rush,
  Rush-next, EPG lifecycle, and Archive title tests passed.
- npm test did not complete: the bundled Nix Chromium could not decode the
  NOVA MP4 (DEMUXER_ERROR_NO_SUPPORTED_STREAMS).
- Local production-build Rush API returned 200 for 2005-12-08 and
  2016-12-29. The browser requested the 2005 Morning Update MP4 and got HTTP
  206, but bundled Nix Chromium reported media error 4 at currentTime 0; actual
  video playback and the automatic Hour 1 handoff could not be confirmed.
- The owner closed the BANNED VIDEO browser check; it was not retested.
