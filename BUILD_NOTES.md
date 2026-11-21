# Today's podcasts (daily edition) drop-in, 2026-11-20

Base: the local working tree of AJN-Precision-Engineering as of 2026-11-20 (it had uncommitted edits, e.g. the Loading pill in ScheduleDeck.tsx). Copy every file here to the same path in the app (7 existing files are replaced whole, 10 are new).

NEW: src/utils/dailyEdition.ts (+ .test.ts, .testdata.ts), src/utils/editionPool.ts (+ .test.ts), src/hooks/useDailyEdition.ts, server/mp3Duration.ts (+ .test.ts), server/podcastEdition.ts (+ .test.ts)
CHANGED: src/utils/roundRobinSchedule.ts, src/hooks/useScheduleController.ts, src/components/ScheduleDeck.tsx, server/podcasts.ts (export fnv + daily fields), server.ts (route GET /api/podcasts/edition), src/data/podcastSources.json (dailyPriority/dailyMode/...), package.json (test:schedule only)

Build notes: the edition is served by its own route /api/podcasts/edition (not /api/schedule) so the 28 MiB schedule response is untouched. The edition is one more pool ("Today's podcasts", first in the Podcasts bank); Shuffle is disabled for it. Existing pools are byte-for-byte unchanged in behaviour.

Run: npm run test:schedule   (expect: 8 + 4 + 22 + 6 + 4 + 4 tests, 0 fail)
Verify live (Evidence First): curl -s localhost:PORT/api/podcasts/edition | head -c 600
  expect editionStatus "ok" (or "building"/"degraded" with staleFeeds), edition.loop in the fixed order, no loop item without a real duration.
