# AJN Builder — Safe News Proxy Repair + Verification Gate

## Objective

Repair the Archive.org news proxy in the sandbox without disturbing the currently-working LIVE deployment.

The observed browser error is:

`PipelineStatus::DEMUXER_ERROR_COULD_NOT_OPEN: FFmpegDemuxer: open context failed`

Apply only the surgical changes in `server.ts.patch.md`.

## Phase 1 — Inspect before editing

1. Locate the actual Archive.org media proxy route.
2. Confirm whether it uses:
   - `require("stream")`
   - `AbortSignal.timeout(...)` across the entire media fetch
   - media `Content-Type` headers before upstream success
   - `Readable.fromWeb(...)` without a stream error handler
3. Record exact file path and line numbers.
4. Do not edit until the existing implementation is identified.

## Phase 2 — Apply

Modify only the existing Archive.org proxy handler.

Required:
- ESM `Readable` import.
- Initialization timeout cleared after headers.
- No media Content-Type on error responses.
- Real 503/appropriate upstream error propagation.
- `Readable.fromWeb` stream error handling.
- Client disconnect abort cleanup.
- Existing bounded retry/backoff behavior preserved.
- Existing News `?start=0&end=300` behavior preserved.

Do NOT modify:
- MinimalPlayer
- PlayerView
- EPG
- Search
- navigation
- channel registry
- News channel mappings

## Phase 3 — Verification

Run:

```bash
npm run build
```

Expected:

```text
exit code 0
```

Then:

```bash
npx tsc --noEmit
```

Expected:

```text
exit code 0
```

### Gate A — Health

```bash
curl -i http://localhost:3000/api/health
```

Expected:

```text
HTTP/1.1 200 OK
```

### Gate B — CNN range

Use the known working CNN Archive path from the current environment.

```bash
curl -v -r 0-1023 \
'http://localhost:3000/api/archive/proxy?path=%2Fdownload%2FCNNW_20260903_210000_The_Lead_With_Jake_Tapper%2FCNNW_20260903_210000_The_Lead_With_Jake_Tapper.mp4%3Fstart%3D0%26end%3D300' \
-o /tmp/cnn-test.mp4
```

Expected:
- HTTP `206 Partial Content` or valid `200 OK` depending on the installed proxy behavior
- `Content-Type: video/mp4`
- non-zero output bytes
- no JSON body

### Gate C — Invalid Archive path

Use a deliberately invalid Archive path.

Expected:

```text
HTTP/1.1 503 Service Unavailable
Content-Type: application/json
```

The body must be JSON, not MP4.

### Gate D — Long stream

Keep a valid CNN request open for at least 60 seconds.

Expected:
- stream remains active past 20 seconds
- server remains alive
- no `require is not defined`
- no `PipelineStatus::DEMUXER_ERROR_COULD_NOT_OPEN`

### Gate E — Client disconnect

Start a valid proxy request and terminate the client connection.

Expected:
- request close is observed
- AbortController cleanup occurs
- upstream connection is released
- Node process remains alive

### Gate F — News regression

Verify:
- Fox News plays.
- CNN plays.
- MSNBC plays.
- Existing News 300-second slicing remains intact.

Expected CNN path contains:

```text
?start=0&end=300
```

## Required final report

Report each gate as:

- TESTED
- EXPECTED
- ACTUAL
- RAW EVIDENCE
- PASS/FAIL

If any gate fails, STOP.

Do not publish.

## Freeze rule

Only after every gate passes:

`AJN NEWS PROXY — VERIFIED`

Then the deployment may be republished.

The currently-working LIVE deployment must remain untouched until this gate passes.
