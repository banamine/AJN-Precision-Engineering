# Issue #51 — dock vs guide while media is PLAYING (390px + 1376px)

## What is in this zip (2 new files, nothing existing is overwritten)
- test-dock-playback-overlap.mjs   the browser test
- testFixtures/dock-playback-clip.webm   20-second local test video (150 KB). The test audio is generated in memory.

## Install (PowerShell, in the repo folder B:\AJN Precision Engineering\AJN-Precision-Engineering\repo)
1. Unzip so both files land in the repo folder (the .webm goes into the existing testFixtures folder).
2. Run:   npx tsx test-dock-playback-overlap.mjs
   Wait about 1 minute. Do not type until the prompt comes back.
3. Expected last line:
   PASS dock-playback-overlap: real playback (video + podcast) at 390 and 1376; dock clears guide filters, channel actions and bottom nav; Radio toggle reachable; visualizer on the shared analyser; zero Archive traffic
4. Screenshots are written to REVIEW\screens\dock-playing-*.png.
5. If it fails, it prints a line starting "[dock-playback diagnostic]" and saves REVIEW\screens\dock-FAIL-<phone|desktop>.png. Send me both.

## Optional: add an npm shortcut
In package.json, next to the "test:guide-ui" line, add:
    "test:dock-playback": "tsx test-dock-playback-overlap.mjs",
then run:  npm run test:dock-playback

## Run it against current main
It was written and run against GitHub main (commit 4fc9f04). Your local folder is behind main (RadioDock.tsx differs), so pull/sync first.
