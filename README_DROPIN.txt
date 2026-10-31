F4 ARCHIVE FAILURE ISOLATION — LOCAL DROP-IN
Status: implemented and offline-verified; not committed, pushed, merged, or deployed.

TASK
Implement the approved F4 local fix on branch fix/f4-archive-isolation-2026-10-30.
Base: 1cdcfef955ff9a70e72ac330e7d7c51f0358623d (origin/main still pointed to
f063612 at the time; the requested restore was not yet on remote main).

DID
- Circuit breaker: timeouts are recorded per storage host and Archive item ID.
  A host-wide circuit opens only after 3 distinct item IDs time out within a
  rolling 90-second window. The existing 20-second cooldown remains. One slow
  item cannot block another item on the same node.
- Header wait: the per-hop response-header timeout is 25 seconds; one media
  request has a shared 60-second monotonic deadline across redirect resolution,
  alternate-node checks, media headers, and retries. A timeout caused by the
  total proxy budget is reported distinctly and does not count as an upstream
  host timeout.
- Waiting UI: removed timer-based claims that a delay is upstream. Waiting text
  is neutral. A timeout or circuit-open reason is shown only when the proxy's
  diagnostic response supplies a structured reason; circuit text includes its
  retry seconds.
- Player errors: 502/503/504 proxy diagnostics now produce cause-appropriate
  messages. If the diagnostic is unavailable, Archive-proxy playback failures
  no longer claim “Format error”; the UI says the HTTP cause is unavailable.
- Proxy failure diagnostics are retained in the existing short-lived cache
  during upstream outages so the player can retrieve the structured cause.
- Left unchanged: 8 MiB bounded slices, 206 handling, and the 12-second
  response-body idle timeout. F7 telemetry was not changed.

FACTS
- Owner-provided first-byte samples for Black Sheep S01E20 were 20.4 s, 3.5 s,
  14.0 s, and 2.7 s; Brother Bear control was 0.9 s. This supports isolating
  an individual slow item rather than opening a node-wide circuit on repeated
  requests for that same item. N=3 distinct items in 90 s is the implemented
  systemic-failure threshold.
- Worst-case configured response-header wait is 60 seconds total per request,
  with no individual media/redirect header wait above 25 seconds. The deadline
  includes time between attempts, so actual aggregate header wait can be lower.
  Timer firing can exceed the nominal deadline by event-loop scheduling delay.
  The separate metadata timeout remains 10 seconds.
- F7 proxyRequestId is null in ordinary periodic buffer samples because the
  browser's media events do not expose the server response header per range
  request, and the periodic buffer sample schema does not accept a request ID.
  sliceIndex is null when the player lacks both usable file-size and duration
  metadata; a byte-to-time mapping cannot be calculated without guessing.
- Offline diagnostic serialization used:
  {"error":"Archive upstream timed out waiting for response headers","upstreamStatus":0,"attempts":3,"proxyRequestId":"12345678-1234-1234-1234-123456789abc","errorCode":"AJN_UPSTREAM_HEADER_TIMEOUT"}
  Buffer.byteLength(..., "utf8") = 197 bytes. This representative current
  diagnostic body is 29 bytes larger than the owner-observed 168-byte response;
  that historical response body is not reproduced by this fixture.
- All six focused test commands passed with local fetch stubs. The health-server
  test explicitly reports 0 real Archive requests. No live Archive request
  was made in this job.

ERRORS
- First root tsc attempt on Node v24.22.1 exited 134 at Node's default ~2 GiB
  heap limit. Re-running with NODE_OPTIONS=--max-old-space-size=3072 completed
  successfully and found one stale test import; that test was updated to the
  new diagnostic-cache behavior. The final 3 GiB typecheck passed.
- Production build passed. Vite emitted non-fatal unresolved-at-build-time and
  large-chunk warnings; esbuild completed successfully.

NOT DONE AND WHY
- No live media confirmation was run: the task was restricted to local
  implementation and offline verification. Therefore this does not prove the
  Black Sheep stream's real playback after the timeout change.
- Node v22 was not used; the local runtime was Node v24.22.1.

NEED FROM OWNER
- No input is needed to review/apply this local drop-in. A separate, explicitly
  authorized bounded live-media check is still needed to verify real first-byte
  behavior and sustained playback.

VERIFY COMMANDS AND RESULTS
- npx tsx test-archive-retry.ts — PASS; includes repeated-one-item isolation,
  3-distinct-item host circuit, a fake-clock budget spanning redirect+media
  stages/retries, and a short-budget abort test.
- npx tsx test-archive-retry-wait.ts — PASS; fake-clock threshold/window/cooldown.
- npx tsx test-archive-failure.ts — PASS.
- npx tsx test-archive-proxy-failure.ts — PASS; reports 197-byte representative
  timeout diagnostic serialization.
- npx tsx test-archive-health-server.ts — PASS; 0 real Archive requests.
- npx tsx test-waiting-notes.ts — PASS.
- NODE_OPTIONS=--max-old-space-size=3072 npx tsc --noEmit — PASS.
- npm run build — PASS.
- git diff --check — PASS.

ZIP CONTENTS (repository-relative paths)
server.ts
server/archiveFetch.ts
server/archiveProxyFailureCache.ts
src/MinimalPlayer.tsx
src/components/WaitingNotes.tsx
src/utils/archiveFailure.ts
test-archive-failure.ts
test-archive-health-server.ts
test-archive-proxy-failure.ts
test-archive-retry-wait.ts
test-archive-retry.ts
test-waiting-notes.ts
