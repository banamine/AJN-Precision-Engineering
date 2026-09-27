# `server.ts` surgical repair specification

## Scope

Edit **only the existing Archive.org media proxy handler** in `server.ts`.

Do not replace unrelated server routes. Do not modify:
- MinimalPlayer
- PlayerView
- EPG/guide registry
- Search
- channel definitions
- navigation
- existing News 300-second slicing behavior

## 1. ESM stream import

At the top-level imports, ensure:

```ts
import { Readable } from "stream";
```

Remove any inline CommonJS usage such as:

```ts
require("stream").Readable
```

The project executes as an ES module, so `require` must not be used here.

## 2. Initialization timeout only

Do NOT attach a fixed timeout signal to the entire lifetime of the media stream.

Use an AbortController and a timer that is cleared immediately after Archive.org returns response headers:

```ts
const abortController = new AbortController();

const upstreamTimeout = setTimeout(() => {
  abortController.abort();
}, 20000);

let upstream: Response;

try {
  upstream = await fetch(fetchUrl, {
    headers: upstreamHeaders,
    signal: abortController.signal,
  });
} finally {
  clearTimeout(upstreamTimeout);
}
```

The 20-second limit is an **upstream initialization/header timeout**, not a playback-duration timeout.

After headers arrive, the media body must be allowed to stream for as long as the client remains connected.

## 3. Do not send media Content-Type before upstream success

Do not set `Content-Type: video/mp4` before the upstream request has produced a valid media response.

For a failed upstream request, return a real HTTP error with JSON:

```ts
if (!upstream.ok) {
  res.status(upstream.status >= 500 ? 503 : upstream.status).json({
    error: "Archive upstream unavailable",
    upstreamStatus: upstream.status,
  });
  return;
}
```

Only after `upstream.ok` is confirmed should the proxy copy media headers and stream the body.

This prevents an error JSON payload from being mislabeled as MP4 and causing:

`FFmpegDemuxer: open context failed`

## 4. Preserve range/media headers

For valid upstream media, preserve the headers required by HTML5 media seeking:

- content-type
- content-length
- content-range
- accept-ranges

Also preserve the existing CORS headers.

The incoming request Range header must continue to be forwarded upstream.

## 5. Safe Node stream piping

Use:

```ts
if (!upstream.body) {
  res.status(502).json({ error: "Archive upstream returned no body" });
  return;
}

const nodeStream = Readable.fromWeb(upstream.body as any);

nodeStream.on("error", (err: any) => {
  console.error("[Archive Proxy Stream Error]", err);

  if (!res.headersSent) {
    res.status(502).json({
      error: "Archive media stream failed",
      message: err?.message || "Unknown stream error",
    });
    return;
  }

  if (!res.destroyed) {
    res.destroy();
  }
});

res.on("error", (err: any) => {
  console.error("[Archive Proxy Response Error]", err);
});

nodeStream.pipe(res);
```

Do not leave the converted Readable without an error handler.

## 6. Client disconnect cleanup

Abort the upstream request when the client closes the request before the response has finished:

```ts
let responseFinished = false;

res.on("finish", () => {
  responseFinished = true;
});

req.on("close", () => {
  if (!responseFinished) {
    abortController.abort();
  }
});
```

This prevents dangling upstream Archive.org connections when the user:
- changes channels
- seeks
- closes the player
- navigates away

## 7. Retry policy

Keep retries bounded and conservative.

For Archive.org:
- retry only transient 429/500/502/503/504 failures
- use exponential backoff
- never retry indefinitely
- do not run parallel retries for the same media request
- do not turn an upstream error body into a successful 200 response

A reasonable ceiling is 3–5 attempts depending on the existing implementation.

## 8. News behavior that MUST remain unchanged

Preserve existing TV News slice behavior:

```text
?start=0&end=300
```

Do not remove or rewrite the existing News slicing logic.

The repair is strictly about delivering the valid Archive.org response to the player safely.

## 9. Required anti-pattern checks

Before Builder reports completion, run:

```bash
grep -RniE 'require\\(["'\"']stream|AbortSignal\\.timeout\\(|Content-Type.*video/mp4|Math\\.random\\(|fallback.*Night.*Living.*Dead' server.ts src 2>/dev/null
```

The result must be reviewed manually. Do not blindly delete existing valid timeout usage belonging to unrelated providers.

## 10. Critical rule

The current LIVE deployment is working.

Therefore:

**SANDBOX FIRST → BUILD → RUNTIME GATES → ONLY THEN REPUBLISH**

Do not publish an unverified edit.
