# AJN live soak: why does "Network stalled…" happen?

## Run (PowerShell, in the repo folder)
```powershell
cd "B:\AJN Precision Engineering\AJN-Precision-Engineering\repo"
npm i -D playwright                      # once (uses your installed Google Chrome; no browser download)
$app = "https://<your live app URL>"      # the Cloud Run / ai.studio address, no trailing slash

# 1) The one that answers your question: 25 minutes of one show, no clicking. Leave the Chrome window open.
node tools/live-soak/live-soak.mjs --url $app --scenario soak --minutes 25

# 1b) Same, but a specific plain-file show from a specific guide (the one you saw stalling)
node tools/live-soak/live-soak.mjs --url $app --scenario soak --minutes 30 --tab classic-tv --match "Wanted"

# 1c) REALISTIC LONG RUN (what to use for the stall hunt): 40 min of mixed use - next episodes (real end-of-program handoff),
#     other video shows, AUDIO shows, random seeks, pause/resume. Every stall in the report names the action before it.
node tools/live-soak/live-soak.mjs --url $app --scenario mix --minutes 40 --tab classic-tv --match "Wanted"

# 2) Random items + random seeks (audio and video), 10 items x 3 seeks
node tools/live-soak/live-soak.mjs --url $app --scenario random --iterations 10

# 3) Rapid channel switching (12 switches): one media element, no overlap, start times
node tools/live-soak/live-soak.mjs --url $app --scenario switch

# 4) Buffering vs network transitions (offline 4s / 25s / slow 50 KB/s / offline 60s) and what Retry does
node tools/live-soak/live-soak.mjs --url $app --scenario net

# Everything (about 45-60 min): 
node tools/live-soak/live-soak.mjs --url $app --scenario all --minutes 20
```
Each run writes `live-soak-report-<time>.md` (read this) and `.json` (full samples, every proxy request, every media event). Send me both.
Use `--channel msedge` for Edge. Do not use other tabs heavily while it runs (background-tab throttling changes buffering).

## What the report tells you
For every stall (video/audio not playing while it should be) it lists: media position, seconds already buffered ahead, how long it lasted,
the status text shown, whether the Retry button was shown, and the proxy request(s) alive at that moment with time-to-first-byte and the
`Server-Timing: upstream;dur=..., attempts` header (needs the server.ts line in this drop-in).
Cause column:
- `proxy request #N took X ms to first byte` -> SERVER/UPSTREAM wait (Cloud Run -> archive.org). Look at the Server-Timing value: big `upstream;dur` = archive.org slow; small dur but big TTFB = Cloud Run (cold start / CPU) or the network path.
- `NO live proxy request` -> the BROWSER/PLAYER was idle, nothing was being fetched: look at `events` (`suspend`, `waiting` with no request) and `buffered ahead before`.
- `request in flight but not slow to first byte` -> bandwidth: the slice body arrives slower than the video plays.
- `harness-imposed network change` -> expected (net scenario).

## Hypotheses to test (from reading the code, NOT yet proven on production)
1. Slice boundary refetch. The proxy answers every Range with at most 8 MiB (server/proxyRange.ts). At ~1 Mbps that is ~64 s of video, so a show needs a new Cloud Run -> archive.org request every ~1 min. If a fresh request takes longer than the seconds already buffered, playback stalls and then resumes by itself. Evidence: stalls recur at similar `media pos` spacing and the late request has a high TTFB / `upstream;dur`.
2. Archive.org first-byte latency / datanode redirect each slice (and `attempts` > 1 from archiveFetch retries). Evidence: `Server-Timing attempts` > 1 or `upstream;dur` in seconds.
3. Cloud Run cold start or CPU throttling between requests. Evidence: high TTFB with LOW upstream dur.
4. Client misleading UI: the `stalled` event only means "no data for ~3 s"; the player prints "Network stalled…" and shows Retry even though playback usually resumes by itself. Evidence: status shown + Retry shown, stall lasts seconds, no Retry click needed.
5. Real network drop (Wi-Fi/cellular handover). Evidence: stalls cluster with changes you made, TTFB fine otherwise.
6. Proxy does an extra upstream GET per request (open audit item). Evidence: `attempts`/dur roughly 2x a direct archive.org request.

## What Retry does today (src/components/PlayerView.tsx:255)
Retry resets the failure counter and remounts the whole player (`retryNonce`), i.e. a full reload of the item, not a gentle reconnect.
Automatic in-place recovery exists only after `waiting` lasts 45 s (STALL_WATCHDOG_MS) and for media errors (3 tries: 1 s, 3 s, 6 s). A 5-40 s stall therefore shows "Network stalled…" + Retry with no automatic action.
Questions the net scenario answers: does it resume by itself after offline 4 s / 25 s / 60 s, how long after the network returns, does Retry resume faster or lose position.

## Self-test (what was verified here, in a sandbox with a fake slow upstream)
`--selftest-webm file.webm --selftest-slice 524288 --selftest-delay-ms 6000` reproduced: stall of 12 s, status "Buffering… / Network stalled… / Playing", Retry shown, then self-resume; the report attributed it to the slow request.
The net scenario could NOT be validated in the sandbox (network emulation does not affect a fake route). The first real run is the evidence; this README makes no claim about production yet.

## Evidence so far (live, 2026-10-10)
- Clip item (`?exact=1&start=&end=`, news channels): body speed ~330 KB/s = about real time for a ~270 KB/s clip; no buffer headroom.
- Plain file (Wanted Dead or Alive S01E01, slice-speed.ps1): 8 MiB slice via proxy in 1.0-1.8 s (first byte 0.5-1.5 s); direct from Archive 0.7 s, with one 5.2 s outlier. Bulk speed is NOT the limit for plain files; intermittent slow first bytes / Archive hiccups are the suspects. The KBps column of slice-speed.ps1 is inflated when the body arrives in under a second; trust totalSec.
