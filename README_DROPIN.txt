AJN COLORIZED FILMS PAGE 2 — DROP-IN ZIP
Branch:  feat/colorized-films-page2-2026-11-09
Base:    e86d2c1 (2026-11-07 movie refresh)
Built:   2026-11-09
By:      Claude Sonnet 4.6 / AJN Engineering Repair session

WHAT THIS ZIP CONTAINS
  ITEMS.csv          — 27 new Archive identifiers to admit to the colorized route
  UPLOAD_ORDER.txt   — Apply order for build team
  ROLLBACK.txt       — How to undo
  VERIFY.txt         — Post-apply checks the build team must run
  README_DROPIN.txt  — This file

WHAT THE BUILD TEAM MUST DO
  1. Checkout branch feat/colorized-films-page2-2026-11-09 from e86d2c1
  2. Run: node tools/build-archive-accounts.js --account a_colorized_generation --fetch
     (or python tools/build-archive-accounts.py --account a_colorized_generation --fetch)
     This regenerates reports/archive-accounts.json with the 27 new items admitted.
  3. Verify VERIFY.txt checks pass.
  4. Open draft PR only — do NOT merge or deploy.

HARD RULES (non-negotiable)
  - Additive only: 0 existing rows removed or changed
  - No new npm dependencies
  - Node 22
  - Movies guide payload must stay under 3 MB — STOP and report if exceeded
  - Archive proxy unchanged (bounded 206 slices ≤ 8 MiB, Cloud Run limit 32 MiB)
  - No Math.random, no fake telemetry, no silent fallbacks
  - Never commit secrets
  - Uploader email never stored in any output file

ACCOUNT CONFIG (already in config/archive-accounts.json — NO CHANGES NEEDED)
  account:  a_colorized_generation
  prefix:   clx-
  route:    colorized
  expected: 127
  filter:   null

BASELINE CATALOG STATE (from 2026-11-07 refresh, commit e86d2c1)
  Total assets:          7,057
  Playlist entries:        858
  Spotlight pool:          536
