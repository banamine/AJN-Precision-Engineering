# Classic TV lazy loading, video prefetch, Archive cooldown, and thumbnail lane

Status: Phase 1 measurements and implementation / focused verification are complete for Items 1–4. No item is deployed or live-tested against Archive.

## Base and safety

- Branch: `feat/classic-lazy-prefetch-lanes`
- Base: `origin/main` at `68bd8d55a4a6bc0f41bc27a290700cb20b6c8248`, plus `AJN_two_rounds.patch` and the owner’s `AJN_Replit_Base_Overlay_2026-10-18.zip`.
- The overlay did not contain `server.ts` or `server/archiveFetch.ts`; both remained the versions from the two-round patch.
- Node: `v22.22.0`. Baseline `NODE_OPTIONS=--max-old-space-size=1200 npm run lint` (`tsc --noEmit`) passed.
- Archive access: zero requests were sent to Archive.org. Schedule assembly used injected `fetch` stubs. Chromium tests intercepted the image URLs before network dispatch and fulfilled them with synthetic SVGs. External request count sent: 0.

## Phase 1 — investigation and measurements

### 1. Classic TV guide payload and consumers

Measured current `classic-tv` owner manifests in memory:

| Measurement | Result |
|---|---:|
| Channels / programs | 400 / 26,050 |
| Full JSON raw size | 31,762,790 bytes (30.29 MiB) |
| Gzip level 5 size | 2,869,276 bytes (2.74 MiB) |
| Schedule assembly | 3,083.8 ms |
| JSON serialization | 474.71 ms |
| Node JSON.parse, five runs | 101.17–191.20 ms; mean 127.68 ms |
| Chromium JSON.parse, production build | 932.8 ms |
| Chromium time to interactive guide | 3,117.2 ms |
| Chromium heap after load / after search | 38,046,139 / 39,552,385 bytes |
| First page rows / long tasks | 40 / 10; maximum 663 ms |
| Search after initial load | 1,514.1 ms |

The largest channel has 1,280 programs and serializes to 1,425,453 bytes; its first three program rows serialize to approximately 2,445 bytes. A compact per-channel title index contains 18,046 unique channel-title pairs: 925,641 raw bytes / 226,694 gzip bytes. Including that title index in the initial light response was measured and exceeded the 2 MiB raw target, so the implementation uses a separate on-demand title-search route instead.

Consumers and current behavior:

- `src/EpgGuide.tsx` fetches the full default `/api/schedule` payload, uses every program for timeline blocks and title search, and passes selected programs into tune/auto-advance. The aired-time badge reads program metadata.
- `server.ts` supports `?channel=<id>` and returns that channel’s full rows. `src/components/PlayerView.tsx` uses this channel-limited route to resolve next programs.
- `src/components/TodayView.tsx` fetches the default full guide payload for its selected guide.
- `src/guide/loadSchedule.ts` is the shared full-payload loader used by Home surfaces (currently `cable-tv` and optional audio guides); it caches in memory.
- Home snapshot/library routes include `/api/home/classic-48h`, guide playlist/EPG exports, and internal guide snapshots. They are separate consumers and should not be silently switched to a partial guide response.
- `test-infobattalion-lists.ts` has the 32 MiB Classic schedule budget. The measured 30.29 MiB raw schedule is below it.
- `test-music-schedule-budget.mjs` now checks compressed wire bytes from `Content-Length` separately from decoded raw bytes from `Response.arrayBuffer()`. A local gzip-server probe confirmed that Node’s fetch transparently decompresses the body while preserving the compressed `Content-Length` (1,052 wire bytes / 1,048,576 decoded bytes). The existing full endpoint and its output are unchanged.

An initial in-memory light-shape measurement including both all title strings and current+next-two rows was 2,421,739 bytes raw / 421,941 gzip, above the 2 MiB raw target. The title strings alone were 925,641 bytes raw. To keep the initial light payload below the target, the implementation uses an additive `?light=1` response with channel metadata and current+next-two rows, plus a separate on-demand server-side title search route. The default response and existing `?channel=` response remain unchanged. The guide fetches full rows only as a channel enters the viewport or is tuned/opened, with four concurrent requests and a session-memory cache. The light response is capped at 2 MiB raw.

### 2. Next-episode video prefetch

- `src/MinimalPlayer.tsx` already has audio-only next-track preloading; it exits for video/HLS and uses a 45-second lead threshold for the audio path.
- `src/components/PlayerView.tsx` loads a channel’s full schedule and chooses the next item for end-of-item advance, but it does not expose a guarded video-prefetch target to the player.
- `server/proxyRange.ts` defaults to an 8 MiB maximum media slice. The proxy passes explicit ranges and successful media responses are `private, max-age=3600`.
- No next-video range prefetch currently exists. It must use the existing `/api/archive/proxy`, request exactly bytes `0-1048575`, and only consider the next Archive proxy item in the same guide/channel. Playback buffering, pause >5 minutes, hidden tab, save-data, item change, 429/5xx, non-Archive/signed URLs and HLS must prevent or cancel it. No second player element is needed.

### 3. Retry-After and Archive cooldown

- `server/archiveFetch.ts` retries 429, 500, 502, 503 and 504 up to three attempts using fixed 400/800 ms backoff; it does not parse `Retry-After`.
- Stubbed media fetch: `429 Retry-After: 2` was retried after about 400 ms and then succeeded; no-header 429 also retried after about 400 ms. The header had no effect.
- Stubbed API fetch: two 429 responses started 121 ms apart, matching the current 120 ms API limiter gap; no shared cooldown was set.
- `server/archiveLimiter.ts` limits Archive API calls but has no Retry-After handling or per-host shared cooldown. The media proxy uses its separate media retry path.
- The client therefore sees the eventual retry result (for example, a later 206) instead of a rate-limit response that tells it when to retry. The implementation will follow Prompt D’s limits: at most 10 seconds per hop and 20 seconds total; longer requested waits stop retrying and return an explicit rate-limit response with `Retry-After`. Abort must cancel waits; concurrent requests to the same upstream host must share the cooldown.

### 4. Thumbnail lane

Current paths:

- `src/components/LazyThumb.tsx` uses `IntersectionObserver` with a 300 px root margin.
- `src/components/ChannelLogo.tsx` renders logos directly with native lazy loading.
- `src/components/Thumb.tsx` can request Archive `/services/img/<id>` thumbnails and frame images directly; these are not routed through `/api/archive/proxy` and do not use the server API limiter.
- A production guide first-paint probe on the current owner manifest intercepted and aborted 12 Archive image requests before network dispatch. No media-proxy or API-limiter slots were consumed.
- Synthetic Chromium baseline: 100 synthetic channels, 40 DOM rows, 1,440×1,000 viewport. In 700 ms, 19 synthetic image requests were stubbed; maximum simultaneous image loads was 13. No Archive request was sent.

The image load path needs one global browser-side lane shared by `LazyThumb` and `ChannelLogo`, capped at four. It should continue using direct Archive thumbnail images (not the playback proxy), lazy loading, async decoding, fixed dimensions, and the existing candidate order. Failed candidates must end in a neutral placeholder with the title, not unrelated Show Art.

## Item 1 — implementation and verification

### Implementation

- Added `GET /api/schedule?guide=classic-tv&light=1&tz=<Date#getTimezoneOffset()>`. It returns channel metadata, the current program plus up to two following rows, total program count, source state, playlist label, and `programsComplete:false`. The route rejects other guide IDs before loading any schedule. The existing default full payload and `?channel=<id>` response are unchanged.
- Light payload construction is pure and timezone validation is explicit. A current owner-manifest measurement produced 400 channels, 1,197 light program rows, 1,545,937 raw bytes (1.47 MiB), and 202,326 gzip bytes (0.19 MiB), below the 2 MiB raw cap.
- Added `GET /api/schedule/search?guide=classic-tv&q=...`; it searches every title server-side without placing the full title catalog in the first response. It preserves the existing AND behavior across channel name, group, station number, and titles, including terms split between channel metadata and a hidden title.
- `EpgGuide` uses light mode only for Classic TV, then loads full rows when a channel is in the viewport or is opened/tuned. A shared in-memory pool caps row fetches at four concurrent requests; successful full rows are cached per session. Failed rows stay in an explicit error state and require the visible Retry action; a browser test exposed and verified a fix for a stale observer callback that otherwise retried a failed row automatically.
- Corrected the schedule-size test to assert actual wire bytes separately from decoded bytes, and fixed its advisory branch to refer to `rawBytes`. No dependency or lockfile changes.

### Verification

| Check | Result |
|---|---|
| Node | `v22.22.0` |
| `NODE_OPTIONS=--max-old-space-size=1200 npm run lint` (`tsc --noEmit`) | PASS |
| `npm run build` | PASS: Vite built 1,857 modules in 20.40 s; server bundle completed in 3.972 s. Existing large-chunk (>500 kB) and 25.6 MiB server-bundle warnings remain. |
| `npx tsx test-classic-light-schedule.ts` | PASS: now + next two, no invented future rows, empty/restricted row, timezone validation, 2 MiB cap, complete-title and mixed name/title search |
| `npx tsx test-channel-schedule-pool.ts` | PASS: maximum concurrency 4; queued abort removed before execution |
| `node --import tsx test-classic-light-guide.mjs` | PASS at 390×844 and 1440×800 with synthetic fixture: 40 initial rows; 80 after Load more; one request for visible channel 048; one initial/in-flight request for tune of 001; channel 050 produced one 503 and one explicit retry; one hidden-title query per viewport |
| `node test-music-schedule-budget.mjs http://127.0.0.1:<fixture-port>` | PASS against local synthetic HTTP server: gzip wire bytes and decoded raw bytes separated; audio/classic music membership and XML program counts match. |
| `npx tsx test-infobattalion-lists.ts` with injected blocking fetch | PASS; 32 Archive fetches were intercepted and blocked by the stub before outbound dispatch. |
| Browser network guard | 0 Archive requests and 0 external requests in both viewports |

The browser fixture delays the full response for channel 001 so tuning is verified while that response is still pending. Channel 050’s two requests are expected and counted: first synthetic 503, then one user-triggered Retry. The total 28 local API calls in the final viewport included 1 light schedule request, 1 title-search request, and 26 per-channel requests (including the single failed row attempt plus its explicit retry); the separate `?channel=demo-channel-048` count was exactly one.

## Item 2 — implementation and verification

### Implementation

- Added `src/utils/videoPrefetch.ts`, an event-driven controller attached to the existing `HTMLMediaElement`. It only considers a video whose current and next source are unsigned same-origin `/api/archive/proxy?path=/download/...` paths; `.m3u8`, direct/external/signed URLs, audio, HLS, unknown/different guide or channel, and `saveData` are excluded.
- It resolves the next schedule item only after the current video is playing, not ended or paused, readyState is at least 3, no `waiting`/`stalled` state is active, the document is visible, and the playhead has reached 60% or has 90 seconds or less remaining. `PlayerView.resolveNext` now carries the selected item’s guide and channel identity so the helper can reject cross-list targets.
- The single low-priority GET is sent to the existing proxy with `Range: bytes=0-1048575`; it accepts only a 206 response with a valid starting byte range and consumes no more than 1 MiB. It never retries a failed response. Buffering, hidden tab, a five-minute sustained pause, or player cleanup/item change aborts an in-flight request.
- Added `playback.prefetch` telemetry fields `nextPath`, `bytes`, `ms`, and `outcome`. Audio preloading remains on the existing path; HLS/player ownership and cleanup are unchanged.
- A first browser test identified that a proxied `.m3u8` target could otherwise pass the Archive path predicate; HLS playlists are now explicitly rejected.

### Verification

| Check | Result |
|---|---|
| `npx tsx test-video-prefetch.ts` | PASS: exactly 1 request, exact Range and `priority: low`; 60% and ≤90 s thresholds; same-guide/channel; external/signed/HLS/audio/saveData/buffering exclusions; no retry after 429/503; cancellation on buffering/hidden/5-minute pause/item cleanup; telemetry outcome/byte/time fields |
| `node --import tsx test-video-prefetch-local.mjs` | PASS, synthetic local HTTP proxy only: across three runs cold first byte 184–195 ms and warmed-cache playback 3–9 ms; exactly two Range requests to the warm synthetic path (prefetch + playback); 0 Archive requests |
| `NODE_OPTIONS=--max-old-space-size=1200 npm run lint` | PASS after integration |
| Archive access | 0 outbound requests; no real media request was made |

The local server demonstrates the expected warm-versus-cold behavior under its artificial delay; it is not evidence of Archive or Cloud Run cache latency. Actual browser HTTP-cache reuse, device-specific fetch priority, and playback behavior against a live proxy remain unverified.

## Item 3 — implementation and verification

### Implementation

- Added `server/archiveCooldown.ts`: accepts delta-seconds (including fractional seconds) and HTTP-date `Retry-After` values, and maintains one shared timer/promise per upstream hostname. The production instance is shared by media retries and `archiveApiFetch`; the store can be injected in tests.
- Media retries honor a valid `Retry-After` instead of applying the old fixed delay. A request waits only when the shared host wait is at most 10 seconds and its cumulative wait budget stays at or below 20 seconds. Longer waits (or a valid wait when no attempts remain) return a structured rate-limit result without waiting. Requests with no valid header retain the prior 400/800 ms exponential backoff.
- The proxy turns the structured result into HTTP 429 (for upstream 429) or 503 (for other retryable statuses), sets the client `Retry-After` header, and returns JSON `{error,retryAfterSeconds,attempts,proxyRequestId}`. This branch runs before the image fallback, so a throttle is not hidden by a placeholder.
- `archiveApiFetch` checks the same host cooldown before dispatch and records `Retry-After` from 429/503 responses; a host in an over-budget cooldown is rejected before another Archive API request is sent.
- Waits are abortable per caller; aborting one waiter does not cancel the shared timer or release other waiters early. Existing redirect validation remains intact.

### Verification

| Check | Result |
|---|---|
| `npx tsx test-archive-retry.ts` | PASS: 17 stubbed scenarios, including all 9 existing redirect/retry/network-abort cases, delta-seconds 2 s, excessive 120 s immediate JSON/Retry-After response mapping, HTTP-date, missing-header fallback, abort, concurrent same-host single timer, a real-time 2 s stubbed retry, and shared API dispatch gate |
| Real-time stub check | PASS: 206 after 2,003 ms; `FetchImpl` was fully stubbed, no Archive network request |
| `NODE_OPTIONS=--max-old-space-size=1200 npx tsc --noEmit` | PASS |
| `npx tsc --noEmit` with default heap | First attempt exited 134 at the Node ~788 MiB heap limit. Re-running with the repository’s established 1,200 MiB heap setting passed; no source change was needed for this environment limit. |
| Archive access | 0 outbound requests; every Archive-shaped URL in tests was handled by `FetchImpl` stubs or blocked before `fetch` |

The concurrent test verifies a single shared cooldown timer and that both retries wait for it. Real upstream behavior and Cloud Run concurrency are not tested; those require a live environment and were intentionally not exercised.

## Item 4 — implementation and verification

### Implementation

- Added `src/utils/thumbnailLane.ts` with a single FIFO browser-module queue capped at four active image loads. `src/components/LaneImage.tsx` waits until the image is within a 300 px viewport margin, obtains a slot before setting `src`, uses native `loading="lazy"`, `decoding="async"`, and `fetchPriority="low"`, and releases its slot on load, error, or unmount.
- The lane is shared by `ChannelLogo`, `Thumb` (therefore `LazyThumb` and Library cards), Today view thumbnails, EPG program-cell images, Home Broadcast Hub images, and Police Chase reel thumbnails. All existing URLs/candidate order are retained; image candidates remain direct image requests rather than being routed through the media proxy.
- Removed the `ajnArtFor` show-art fallback from the EPG/Home Live Strip thumbnail input. After the candidate chain is exhausted, `Thumb` renders the existing neutral title/initials tile. The item-image URL remains `https://archive.org/services/img/<id>` as covered by the existing thumbnail utility regression.
- EPG cell markup retains the original thumbnail URL in inert `data-lane-src` metadata for the pre-existing server-rendered markup contract; the browser does not assign it to `src` until the image queue grants a slot.
- Did not change CSP. No Content-Security-Policy / `img-src` declaration was found in the inspected repository source. The browser test blocks all non-local requests and uses local synthetic image responses; effective deployed CSP and privacy-extension behavior remain unverified.

### Verification

| Check | Result |
|---|---|
| `node test-thumbnail-lane.mjs` | PASS, Chromium 1280×800 synthetic fixture: 40 logo loads admitted; 4 active / 36 queued at start; maximum observed image concurrency 4; a local synthetic media request started with all 4 image slots occupied and returned in 5–22 ms across four runs while the image stub was delayed 400 ms; visible `LazyThumb` joined the same queue; offscreen `LazyThumb` issued 0 requests; forced local failure showed the neutral title tile |
| Browser network guard | 0 requests to Archive.org and 0 external requests; all synthetic image/media responses were local interception fixtures |
| `npx tsx test-thumbnail.ts` | PASS: identifiers, direct Archive item-image URL, candidate ordering, backups, captured-frame acceptance, and episode frame selection |
| `npx tsx test-channel-logo.tsx` | PASS: safe URL handling, lazy/async image markup, fallback and logo asset checks |
| `NODE_OPTIONS=--max-old-space-size=1200 npx tsc --noEmit` | PASS |
| `git diff --check` | PASS |

The local browser test establishes queue behavior, not actual Archive image availability, browser CSP acceptance in deployment, or Cloud Run scheduling.

## Final verification and delivery status

### Commands and observed output

All commands below were run in this worktree on Node `v22.22.0`. Test environments were local fixtures, injected stubs, or headless Chromium with non-local requests blocked.

| Command | Observed output / result |
|---|---|
| `NODE_OPTIONS=--max-old-space-size=1200 npm run lint` | Exit 0; npm ran `tsc --noEmit`; no diagnostics. |
| `npm run build` | Exit 0; Vite `1860 modules transformed`; built in `15.15s`; esbuild server bundle `25.6mb` in `2969ms`. Existing warnings: JS chunk `1,485.90 kB` exceeds 500 kB; server bundle `25.6mb`. |
| `npx tsx test-classic-light-schedule.ts` | `PASS classic-light-schedule: now+next2, title index, empty/restricted rows, timezone validation, 2 MiB budget` |
| `npx tsx test-channel-schedule-pool.ts` | `PASS channel-schedule-pool: max concurrency 4; queued abort removes job before execution` |
| `node --import tsx test-classic-light-guide.mjs` | `PASS classic-light-guide...`; phone 390×844 and desktop 1440×800 each: 40 initial rows, 80 after Load more, one visible fetch, one tune fetch, one search; 28 local API requests; 0 Archive and 0 external requests. |
| `npx tsx test-video-prefetch.ts` | `PASS video-prefetch: exact 1 MiB low-priority Range; 60%/90 s thresholds; archive/same-channel gates; no retry; save-data/buffering gates; hidden/pause/item-change cancellation; telemetry` |
| `node --import tsx test-video-prefetch-local.mjs` | `PASS video-prefetch local warm-cache timing`; latest run cold 195 ms, warm 3 ms, two local Range requests, 0 Archive. |
| `npx tsx test-archive-retry.ts` | Exit 0; original redirect tests and Retry-After tests all passed: 2 s delta, 120 s immediate response, HTTP-date, no-header 400 ms fallback, abort, shared concurrent cooldown, real-time 2,003 ms stub wait, and API dispatch gate. The test’s final line: `archive retry regression: all passed`. |
| `node test-thumbnail-lane.mjs` | `PASS thumbnail lane...`; latest run: 4 maximum active images; 40 logos admitted; 36 queued; synthetic media began with 4 image slots active and returned in 11 ms vs 400 ms image delay; visible lazy thumbnail used same lane; offscreen request count 0; neutral tile; Archive/external 0. |
| `npx tsx test-thumbnail.ts` | `thumbnail regression: all passed`; `thumbnail music genre: PASS` |
| `npx tsx test-channel-logo.tsx` | `channel logo regression: all passed` |
| `npx tsx test-player-honesty.tsx` | `player honesty: all passed` |
| `npx tsx test-epg-tune-window.ts` | `PASS epg tune/window` |
| `npx tsx test-group-programs-for-grid.ts` | `grouping tests passed` |
| `npx tsx test-guide-channel-index.ts` | `[guide-channel-index] PASS — sort, station numbers, categories, search; 1500x130 index 151 ms, search 2.9 ms` |
| `NODE_ENV=test npx tsx test-archive-item-guide.tsx` | `archive item guide hermetic tests: ALL PASS (in-memory fixtures, 0 Archive attempts / 0 outbound requests)`; final fixture count 59 channels / 3,697 rows / 210 Unsorted rows. Existing SSR path assertion remains unchanged and passes. |
| `npx tsx test-epg-aired-time.tsx` | All four cases passed: valid label/UTC tooltip/accessibility, mobile focus overlay, missing time, malformed time. |
| `npx tsx test-proxy-range.ts` | `proxy hardening contract source guards: structural source checks passed; not behavior tests` |
| `npx tsx test-archive-url-exact.ts` | `archive exact-URL regression: all passed` |
| `node --input-type=module -e '<local gzip fixture server; imports test-music-schedule-budget.mjs>'` | PASS; audio fixture 713 compressed / 42,967 decoded bytes, 26 channels / 25 music / 26 program and XML entries; Classic fixture 157 compressed / 1,679 decoded bytes, 1 channel / 1 program and XML entry. Localhost only. |
| `node --import tsx --input-type=module -e '<global fetch stub; imports test-infobattalion-lists.ts>'` | `infobattalion lists OK { tvx: 46, movies: 17, audio: 71 }`; `{"stubbedFetchCalls":32,"outboundArchiveRequests":0}` |
| `git diff --check 68bd8d55a4a6bc0f41bc27a290700cb20b6c8248..HEAD` | Exit 0; no whitespace errors. |

The initial unbounded-heap `npx tsc --noEmit` run exited 134 at Node’s ~788 MiB heap limit; the repository-prescribed `NODE_OPTIONS=--max-old-space-size=1200 npm run lint` then passed. A first invocation of the browser guide test without `--import tsx` could not resolve an extensionless TypeScript import; rerunning with the TSX loader passed. The first final-suite execution surfaced the unchanged archive-item-guide SSR contract described above; the inert `data-lane-src` attribute preserved it and the unchanged test passed.

### Verified / not verified

| Area | Status | Evidence or reason |
|---|---|---|
| Item 1: light Classic schedule, on-demand full rows, search and retry | VERIFIED in local tests | 400-channel owner manifest measurement and Chromium synthetic phone/desktop results above; request counts include zero Archive. |
| Item 2: guarded next-video first-slice prefetch | VERIFIED in unit and local synthetic HTTP tests | Exact Range, constraints/cancellation, one request, telemetry; artificial-delay local cache timing improves first-byte result. |
| Item 3: Retry-After parsing, caps, shared cooldown and error payload mapping | VERIFIED in injected-fetch tests | Delta, date, caps, abort, concurrent single timer, JSON/header mapping and 2-second real-time stub wait. |
| Item 4: shared four-slot thumbnail lane | VERIFIED in headless Chromium synthetic test | Max concurrency 4; offscreen 0; independent media latency; neutral failure tile. |
| Archive outbound request count | VERIFIED: 0 | Browser request guards, injected `FetchImpl`, global fetch block for the list test, and localhost-only synthetic servers. |
| Real Archive media / thumbnail latency | NOT VERIFIED | Explicitly prohibited; no requests were sent to Archive.org. |
| Physical phone behavior | NOT VERIFIED | Tested only headless Chromium at phone viewport width 390 px and desktop width 1440 px. |
| Deployed CSP/privacy extensions | NOT VERIFIED | Repository source search found no explicit CSP directive; no live browser/deployed response was consulted. CSP was not loosened. |
| Cloud Run runtime, concurrency and cache behavior | NOT VERIFIED | No deploy or production request was authorized. |
| Proxy rate-limit HTTP route end-to-end | NOT VERIFIED | Pure rate-limit response mapping, route code, typecheck, build and stubbed fetch tests pass; no live upstream or full HTTP route injection was performed. |

### Risks and rollback

- `fetchPriority="low"` is advisory and browser-dependent. The four-slot image cap is global to this page’s loaded module; separate tabs/iframes have independent queues.
- An image request that never reaches load/error continues to hold its slot until unmount. It cannot exceed the cap, but may stall queued thumbnails; media is on a separate lane.
- The cooldown is in-memory per process and per exact hostname; restarts clear it, and different Archive storage hostnames have separate cooldown entries.
- Roll back the complete Prompt D change set with `git reset --hard 80ad5ff` (the assembled base). No rollback was performed.
- The inspected `BUILDER_KNOWN_ISSUES.md` states the canonical tree was historically `fix/p1`; this task followed the owner’s explicit Prompt D base and branch request (`origin/main` + `AJN_two_rounds.patch` + uploaded owner overlay).

## Package notes

- ZIP contents are the final versions of changed files compared with `origin/main` at `68bd8d55a4a6bc0f41bc27a290700cb20b6c8248`, at their repository-relative paths. `package-lock.json` and audit changes are absent.
- `scripts/render-epg-aired-badge-screenshots.tsx`, `test-epg-aired-preview.html`, `test-epg-aired-preview.tsx`, and `test-epg-aired-preview-logo.svg` are preview-only helpers and are intentionally excluded from the ZIP; they remain in the combined patch.
- Item commits (one per item): `feat: lazy-load classic TV guide schedules`; `feat: prefetch next Archive video slice`; `fix: honor shared Archive Retry-After cooldowns`; `feat: limit thumbnails to a shared four-slot lane`. Base assembly: `80ad5ff`.
