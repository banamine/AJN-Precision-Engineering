AJN drop-in for Google Builder (preview only) — 2026-10-31
Contains the SAME content as GitHub PR #153 (proxy v4) + PR #151 (Movies Classics list 5), minus tsconfig.json and reports.
Files (copy over the same paths, replace when asked):
  server.ts
  server/archiveFetch.ts
  server/archiveProxyFailureCache.ts
  src/data/extraChannelsManifest.json
  tools/build-infobattalion-lists.py
  test-archive-slow-node.ts
  test_infobattalion_builder.py
Also delete these two folders in Builder if they exist (already removed on GitHub by #152): ajn-bufferGauge-fetchstate, ajn-telemetry-audit
RULES: use this for PREVIEW only. Do NOT push/export from Google Builder to GitHub afterwards — GitHub is merged separately (an old-copy push caused the f063612 regression).
Check it landed: search server/archiveFetch.ts for "skipNodeProbe" (must be found).
Then test: Black Sheep, Next of Kin, and the Movies Classics (list) channel.
