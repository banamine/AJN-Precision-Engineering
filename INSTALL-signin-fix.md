# Sign-in fix (2026-10-11) — drop in, same paths
Files: src/hooks/useCloudSync.ts, src/sync/cloudBackend.ts, package-lock.json (now includes firebase@13, so `npm ci` works), tools/checks/sync-panel-check.cjs.
package.json is NOT included: AI Studio's already has "firebase": "^13.0.0".
Cause fixed: Firebase app/auth/firestore were pulled in through separate dynamic imports (two module copies in the dev server -> "Component auth has not been registered yet"). Now cloudBackend.ts is the only module importing firebase/*, loaded by one import(); it uses its own named app "ajn-sync".
Verify: Sign in with Google on History page. Expected: Google popup (on an authorized domain) — never "Component auth has not been registered yet".
