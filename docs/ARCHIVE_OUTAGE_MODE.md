# Archive outage mode

Archive health is a site-level signal for Archive-backed media. It is separate from item-level availability: a definite 400/403/404/410/422 response, including `UNPLAYABLE_ARCHIVE_MEMBER`, is logged as `counted:false`, does not change provider state, and is never stored in the item failure cache.

## States and thresholds

- `ok`: no current site outage signal.
- `degraded`: at least 3 counted network/server failures in the sliding 60-second window, or fewer than 50% successes among at least 6 counted outcomes, unless `down` applies. It returns to `ok` only after a full 60-second degraded window has fewer than 3 failures and at least one success.
- `down`: at least 5 counted network/server failures across at least 3 distinct item keys in the sliding 60-second window, with no success in the last 30 seconds.
- `unreachable_from_here`: a counted Archive request or Archive probe and the independent control probe fail in the same evaluation. This takes precedence over `down` and indicates a local connectivity problem, not a confirmed Archive outage. If the control probe has never run or is blocked by URL policy, `control` is `unknown` and only the Archive `down` threshold can apply.

All thresholds and intervals live in `ARCHIVE_HEALTH_DEFAULTS` in `server/archiveHealth.ts`. Events older than 60 seconds are pruned on every recorded outcome and probe. The item key is the Archive identifier from a download/metadata path; requests without an identifier use `search`, `metadata`, or `home`, and those class keys count as distinct keys. Retries are one logical observation: the final outcome is recorded once after proxy retries are exhausted; coalesced logical work is recorded once. A request that eventually succeeds is recorded as `ok`, not as its failed intermediate attempts. Network failures include actual connection/DNS error codes and transport timeout/network errors; HTTP 500/502/503/504 count as server failures. Synthetic error codes are not emitted.

An outcome produces one JSON log line with `ts`, `itemKey`, `kind`, `httpStatus`, `errorCode`, `counted`, `state`, and a path without its query string. `errorCode` is an actual runtime code or `null`. A state transition adds `transitionReason`. No query, cookie, or token is logged.

## Probes and recovery

The server starts an unref'ed prober outside test mode. It runs only when the state is not `ok`, sends one `HEAD` to `https://archive.org/` and a control `GET` to `https://www.gstatic.com/generate_204` (override with `AJN_CONTROL_PROBE_URL`), each with an 8-second timeout. The interval starts at 60 seconds and backs off to a maximum of 300 seconds after Archive probe failures. From `down` or `unreachable_from_here`, two consecutive successful Archive outcomes recover to `ok`; a real media request can be one of the successes, and any counted failure resets the streak. From `degraded`, recovery follows the full-window rule above. The fetch implementation and timers can be injected by tests; test mode does not start the prober.

## Retention and scope

Phase 1 state is ephemeral and instance-local in memory. It resets on process restart and is not shared between Cloud Run instances. Phase 1 has no retention, history, or graph. A 15-day history or graph requires a durable store and is Phase 2. Any future production graph must plot observed data only, with simulation clearly separated.

## Endpoints

- `GET /api/archive/status`: the state-machine status, with `Cache-Control: no-store`.
- `GET /api/health`: preserves the existing response fields and adds `archive` with the current state.

The state contains timestamps and counts only; it does not include media titles, captions, request bodies, or other item text.

## Client behavior

The shared `useArchiveStatus` store polls `/api/archive/status` every 30 seconds while subscribed and visible. It stops polling and aborts an in-flight status request when the page becomes hidden, then polls immediately when visible again. A failed status poll becomes `unknown`; the client must not infer an outage from a failed poll.

The navigation status banner reports `degraded`, `down`, and `unreachable_from_here`. When `down` or `unreachable_from_here`, `Thumb` skips Archive-hosted candidates and continues to local/non-Archive candidates or its existing placeholder. It resumes the normal candidate order when the service is healthy.

When a non-definite Archive media failure occurs while the status is `down` or `unreachable_from_here`, the player pauses the current item instead of marking it failed or advancing. It retries the same item through the existing player pipeline when the status returns to `ok`. Definite item-specific responses and non-Archive playback retain the previous failure policy. Existing HLS teardown order is unchanged.

## Tests and operational limits

The outage-specific tests use an injected clock, fake fetch responses, fake visibility/timers, and localhost-only HTTP. They make zero live Archive requests. Coverage includes retry/coalescing accounting, 90-second sliding-window behavior, item-specific uncounted logging/cache exclusion, control-probe precedence and recovery, two-success recovery, and transition reasons. The existing CI `npm test` step and deployment `test:real-archive-playback` gate remain unchanged by this feature; they may make live Archive requests.

The CI Archive preflight (`scripts/archive-preflight.mjs`) is informational only: it reports `archive_up=true|false` and emits a warning when unavailable, and always exits 0. It is not a condition for deployment or any test job’s result. Build, lint, and fixture/mock-based test failures remain independent blocking checks.

During a suspected outage, use `/api/archive/status` first. If an external check is authorized and necessary, make at most one light request to the canonical Archive host, record the result, and stop on rate limits or server errors. Do not bulk-probe identifiers, change timeouts/retry policy to conceal an outage, or classify unrelated media as dead. Resume normal Archive-dependent work only after the status returns to `ok` and the affected workflow passes its usual focused verification.
