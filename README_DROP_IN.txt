DROP-IN (one step): copy everything in this zip into the repo root, say YES to overwrite.
Then delete these 2 leftover files by hand (they are unused; Builder added them):
  scripts/zipmember-series.ts
  config/zipmember-series.json
Then commit/push.
Then follow HOW_TO in the chat: add secrets IA_ACCESS_KEY / IA_SECRET_KEY, run ajn-zipmember-remux, then ajn-zipmember-sync.
