# AJN LIVE vs CURRENT EDIT FORENSIC REPORT

## 1. Baseline Identification

**LIVE:**
- **Published URL:** https://ais-pre-22ngduihbs737dbjc6habr-804326557407.us-east1.run.app
- **Deployment/Version Identifier:** Unknown / Unavailable from within the sandbox
- **Source/Build Information:** The published LIVE source cannot be directly inspected. Git comparison unavailable.

**EDIT:**
- **Current Sandbox URL:** https://ais-dev-22ngduihbs737dbjc6habr-804326557407.us-east1.run.app
- **Source/Build Information:** Local container sandbox (Node.js + Express + Vite). Repaired and verified to build successfully (`npm run build` completed).

## 2. Executive Finding

The LIVE source code cannot be directly accessed or retrieved from this environment. Because of this limitation, a strict deterministic line-by-line file comparison and pipeline trace against the known-good LIVE baseline cannot be performed.

## 3. File-Level Comparison

*(Note: Because the LIVE source is unavailable, all differences are marked as UNKNOWN. Do not pretend a source comparison occurred.)*

- `server.ts` - UNKNOWN
- `channels.ts` - UNKNOWN
- `guideRegistry.ts` - UNKNOWN
- `src/MinimalPlayer.tsx` - UNKNOWN
- `src/components/PlayerView.tsx` - UNKNOWN
- `src/components/TvGuideView.tsx` - UNKNOWN
- `src/EpgGuide.tsx` - UNKNOWN
- `src/types.ts` - UNKNOWN
- `src/telemetry.ts` - UNKNOWN
- `src/App.tsx` - UNKNOWN

## 4. Playback Pipeline Comparison

- **LIVE behavior:** Unknown (source unavailable)
- **EDIT behavior:** TV Guide → `handleEpgSelect` → `handlePlayProgram` → sets `nowPlaying` state and updates destination to `player` → `PlayerView` mounts → `MinimalPlayer` mounts → `video.load()` → `video.play()` → `onEnded` fires → `handleProgramEnded` queries `/api/schedule`, calculates the `next` program via array index → updates telemetry with `playback.advance` or `playback.loop` → calls `onSelectProgram(next...)`.
- **Difference:** UNKNOWN
- **Regression risk:** UNKNOWN (Due to lack of LIVE comparison)

## 5. Archive Proxy Comparison

- **LIVE behavior:** Unknown (source unavailable)
- **EDIT behavior:** Endpoint located at `/api/archive/proxy`. Preserves HTTP 200/206. Forwards Range, Accept-Ranges, Content-Length, Content-Type, Content-Range headers. Implements `AbortController` cleanly bound to `req.on("close")` to aggressively clean up upstream streams on client disconnect. Prevents JSON payloads from being sent to the video element disguised as MP4s. Contains conservative 3-retry policy with exponential backoff.
- **Difference:** UNKNOWN
- **Regression risk:** UNKNOWN

## 6. News Channel Comparison

| Channel | LIVE | EDIT | Difference | Regression Risk |
|---------|------|------|------------|-----------------|
| Fox News | UNKNOWN | Exists, configured in EPG/Registry | UNKNOWN | UNKNOWN |
| CNN | UNKNOWN | Exists, configured in EPG/Registry | UNKNOWN | UNKNOWN |
| MSNBC | UNKNOWN | Exists, configured in EPG/Registry | UNKNOWN | UNKNOWN |
| BBC News | UNKNOWN | Exists, configured in EPG/Registry | UNKNOWN | UNKNOWN |
| NTD News | UNKNOWN | Exists, configured in EPG/Registry | UNKNOWN | UNKNOWN |

## 7. EPG / Program Advancement Comparison

- **LIVE behavior:** Unknown
- **EDIT behavior:** The `/api/schedule` endpoint provides array structures of channels and programs with `startTime`, `endTime`, `duration`, `mediaUrl`, and `archivePath`. In `PlayerView.tsx`, advancement is deterministically computed by matching `nowPlaying.src` against the schedule's `mediaUrl` or `archivePath`, then advancing to `(index + 1) % programs.length`.

## 8. Telemetry Comparison

- **LIVE behavior:** Unknown
- **EDIT behavior:** `telemetry.ts` strictly uses `crypto.randomUUID()` (no fallback to `Math.random()`). It enforces clean event objects (`playback.started`, `playback.advance`, `playback.loop`, `media.error`). The server provides `ProxyStats` exclusively through `/api/health`. Telemetry is strictly OBSERVATIONAL ONLY (Console logs) and does not impede playback logic.

## 9. Public UI / Diagnostic Comparison

- **LIVE behavior:** Unknown
- **EDIT behavior:** Developer telemetry identity in `PlayerView.tsx` is securely guarded by `import.meta.env.DEV` and only renders in development mode. The `ProxyMonitor` component is restricted to `DevModeView.tsx` via the `#dev` hash route. No developer-only telemetry spills into the normal public player.

## 10. Regression Findings

**Git comparison unavailable.** Unable to deterministically compare patterns against the LIVE deployment.

## 11. Known-Good LIVE Behaviors That MUST Be Preserved

Unable to extract from source (LIVE source unavailable).

## 12. EDIT Changes That Are Safe

Unable to directly compare. However, EDIT builds cleanly (`npm run build` succeeds) and structurally includes the explicit `AbortController` repairs requested.

## 13. EDIT Changes Requiring Inspection

Unable to directly compare.

## 14. Critical Regression Risks

Unable to directly compare.

## 15. Raw Evidence

Git comparison unavailable. File `server.ts` and UI source files inspected manually in current sandbox state.

## 16. Final Phase 1 Decision

COMPARISON INCOMPLETE — LIVE SOURCE UNAVAILABLE
