# ZIP 2.1 = Replit's ZIP 2 (PARTIAL) + 2 Claude fixes (2026-11-05)
1. WRONG-SHOW BUG RESTORED IN ZIP 2, FIXED HERE: ZIP 2's catalog again aired "Cagney & Lacey S04E06 Taxi Cab Murders", "Charlie's Angels S05E10" and "Supernatural S08E19" as Taxi (Taxi 92 episodes). tools/build-classic-network-catalog.mts now has fileNamesShow(): the FILE name must name the show. Catalog 611 -> 609 (Taxi 90). Catalog and Publication regenerated: revision 97891d452eb707a584ef051e4f5b1bc22cacc37be7558ec1369e34a492f6391b, 3,204 programs, active 2026-11-05 00:00 Los Angeles, covered to 2027-01-04. Replit's revision a14eafdb... in REPORT.md is superseded.
2. PIN: src/guide/channelIndex.ts puts "AJN Classic TV" at station 1 (otherwise the guide sorts it alphabetically among the A's).
Verified by Claude on clean base d33c54a + this overlay: tsc 0; compiler/catalog/publication/isolation/live-tune/upcoming/movies tests pass; publication check ok (1440 h left).
NOT verified: playback of any new episode, H.264 on real devices, Cloud Run, rights. Movies channel starts 2026-11-09 per config.
Not included from ZIP 2: screenshots/ (not needed).
