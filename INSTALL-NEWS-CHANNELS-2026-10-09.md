# Add 6 news channels to Cable TV (2026-10-09)
Adds CBC News, CTV News, Al Jazeera English, France 24, TRT World, DW News to Cable TV (after KPIX).

## Files (drop in at the same paths)
- `server/sources/archiveNews.ts` - 6 new rows in NEWS_NETWORKS. Parser fix: CTV_, ALJAZ_ and FRANCE24_ identifiers have NO show-name suffix (`CTV_20261009_023000`) and were rejected as "identifier has no air time"; they are now accepted and titled with the channel name.
- `src/data/newsSnapshot.json` - fresh packaged snapshot (2026-10-09 09:44 UTC, 12 networks x 12 shows) so the channels are populated on cold start. The server refreshes itself every 6 h.
- `test-source-archive-news.ts` (suffix-less id tests added), `test-cable-news-guide.ts` (expected channel list updated; it also now lists the two Infowars extra channels the old expectation missed).

## Verify after republish
1. `curl https://<app>/api/schedule?guide=cable-tv` -> ids include `cbc, ctv, aljazeera, france24, trt-world, dw`, each with programs.
2. `curl https://<app>/api/news/version` -> `fetchedAt` within 6 h.
3. `node tools\site-sweep.mjs --url https://<app>` -> 0 FAIL.
4. Guide -> Cable TV -> play a CBC, CTV and Al Jazeera show.
Notes: full Archive files are restricted (403), so shows play as 282 s clips grouped into one block, like CNN/Fox. CBC overnight is mostly repeats of The National. Proxy, player and other guides are untouched.
