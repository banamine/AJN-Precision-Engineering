# AJN Server.ts Surgical Repair

## Scope

Only `server.ts` was modified in this repair. The Archive.org media proxy handler was repaired without changing PlayerView, MinimalPlayer, EPG, channels, navigation, or guide logic.

## Repairs

- Added ESM `Readable` import from `node:stream`.
- Changed the Archive initialization timeout to an `AbortController` + 20-second header timeout that is cleared immediately after `fetch()` returns headers.
- Preserved the incoming Range request and the existing 2 MB bounded upstream range behavior.
- Refused invalid Range syntax with HTTP 416 JSON.
- Refused upstream responses that ignore a requested Range.
- Do not label an upstream failure as `video/mp4`; failed upstream responses are JSON HTTP errors.
- Preserved upstream `Content-Type`, `Content-Length`, `Content-Range`, and `Accept-Ranges` when present.
- Added explicit Node stream error handling with `Readable.fromWeb()`.
- Added response error logging.
- Added client-disconnect cleanup that aborts the upstream request and destroys the converted stream.
- Preserved bounded retry behavior for transient Archive.org statuses.
- Preserved existing News `?start=0&end=300` behavior because the proxy does not rewrite that application-level slicing logic.
- Added validation that `Content-Range` and `Content-Length` are internally consistent before media headers are sent.

## Important transport invariant

The proxy must never advertise a byte range/body length different from the body it is sending. A 2 MB clamped response must advertise the corresponding bounded `Content-Range` and `Content-Length` returned by the upstream request.

## Verification status

The source repair was applied to the existing drop-in project archive. Full dependency-backed `tsc`/production build verification could not be completed in this isolated runtime because dependency installation timed out. No LIVE deployment was performed.
