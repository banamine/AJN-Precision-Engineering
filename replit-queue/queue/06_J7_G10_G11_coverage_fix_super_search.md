# J7 - Prompt I Parts 2-3: coverage test, gap fixes, super-search design
GATES: G10 = Part 2 (coverage test + fixes), G11 = Part 3 (design only). Start G10 only after "GO G10" with the approved exclusion rules.
BASE: final commit of `feat/classic-dedupe-live-alt` (Prompt G) -> branch `feat/coverage-audit`.
STOP RULE: do exactly the gate(s) named below, deliver the ZIP, update STATE.md, then STOP and wait for the owner's GO message. Follow docs/replit-starter/00_START_HERE.md, 01_DELIVERY_PROTOCOL.md and 04_PHASE_GATES.md. Run every test under tools/net-guard.mjs.

ROLE: Investigator first, then builder and tester, for AJN Precision Engineering only (not AJN-pro-play-, not AJN-Media-Console). Read docs/replit-starter/00_START_HERE.md and 01_DELIVERY_PROTOCOL.md first and follow them. Evidence first; no invented counts; failures and exclusions are listed with a reason, never silently dropped.

GOAL: prove, with a repeatable test, that every show the app can play is (S1) findable by title in every search bar, (S2) present in the Library, (S3) present in its TV guide, (S4) eligible for Now Playing / Daily What's Playing (scheduled or shuffle), and show the gaps.

PART 2 - COVERAGE TEST AND GAP FIXES (only after the owner replies "GO PART 2" with the approved rules)
Branch `feat/coverage-audit` from Prompt G's final branch. One commit per item. Reuse existing modules; no second index, no second search path.
1. `test-coverage-matrix.ts` (+ npm script `test:coverage`): builds U from shipped data, computes S1-S4, and FAILS if an item is missing from a surface without an entry in an exclusion list `server/catalog/coverageExclusions.json` (ASCII-only; each entry needs a reason code). Prints the matrix totals. 0 network requests.
2. Fix accidental gaps with the smallest change per cause (for example lazy per-channel loading instead of a hard cap, adding a missing source to the Library index, making the scheduler's candidate set include the item). Do not rewrite protected core (BroadcastTVGuide, SchedulerEngine, ChannelManager, PlayerStore); list every touched line.
3. Explicit empty states: a search with no result says so; an excluded item opened by direct link shows the exclusion reason. No silent fallback.
4. Budget: report payload and build-time before/after; stay inside the Classic-TV 32 MB budget and the Library budget.
Verification: unit tests per cause fixed, the coverage test passing on the real data, Chromium screenshots at 390 px and 1440 px with stubbed data (search from each bar for one item of each source type), existing tests unchanged (player-honesty, epg-tune-window, group-programs, guide-channel-index, archive-item-guide, series, Prompt D/E/F/G tests).

PART 3 - SUPER SEARCH DESIGN (design only, no code)
One entry point and result model across News, Classic, Library, Live and Radio: a single query function over the existing indexes, result type (show / episode / channel / station / program), facets (category, genre/subject, year, collection, rating, kind), intent words ("play", "what's on"), and where each result can be sent (play now, add to queue, schedule into a guide). List the files it would touch, the order, the tests, risks, and the decision points. Say whether the Phase 1 numbers justify any new infrastructure.


DELIVER per 01_DELIVERY_PROTOCOL.md (JOB = I_2026-10-18): Part 1 ships its own report and the matrix as CSV (item key, source, S1-S4, reason) before Part 2 starts. If a part cannot be finished safely, ship the finished part and mark the rest NOT DONE with the reason.
