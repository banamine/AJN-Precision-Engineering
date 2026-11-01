AJN combined drop-in 2026-10-30 = F4 archive isolation + Telemetry Audit/fetchState gauge.
Extract over the repo root (paths are repo-relative). Do NOT also apply the two source zips; this replaces both.
src/MinimalPlayer.tsx = F4 version + 2 telemetry edits (networkState in gauge push; fetchNote in bufferLine).
Verify: npx tsc --noEmit ; run the six test-*.ts from the F4 README ; then Appearance > Telemetry Audit.

ADDED 2026-10-30 (v2): slow storage-node avoidance in server/archiveFetch.ts
- A media response whose headers take >= 8 s marks that node slow for 5 min (log: "storage node slow to respond").
- Resolver no longer spends its 1-byte probe on a slow-marked node; the fetch tries a replica first (10 s header timeout).
- Slow node stays the fallback, so it never turns a working stream into an error. A fast response clears the mark.
- Limit: keyed on header latency only; slow BODY throughput is not detected. Not tested against live archive.org.
- New test: test-archive-slow-node.ts (stub fetch). Existing test-archive-retry/-retry-wait/-failure pass in my sandbox.

ADDED (v3): 503/504 proxy replies now include "host" (the storage host that timed out or whose circuit is open).
Files: server/archiveFetch.ts, server/archiveProxyFailureCache.ts, server.ts (one line), test-archive-slow-node.ts.
Purpose: next failure names the host without needing Cloud Run logs.
Finding (from reading code): when the open circuit is a STORAGE node, a replica rescues the request; when it is archive.org itself (the redirect probe host), nothing is rescued and every uncached item fails for ~20 s. Black Sheep's "attempts: 0" circuit-open reply fits the second case but is unconfirmed until the host shows in the reply.

ADDED (v4): no separate storage-node probe (server.ts passes skipNodeProbe; env AJN_ARCHIVE_NODE_PROBE=1 restores it).
 - Front door redirect -> node URL returned unprobed; the real media request validates it, so a slow node is waited on once, not twice.
 - Node-side redirects are followed (max 3 hops), each re-validated against the archive allow-list.
 - Default of fetchArchiveMediaWithRetry is unchanged (F4's scripted tests pass untouched).
Tests (sandbox, stub fetch): test-archive-retry, -retry-wait, -failure, -slow-node all pass. tsc NOT run. Nothing live.
