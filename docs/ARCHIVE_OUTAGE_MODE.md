# Archive outage mode

Archive health is a site-level signal for Archive-backed media. It is separate from item-level availability: a definite 400/403/404/410/422 response remains specific to that item and does not contribute to the site failure threshold.

## States and thresholds

- `ok`: no current site outage signal.
- `degraded`: at least 3 network/server failures in the rolling 60-second window, or fewer than 50% successful logical media responses with at least 6 samples, unless the `down` threshold is met.
- `down`: at least 5 network/server failures across at least 3 distinct Archive identifiers in the rolling 60-second window, with no successful logical media response in the last 30 seconds.
- `unreachable_from_here`: both the Archive probe and the independent control probe fail.

The thresholds live together in `server/archiveHealth.ts` so they can be adjusted without spreading policy through callers. Proxy retries are one logical observation: health is recorded once after `fetchArchiveMediaWithRetry` finishes, not once per attempt. Network failures include the configured connection/DNS codes and `fetch failed`; HTTP 500/502/503/504 count as server failures. Definite item responses do not.

## Probes and recovery

The server starts an unref'ed prober outside test mode. It runs only when the state is not `ok`, sends a single `HEAD` to `https://archive.org/` and a control `GET` to `https://www.gstatic.com/generate_204` (override with `AJN_CONTROL_PROBE_URL`), each with an 8-second timeout. The default interval is 60 seconds, increasing to a maximum 300 seconds after failures. Two consecutive successful Archive probes recover the state to `ok`. The fetch implementation and timers can be injected by tests; test mode does not start the prober.

## Endpoints

- `GET /api/archive/status`: the state-machine status, with `Cache-Control: no-store`.
- `GET /api/health`: preserves the existing response fields and adds `archive` with the current state.

The state contains timestamps and counts only; it does not include media titles, captions, request bodies, or other item text.

## Client behavior

The shared `useArchiveStatus` store polls `/api/archive/status` every 30 seconds while subscribed and visible. It stops polling and aborts an in-flight status request when the page becomes hidden, then polls immediately when visible again. A failed status poll becomes `unknown`; the client must not infer an outage from a failed poll.

The navigation status banner reports `degraded`, `down`, and `unreachable_from_here`. When `down` or `unreachable_from_here`, `Thumb` skips Archive-hosted candidates and continues to local/non-Archive candidates or its existing placeholder. It resumes the normal candidate order when the service is healthy.

When a non-definite Archive media failure occurs while the status is `down` or `unreachable_from_here`, the player pauses the current item instead of marking it failed or advancing. It retries the same item through the existing player pipeline when the status returns to `ok`. Definite item-specific responses and non-Archive playback retain the previous failure policy. Existing HLS teardown order is unchanged.

## Tests and operational limits

The outage-specific tests use an injected clock, fake fetch responses, fake visibility/timers, and localhost-only HTTP. They make zero live Archive requests. Do not run the broad browser/Puppeteer `test.js` suite as an outage gate; it may depend on real Archive assets.

During a suspected outage, use `/api/archive/status` first. If an external check is authorized and necessary, make at most one light request to the canonical Archive host, record the result, and stop on rate limits or server errors. Do not bulk-probe identifiers, change timeouts/retry policy to conceal an outage, or classify unrelated media as dead. Resume normal Archive-dependent work only after the status returns to `ok` and the affected workflow passes its usual focused verification.
