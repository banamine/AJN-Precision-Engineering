# AJN LIVE vs CURRENT FORENSIC COMPARISON

## 1. Executive Summary
The forensic comparison could not be completed because the source code for the previously published LIVE version is not accessible within this environment. Without the known-good LIVE baseline source files or a version control history (e.g., Git), it is impossible to perform a deterministic, file-by-file structural and behavioral comparison. 

## 2. Versions Compared
- **CURRENT SANDBOX:** 
  - Location: `/app/applet` (Local Container)
  - URL: `https://ais-dev-22ngduihbs737dbjc6habr-804326557407.us-east1.run.app`
  - Status: The newly repaired version that successfully passes `npm run build` and runs the proxy server.
- **KNOWN-GOOD LIVE:** 
  - URL: `https://ais-pre-22ngduihbs737dbjc6habr-804326557407.us-east1.run.app`
  - Status: **SOURCE UNAVAILABLE.** The source code for this deployed environment cannot be retrieved, and there is no local `.git` repository to pull a baseline commit for comparison.

## 3. File Inventory
*Comparison impossible. LIVE source unavailable.*

## 4. File-by-File Differences
*Comparison impossible. LIVE source unavailable.*

## 5. Server Comparison
*Comparison impossible. LIVE source unavailable.*

## 6. Player Comparison
*Comparison impossible. LIVE source unavailable.*

## 7. News/EPG Comparison
*Comparison impossible. LIVE source unavailable.*

## 8. Proxy Comparison
*Comparison impossible. LIVE source unavailable.*

## 9. Telemetry Comparison
*Comparison impossible. LIVE source unavailable.*

## 10. Routing Comparison
*Comparison impossible. LIVE source unavailable.*

## 11. Functionality Matrix
| Feature | LIVE | CURRENT | Difference | Risk |
|---|---|---|---|---|
| Player loads | UNKNOWN | YES (Compiles/Runs) | UNKNOWN | UNKNOWN |
| Fox News | UNKNOWN | YES (EPG Data) | UNKNOWN | UNKNOWN |
| CNN | UNKNOWN | YES (EPG Data) | UNKNOWN | UNKNOWN |
| MSNBC | UNKNOWN | YES (EPG Data) | UNKNOWN | UNKNOWN |
| BBC | UNKNOWN | YES (EPG Data) | UNKNOWN | UNKNOWN |
| NTD | UNKNOWN | YES (EPG Data) | UNKNOWN | UNKNOWN |
| Archive proxy | UNKNOWN | YES (Handles 200/206/Aborts) | UNKNOWN | UNKNOWN |
| Range requests | UNKNOWN | YES (Proxy Range Configured) | UNKNOWN | UNKNOWN |
| Program advancement | UNKNOWN | YES (Modulo Indexing) | UNKNOWN | UNKNOWN |
| EPG | UNKNOWN | YES (/api/schedule) | UNKNOWN | UNKNOWN |
| /api/health | UNKNOWN | YES (Returns JSON) | UNKNOWN | UNKNOWN |
| Telemetry | UNKNOWN | YES (Console, crypto.randomUUID) | UNKNOWN | UNKNOWN |
| Home | UNKNOWN | YES (Component exists) | UNKNOWN | UNKNOWN |
| TV Guide | UNKNOWN | YES (Component exists) | UNKNOWN | UNKNOWN |
| Library | UNKNOWN | YES (Component exists) | UNKNOWN | UNKNOWN |
| Search | UNKNOWN | YES (Component exists) | UNKNOWN | UNKNOWN |

## 12. Regression Risks
Cannot be determined without comparing against the working LIVE behavior baseline.

## 13. Missing LIVE Functionality
Unknown.

## 14. Current-Only Functionality
Unknown.

## 15. Evidence
- Output of `git status`: `fatal: not a git repository (or any of the parent directories): .git`
- The LIVE URL provides compiled HTML/JS bundles that are minified, but does not provide access to the raw baseline source files (`server.ts`, `App.tsx`, etc.).

## 16. Final Release Risk
**YELLOW** — Needs browser verification. Because a baseline code comparison is impossible, the only way to ensure LIVE functionality hasn't been lost is via rigorous runtime/browser testing of the current sandbox before deployment.

## 17. Recommended Next Investigation
Proceed directly to manual browser runtime validation (the "RUNTIME GATES") as specified in the drop-in repair report. Verify playback resilience, media element errors, continuous segment advancement, and telemetry accuracy directly in the browser environment.
