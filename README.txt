AJN Third Eye headlines + fresher TV News search (2026-11-15)
Drop these 10 files into the repo at the same paths.
NOTE: channels.ts, server.ts, NewsCubePage.tsx, SearchView.tsx are full files from the local clone (branch feature/neural-twin);
if your Builder copies differ, apply to the Builder versions: changes are small (see below).
Changes: server.ts (import + registerTvChyronsRoute + new /api/search: 14-day window, ?all=1, ?bypassCache=true, collapsed repeats),
channels.ts (sort identifier desc = newest broadcast first, bypassCache, collapseRepeatAirings), NewsCubePage.tsx (HeadlinesBoard above the TV strip),
SearchView.tsx (Last 14 days / All time, Latest button, UTC time, "aired Nx" pill).
Verify: npx tsx server/thirdEye/thirdEye.test.ts  -> 5 pass.  Then npm run dev and open /api/tv-chyrons?hours=24 (wait ~20 s first call).
