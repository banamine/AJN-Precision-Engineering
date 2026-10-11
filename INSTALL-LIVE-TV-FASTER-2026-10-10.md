# Live TV: faster dead-channel handling (2026-10-10)
Evidence: live app `/api/live/health` returned runs:0, running:true, checked:0, hidden:0 - the server's dead-channel check had not finished once since the instance started, so nothing was hidden and dead channels sat black.

## Files (same paths)
- `server/liveHealth.ts` - health pass runs 24 channels at a time (was 8) and each check times out at 6 s (was 8 s). A pass over ~1,500 channels should finish in a couple of minutes, not ten.
- `guideRegistry.ts` - the confirming recheck of fresh failures runs 3 min after the pass (was 10 min). A channel is still hidden only after TWO failed checks; one success restores it. (Only this recheck delay and the 24 concurrency changed; the rest of the file is identical to the version already in Builder, including the 6 news channels.)
- `src/MinimalPlayer.tsx` - hls.js now fails fast on dead streams (manifest/level timeout 7 s, 1 retry, was 10 s x up to 4 retries) and prefetches the first segment while the level playlist loads. Everything else (audio preload, car controls, layout) unchanged.

## Verify after republish
1. Wait ~10 min after deploy, then `curl.exe -s https://<app>/api/live/health` -> `runs` >= 1, `checked` ~1,490, and `offline`/`hidden` > 0 after the recheck.
2. Open Live TV, click a few channels: working ones should start in a few seconds; a dead one shows "Failed to load" in about 15 s instead of staying black.
Not changed: proxy, other guides. Cloud Run keeps health state in memory, so it restarts from zero when an instance restarts: that is a known remaining limit.
