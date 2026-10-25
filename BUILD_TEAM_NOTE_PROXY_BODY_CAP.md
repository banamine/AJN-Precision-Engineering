# Note for ChatGPT (build team): proxy body cap, add to the proxy 429 prompt

Separate from the captions drop-in. Evidence 2026-10-16 (Replit): an Archive clip request WITHOUT a Range header returned 200, 8,912,827 B (8.5 MiB). Requests WITH `Range: bytes=0-8388607` returned 206.
The shared proxy asks Archive for an 8 MiB range (`server/proxyRange.ts`), but its stream path does not enforce a body cap if Archive ignores Range and answers 200. A full 200 over 32 MiB breaks Cloud Run.

Add to `AJN_Proxy_429_Retry_Fix_BuildTeam_Prompt_2026-10-16.md` scope:
- In the `/api/archive/proxy` handler (`server.ts`, `fetchArchiveMediaWithRetry` path): if the upstream answers 200 to a Range request, stop reading at `PROXY_SLICE_BYTES`, answer 206 with a correct `Content-Range`/`Content-Length`, abort the upstream (AbortController), and never stream more than the cap.
- Test (fake upstream): upstream ignores Range and sends 20 MiB -> client receives exactly 8 MiB with status 206 and the upstream is aborted.
- Redirect hop count for clip requests was not captured; log it (status + hop count, no bodies).
