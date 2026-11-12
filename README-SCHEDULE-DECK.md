# Schedule deck drop-in (Entry 034 final spec)

Copy every file over the same path in the repo (all paths are repo-relative). Base: commit b79dfb8 (two-pool Paris-Portland ingest) of banamine/AJN-Precision-Engineering.

New:      src/utils/roundRobinSchedule.ts (+ .test.ts), src/utils/scheduleCatalog.ts (+ .test.ts), src/hooks/useScheduleController.ts, src/components/ScheduleDeck.tsx
Modified: src/components/RadioPresetsBar.tsx (deck + FM sub-source), package.json (test:schedule script, chained into npm test)
Data:     src/data/audioItemSnapshot.json (regenerated: +26 channels), src/data/fmBroadcastChannels.json (new, 346 broadcasts), src/data/concertPoolsManifest.json (1,410 concerts)
Not touched: MinimalPlayer.tsx, PlayerView.tsx, PlayerChrome.tsx, showQueue.ts, listenCatalog.ts, useListenDeck.ts, audioPresets.ts

Verify:  npm run lint && npm run test:schedule && npm run build
