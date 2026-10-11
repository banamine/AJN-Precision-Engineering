# "Sync to cloud" button (Developer Mode > Settings) - 2026-10-10
Same-path replacement. Independent of the other 2026-10-10 zips.
NEW: server/routes/syncPlaceholder.ts, src/utils/cloudSync.ts, test-cloud-sync.ts
CHANGED: server.ts (2 lines: import + registerSyncPlaceholder(app), right after the /api/health POST), src/components/DevModeView.tsx (new Settings section)
Note: server.ts is a full-file replacement; it was identical to your current file apart from those 2 lines.

How to use
1. Play a few items (the list keeps the last 5).
2. Open Developer Mode: add #dev to the app address (e.g. https://ajn-precision-engineering.ai.studio/#dev).
3. In Settings > "Cloud sync - Recently played" press "Sync to cloud". Nothing syncs automatically.
4. Read the status line: green "N items received. Not stored (placeholder endpoint)." = accepted by the placeholder; red "Sync failed: ..." = it failed and says why (offline, timeout, bad data).

The endpoint: POST /api/sync/recently-played with {version:1, clientTime, items:[{id,title,src,progressSeconds,updatedAt,...}]} (max 50 items).
 202 {placeholder:true, stored:false, received:N} on success; 400 {error} on bad data. It stores NOTHING - the UI says so.
Later: replace the handler body in server/routes/syncPlaceholder.ts with the real store (e.g. Directus); the request shape stays.
Check: curl.exe -s -X POST https://<app>/api/sync/recently-played -H "Content-Type: application/json" -d "{\"version\":1,\"items\":[]}"  -> {"placeholder":true,"stored":false,"received":0,...}
Verify: npx tsx test-cloud-sync.ts
