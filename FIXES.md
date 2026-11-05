# ZIP 1.1 — what changed from ZIP 1 (Claude, 2026-11-04 18:5x Denver)
Built on Replit's ZIP 1 (same base d33c54ac059f752b1a394adc4b877d337e92a426). Only these files differ from ZIP 1:
server/classicNetwork.ts, config/classic-networks.json, tools/build-classic-network-catalog.mts, docs/CLASSIC_NETWORK.md,
src/data/classicNetworkCatalog.json, src/data/classicNetworkPublication.json, plus the new tests/test-classic-network-zip11.ts.
1. START DATE: originMonday 2026-11-02, activeFrom 2026-11-04 00:00 America/Los_Angeles. `npx tsx tools/compile-classic-network.mts --network classic-network` now works with no flags; the channel is live as soon as it is published (ZIP 1 started Nov 9).
2. REVISION HASH: tzdbNote (Node/tzdb text) is no longer part of the hash; COMPILER_VERSION is classic-network-2. Same inputs give the same revision on Node 22 and 24.
3. WRONG-SHOW BUG: ZIP 1 aired "Cagney & Lacey S04E06 Taxi-Cab Murders" as Taxi S04E06 (it displaced the real episode), plus a Charlie's Angels and a Supernatural row in Taxi. The catalog builder now requires the FILE name to name the show. Taxi is 90 episodes (was 92 with 3 impostors); total 609.
4. TITLES: viewer titles are built from the file name, e.g. "Danger Man (Series 1) — View from the Villa", "Taxi S01E02 — One Punch Banta", "Hogan's Heroes S01E01". ZIP 1 showed "Danger Man Destination Danger 63" for every Danger Man episode.
5. LINEUP: all six shows (Death Valley Days and The Odd Couple still withheld: Death Valley Days has no file rows in the app's manifests, Odd Couple has 152 rows without a real duration). Average hours/day: Hogan's 5.05, Get Smart 4.79, Benson 4.29, Taxi 4.28, Danger Man 4.19, Dick Van Dyke 1.41.
NOT FIXED (unchanged from ZIP 1): TV Guide grid cross-midnight/DST rendering (BroadcastTVGuide untouched), list sync / manifests, third seek browser case, H.264 decode and Cloud Run (not verifiable here).
