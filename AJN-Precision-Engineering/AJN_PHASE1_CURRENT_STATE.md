# AJN PHASE 1 CURRENT STATE

## 1. SERVER STATE
- **Server Running:** Yes
- **Port:** 3000
- **`/api/health` result:** `{"uptime":1842.257978386,"stats":{"totalRequests":1,"successfulRequests":0,"retriedRequests":0,"failedRequests":0,"cacheHits":0,"lastUpstreamLatencyMs":599,"activeStreams":0}}`
- **HTTP status:** 200 OK
- **Content-Type:** `application/json; charset=utf-8`
- **Valid JSON:** Yes

## 2. EXACT CURRENT SOURCE FILES
Below are the details for the targeted files:

- `/server.ts`
  - **Exists:** Yes
  - **Approx Line Count:** 267 lines
  - **Modification Timestamp:** ~07:36
  - **Current Function:** Express server handling API routing, schedule fetching, and the critical `/api/archive/proxy` logic handling streaming media.
  - **Relates to recent playback/telemetry changes:** Yes (proxy stream management directly affects playback).

- `/channels.ts`
  - **Exists:** Yes
  - **Approx Line Count:** 133 lines
  - **Modification Timestamp:** ~07:25
  - **Current Function:** Static channel configuration and definitions.
  - **Relates to recent playback/telemetry changes:** No.

- `/guideRegistry.ts`
  - **Exists:** Yes
  - **Approx Line Count:** 194 lines
  - **Modification Timestamp:** ~07:12
  - **Current Function:** Manages channels, playlists, schedules, and routing schedules.
  - **Relates to recent playback/telemetry changes:** Moderately (supplies media URLs and metadata).

- `/src/MinimalPlayer.tsx`
  - **Exists:** Yes
  - **Approx Line Count:** 631 lines
  - **Modification Timestamp:** ~07:58
  - **Current Function:** Core HTML5 `<video>` logic, segment loading, health monitoring, URL parsing, and playback event triggers.
  - **Relates to recent playback/telemetry changes:** Yes (Core component where playback fails or succeeds).

- `/src/components/PlayerView.tsx`
  - **Exists:** Yes
  - **Approx Line Count:** 384 lines
  - **Modification Timestamp:** ~08:00
  - **Current Function:** Wrapper for `MinimalPlayer`, includes Dev Diagnostics UI, playback event logging (`logPlaybackEvent`), and schedule auto-advance logic (`handleProgramEnded`).
  - **Relates to recent playback/telemetry changes:** Yes (Telemetry logging and playlist advancement).

- `/src/components/TvGuideView.tsx`
  - **Exists:** Yes
  - **Approx Line Count:** 188 lines
  - **Modification Timestamp:** ~07:59
  - **Current Function:** Renders guide tabs and controls dual-guide selector switcher.
  - **Relates to recent playback/telemetry changes:** No.

- `/src/EpgGuide.tsx`
  - **Exists:** Yes
  - **Approx Line Count:** 236 lines
  - **Modification Timestamp:** ~07:59
  - **Current Function:** Displays the EPG grid and handles clicks to launch a program.
  - **Relates to recent playback/telemetry changes:** No.

- `/src/telemetry.ts`
  - **Exists:** Yes
  - **Approx Line Count:** 41 lines
  - **Modification Timestamp:** ~07:12
  - **Current Function:** Telemetry payload typing and the `reportTelemetry` wrapper.
  - **Relates to recent playback/telemetry changes:** Yes.

- `/src/types.ts`
  - **Exists:** Yes
  - **Approx Line Count:** 161 lines
  - **Modification Timestamp:** ~07:12
  - **Current Function:** Shared TypeScript types and interfaces.
  - **Relates to recent playback/telemetry changes:** No.

## 3. PLAYBACK PIPELINE
**Trace of current path:**
1. **TV Guide:** `TvGuideView.tsx` renders the guide container.
2. **Program Selection:** In `EpgGuide.tsx`, the `onClick` handler of a program element triggers the `onSelectProgram?.(program.archivePath || program.mediaUrl, ...)` callback.
3. **nowPlaying:** The parent state updates to hold `nowPlaying` media context.
4. **PlayerView:** `PlayerView.tsx` mounts and renders `<MinimalPlayer>` with `nowPlaying` properties.
5. **MinimalPlayer / activeSrc:** `<MinimalPlayer>` receives `src` and initializes `videoRef`.
6. **video.load():** Triggered in a `useEffect` inside `MinimalPlayer.tsx` (`vid.load()`), clearing status text to "Loading…".
7. **video.play():** Executed explicitly via `handleTogglePlay()` logic or `.play()` promises resolving in `MinimalPlayer.tsx`, updating status to "Playing".
8. **onEnded:** HTML5 `<video>` triggers the local `handleEnded()` method inside `MinimalPlayer.tsx`. It delegates to `onProgramEnded` prop after 1.5s delay.
9. **next program:** `handleProgramEnded` in `PlayerView.tsx` calls `fetch('/api/schedule...')` to locate the current `nowPlaying.src` index and load the subsequent item.

## 4. TELEMETRY
- **Where generated:** Within `src/components/PlayerView.tsx` (`logPlaybackEvent` function calls it on play, pause, error, ended) and dispatched to `src/telemetry.ts` (`reportTelemetry`).
- **Where displayed:** A Dev Diagnostics overlay visible in `PlayerView.tsx`.
- **Console-only:** Yes, `reportTelemetry` executes a `console.log('[AJN TELEMETRY] ...')` but does not issue a network `fetch()` to a backend collector.
- **Visible to normal users:** No. Obscured behind a DEV environment variable check (`(import.meta as any).env?.DEV`).
- **Math.random() usage:** Yes. Inside `src/telemetry.ts`, ID generation falls back to `Math.random().toString()` if `crypto.randomUUID` is unavailable.
- **Reaches the backend:** No. It only prints to the browser's local console.

## 5. ARCHIVE PROXY
Current state in `/api/archive/proxy` inside `server.ts`:
- **Range handling:** Honors incoming `req.headers.range` passing it forward to `headers.Range`. Also handles `If-Range`.
- **Content-Type handling:** Explicitly extracts upstream `Content-Type`. Blocks non-media documents with a RegEx (`/^(text\/html|application\/json|text\/plain)\b/i`) returning 502 to avoid feeding them to `<video>`.
- **AbortController handling:** Creates `AbortController` bound to upstream fetch. Uses a 20-second timeout strictly for header acquisition.
- **req.close handling:** Triggers `req.once("close", abortActive)` which calls `.abort()` on the controller if the client disconnects before finish.
- **AbortError handling:** Swallows and mutes `AbortError` in both `nodeStream.once("error")` and the top-level catch block if `req.destroyed`, avoiding unnecessary server crashing or noisy logs on standard video scrubs.

## 6. NEWS CHANNELS
Programs returned via `/api/schedule`:
- **Fox News:** 12
- **CNN:** 12
- **MSNBC:** 12
- **BBC News:** 12
- **NTD:** 0 (NTD News returns 0 programs)

## 7. CURRENT ERRORS
Observations without interacting in browser:
- Evidence of protective error handling in `server.ts` catching `[Archive Proxy Stream Error]` and `[Archive Proxy Response Error]`.
- No massive crash on startup (the `/api/health` endpoint successfully boots and resolves).
- Possible regression points in `PlayerView.tsx` during array indexing for next programs, given the silent failure behaviors in `handleProgramEnded`.

## 8. CHANGE RISK
- `/server.ts` : **RED**
- `/channels.ts` : **YELLOW**
- `/guideRegistry.ts` : **YELLOW**
- `/src/MinimalPlayer.tsx` : **RED**
- `/src/components/PlayerView.tsx` : **RED**
- `/src/components/TvGuideView.tsx` : **GREEN**
- `/src/EpgGuide.tsx` : **GREEN**
- `/src/telemetry.ts` : **YELLOW**
- `/src/types.ts` : **GREEN**

PHASE 1 STATUS:
FROZEN — INSPECTION COMPLETE
