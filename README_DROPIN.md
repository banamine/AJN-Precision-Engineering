# On Air Board drop-in (2026-11-24)
1. Drop `src/onair/nextAirings.ts` into the repo (new file, safe to overwrite).
2. From repo root run: `node _dropin/patch-onair-board.mjs`  -> patches `src/onair/OnAirPage.tsx` (aborts without writing if any anchor is missing; makes a .bak).
3. Verify: `npx tsc --noEmit`. On /on-air the cards titled "Tonight on AJN", "Now", "When does it play" should rotate.
Not included (needs your export): radio-to-header, desk headline derivation.
