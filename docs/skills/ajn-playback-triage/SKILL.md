---
name: ajn-playback-triage
description: Triage AJN video/audio that won't play — proxy range slices, Cloud Run 32 MiB limit, URL encoding, codec, CORS, embeds, HLS cleanup order, and circuit-breaker fallbacks.
---

# AJN playback triage

Work top-down; stop at the first failing layer.

1. **URL** — open the raw source with `curl -sI`. 404/403 → source issue (check `private`, path encoding per segment).
2. **Proxy** — `curl -s -D - -o /dev/null -H "Range: bytes=0-" "$BASE/api/archive/proxy?url=..."`. Expect 206, `Content-Range`, `Accept-Ranges: bytes`, length ≤ 8 MiB. A 200 full body or > 32 MiB = bounded-slice regression.
3. **SSRF** — every proxy route uses `isUrlSafe`; blocked legit host → fix the allow rule narrowly, never disable.
4. **Codec** — need h.264/AAC MP4 for broad support; HEVC/MPEG-2 originals fail in Chrome.
5. **Element** — read `video.error.code` (3 decode, 4 unsupported/network). Read state from the DOM node (`currentTime`, `readyState`), not lagging React state.
6. **Embeds** — Rumble/YouTube stay iframes.
7. **HLS (if present)** — cleanup `stopLoad → detachMedia → destroy → null`. Missing cleanup leaks SourceBuffers on long runs.
8. **Fallback** — backup stream via circuit breaker is OK if it's labeled; BigBuckBunny or silent substitutes are not.
9. **Disconnect** — proxy aborts upstream on client close (`AbortController`, `req.on('close')`).

## Report
Failing layer, evidence (command + output), minimal fix in one file, verify command.
