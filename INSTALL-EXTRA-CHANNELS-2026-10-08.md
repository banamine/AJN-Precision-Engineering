# Extra channels (2026-10-08, pass 3)
Copy over the repo (same paths; guideRegistry.ts is cumulative, server.ts from the previous zip still applies):
- guideRegistry.ts, src/services/producers/showSourcesProducer.ts (one word: `export` on toProgram)
- src/data/extraChannelsManifest.json (NEW), src/data/organizerShowsManifest.json (replaces: Info Survior no longer added to Classic)
- tools/build-extra-channels-manifest.py, tools/build-organizer-manifest.py, reports/extra-channels.json, reports/organizer-routing.json
- test-extra-channels.ts (NEW), test-movies-classics.js (assertion updated: curated channel first, then the mx-* channels)
Cable TV guide: INFOWARS NIGHTLY NEWS (9,816), INFO WARS SURVIVAL (1,153).
Movies guide: Lars Germany Mittank Movies (22), JT's Ghost Movies (3,478), AIVIIXX Movies (1,437), Random Movies (426), STAR WARS (1).
Verify: NODE_ENV=test npx tsx test-extra-channels.ts -> PASS extra-channels: {...}
