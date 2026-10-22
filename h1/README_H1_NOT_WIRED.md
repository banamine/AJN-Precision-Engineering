# H1 manifest — staged, NOT wired into the app

extraChannelsManifest.H1.json (SHA-256 9316b0b5…c67575e): 1,350 channels. Built offline from Replit's metadata pack; 119 dark items excluded; private-file rows deferred.

Why it is not in the app yet:
- classic-tv guide payload would be 80.7 MB vs the 30 MB budget in test-infobattalion-lists.ts.
- test-extra-channels.ts pins the exact movie channel list and fails with the full manifest.
- main's manifest and the 221-channel base differ (main's is older); needs an owner decision.
Breakdown of new channels: classic-tv "Unsorted - review" 868 ch / 4.1 MB, Classic TV 55, Music Videos 23, Documentary 6, cable News 3, Movies 8.
Suggested next step: ship the curated groups (Classic TV, Documentary, Music, News, Movies) only, then raise/shard the budget deliberately for "Unsorted - review".
Branch with converter + tests: h1-metadata-fill-2026-10-21 (pushed, no PR).
