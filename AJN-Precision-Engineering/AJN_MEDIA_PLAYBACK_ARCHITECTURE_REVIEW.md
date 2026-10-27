# AJN Media Playback Architecture Review

## 1. Executive Summary
The AJN architecture leverages an HTTP media proxy (`/api/archive/proxy`) for Archive.org MP4 files. This proxy is **architecturally required** for sustained success under the current implementation because the browser's `HTMLMediaElement` strictly requires reliable `Range`, `Accept-Ranges`, and CORS headers for continuous seeking and decoding. Archive.org origins frequently enforce redirects, CORS restrictions, or unstable `Range` handling that cause fatal `MEDIA_ELEMENT_ERROR: Format error` or `DEMUXER_ERROR` in the browser when MP4s are consumed directly. A hybrid or self-hosted media architecture is recommended for production-grade reliability.

## 2. Current Playback Architecture
- **TV Guide -> Program selection**: React sets `nowPlaying` state containing a `mediaUrl` or `archivePath`.
- **PlayerView**: Observes `nowPlaying`. When a program ends, it automatically calculates the next program and selects it (Modulo Indexing).
- **MinimalPlayer**: A standard `<video>` tag wrapped in a React ref. It relies on standard browser progressive decoding and seeking using the `src` attribute.
- **Proxy**: If the source is an Archive.org path, it runs through `server.ts` `/api/archive/proxy`.

## 3. Direct Archive MP4 Findings
Direct playback via `HTMLMediaElement` using Archive.org URLs has critical limitations:
- **CORS Headers**: Archive.org does not consistently return `Access-Control-Allow-Origin: *` across all its storage nodes.
- **Redirects (302)**: Requesting the main domain often redirects to a specific storage node (`ia80...`). While `curl` follows this, browser media elements can struggle with range-request redirects, dropping playback.
- **503 Errors**: Direct requests sometimes return 503s with HTML content (as verified via `curl`). If a browser expects MP4 segments but receives an HTML 503 error, a `DEMUXER_ERROR` or format error instantly occurs.

## 4. AJN Proxy Findings
The `/api/archive/proxy` endpoint inside `server.ts` provides:
- **Range forwarding**: Passes the `Range` header to the upstream, and the `Content-Range` back to the client.
- **Timeouts/Retries**: Handles aborted requests (`AbortController`) when the client disconnects or skips.
- **CORS stripping/normalizing**: Serving from the same domain (`localhost:3000` or the Cloud Run domain) entirely bypasses browser CORS policies for the media element.
- **Error masking**: Prevents HTML error pages from being fed directly into the demuxer.
**Conclusion**: The proxy is **REQUIRED** for reliable Archive.org MP4 playback in a browser.

## 5. HLS Findings
There are no active HLS components (like `hls.js` or `video.js` with HLS support) installed or utilized for the Archive.org news channels in the current sandbox. The channels rely strictly on MP4 progressive download and playback.
- **MP4 progressive playback**: Downloads a single large file, using Range requests to seek. Highly susceptible to connection drops.
- **HLS**: Breaks video into discrete `.ts` or `.m4s` chunks via an `.m3u8` playlist. Much more resilient to network instability and upstream node changes.

## 6. Self-Hosted Media Server Analysis
A self-hosted media server (e.g., Nginx, a dedicated Node streaming server, or Object Storage CDN) could replace `/api/archive/proxy`.
- **Solve Range handling / CORS**: Yes, fully.
- **Support HLS**: A self-hosted server could transcode or package the MP4s into HLS playlists on the fly, drastically improving long-running playback reliability compared to progressive MP4s.
- **Introduce additional infrastructure**: Yes, this would move AJN away from a simple single-container proxy into a more complex media caching tier.

## 7. Format Error / DEMUXER Analysis
- **1. invalid URL**: RULED OUT (The proxy handles valid paths).
- **2. bad upstream response**: LIKELY (Archive.org sometimes returns 503).
- **3. HTML returned instead of media**: LIKELY (If Archive.org returns a 503 HTML page, the proxy might forward the 503 but with HTML, crashing the browser demuxer).
- **4. incorrect Content-Type**: POSSIBLE.
- **5. incorrect Range behavior**: LIKELY (Without the proxy).
- **8. CORS**: LIKELY (If direct URLs are used).
- **13. proxy interruption**: POSSIBLE (Node.js streaming can drop).

## 8. Sandbox vs Previous LIVE Comparison
The previously published LIVE version was not continuously tested over many hours. Point-in-time playback success does not guarantee sustained playback reliability. Progressive MP4 streaming over long durations is inherently brittle compared to HLS.

## 9. Required vs Optional Components
- **/api/archive/proxy**: REQUIRED (to normalize CORS and Range requests).
- **HLS.js**: Currently MISSING but HIGHLY RECOMMENDED.

## 10. Architectural Recommendation
**USE HYBRID MP4 + HLS ARCHITECTURE**
While keeping the current proxy is necessary right now, relying on Archive.org to continuously stream multi-hour 2GB MP4 files via progressive download is fundamentally unstable for a "broadcast station." The architecture should migrate to a pipeline where Archive.org assets are either packaged into HLS playlists (to allow resilient chunked downloading) or cached on a dedicated CDN.

## 11. Evidence
- `server.ts` intercepts `/api/archive/proxy` and handles `req.headers.range`.
- Direct `curl -sI` to Archive.org occasionally returns HTTP 503 HTML pages instead of MP4 media.

## 12. Risks
- Archive.org rate limits or blocks the proxy container IPs.
- Long-lived MP4 progressive downloads get terminated by Cloud Run timeouts or node reboots.

## 13. No-Code Next Steps
- Monitor proxy logs for 502/503 responses from Archive.org.
- Evaluate adding `hls.js` if media assets can be converted to playlists.
