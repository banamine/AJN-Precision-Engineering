AJN GOOGLE BUILDER PREVIEW DROP-IN  2026-11-01   (PREVIEW ONLY - DO NOT PUSH FROM BUILDER)

Source: GitHub branch preview/integration-2026-10-31, commit 024810f
(= main 95dee3c [#157 revert applied] + #151 Movies list restore + #154 Movies split + #155 popover cleanup).
Not included: .replit (Replit config), tsconfig.json (#151 exclusion lines are not needed in Builder), PR #156 (CI tooling).

HOW TO APPLY
Unzip at the project root, overwrite same paths. 18 files. Nothing is deleted.
Do NOT commit/push/sync to GitHub from Builder after applying.

FILES
 guideRegistry.ts, server.ts, package.json
 server/moviesClassicsSchedule.ts (new)
 src/components/ShowInfoButton.tsx, src/showinfo/fallback.ts, src/types.ts
 src/data/extraChannelsManifest.json   (mx-movies-classics-list restored: 4,053 rows)
 tools/build-infobattalion-lists.py, test_infobattalion_builder.py
 test files (not used by the running app): test-extra-channels.ts, test-infobattalion-lists.ts, test-movies-channel-split.ts, test-rt-documentary.ts, test-showinfo-fallback.ts, test-showinfo-popover-harness.tsx, test-showinfo-popover.html, test-showinfo-popover.mjs

EXPECTED AFTER REPUBLISH (Replit preview of the same commit measured)
 Guide -> Movies: 26 channels (was 9)
 Movies channel info popover, press "More info": "N programs today . N distinct titles in rotation"; no Source lines; no Archive link.
 /api/schedule?guide=movies-classics-vault returns 26 channels.
Archive nodes ia600903/ia800903 are slow: first byte up to 20 s is not a failure.
