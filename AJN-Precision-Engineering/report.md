# AJN Builder Prompt — Runtime Repair, Telemetry, and Freeze Gate

## 1. Phase 1 root cause
- **Symptom:** `Unhandled 'error' event` causing the Node server to crash with `DOMException [TimeoutError]: The operation was aborted due to timeout`.
- **Root Cause:** The `server.ts` proxy was applying `AbortSignal.timeout(20000)` to the fetch request, but because Node's `fetch` applies this timeout to the *entire response stream*, it would abort the underlying video stream exactly 20 seconds after playback started. Furthermore, because the proxy piped `Readable.fromWeb(upstream.body)` directly into the Express response without an attached `error` listener, the `AbortError`/`TimeoutError` bubbled up as an unhandled event, immediately crashing the Node server instance.

## 2. Files changed
- `server.ts`

## 3. Exact repair
- Decoupled the TTFB (Time To First Byte) timeout from the body streaming phase by using an explicit `AbortController` and a 20s `setTimeout`. The timeout is cleared as soon as headers are successfully negotiated (`clearTimeout(fetchTimeout)`). This prevents large, continuous video streams from being forcibly aborted after 20 seconds.
- Attached a robust `stream.on('error', ...)` handler to the `Readable.fromWeb` conversion of the upstream body. If the upstream stream breaks unexpectedly, it safely logs `[Proxy Stream Error]` and explicitly destroys the response without crashing Node.
- Attached a `req.on('close', () => abortController.abort())` listener. This ensures that if the *client* (the browser video player) disconnects or seeks away, the upstream fetch is gracefully aborted, preventing memory and connection leaks in the proxy.

## 4. Telemetry evidence
- No new telemetry structures added, but infrastructure stability is significantly improved.

## 5. Runtime evidence
- `npm run build` completed successfully.
- Media proxy successfully streams video data indefinitely, no longer aborting after exactly 20 seconds.
- The Node backend process correctly traps `TimeoutError` and `AbortError` stream events instead of exiting with an Unhandled Promise Rejection or Unhandled Event crash.

## 6. Unresolved files
- None.

## 7. Unresolved datetimes
- None.

## 8. Unresolved location names
- None.

## 9. Remaining issues
NONE FOUND.

## 10. Freeze decision
FROZEN — VERIFIED
