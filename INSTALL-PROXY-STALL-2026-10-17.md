# Proxy body-stall watchdog (2 files)
Replace: server.ts, server/archiveFetch.ts (paths as in the zip).
What: if Archive sends headers but no body bytes for 12 s (env ARCHIVE_PROXY_BODY_IDLE_MS), the proxy aborts the slice, logs `[Archive Proxy Body Stall]`, forgets the cached storage node and counts a failed request. No fake success; the player retries and resolves a fresh node.
Why: live timing showed Server-Timing upstream 0.4-1.2 s but TTFB 1.8-3.8 s, i.e. delay is after Archive's headers (body start). A stalled body previously hung until the browser gave up (the 17 s requests).
Verified: tsc --noEmit clean; test:proxy-range passes (source guards only).
NOT verified: the stall path live (the 17 s case was not reproduced). Confirm in Cloud Run logs: search `Archive Proxy Body Stall` and `archive-proxy-slice` (headersMs vs firstByteMs).
