---
name: ajn-epg-organization
description: Organize and debug the AJN TV Guide / EPG — channel ordering, grouping, real air times, 48-hour window, timezone drift, virtualization performance, and empty news feeds.
---

# AJN EPG / TV Guide organization

## Data rules
- Every programme comes from a canonical MediaAsset with a real `start`/`stop` (UTC ISO). No fabricated times; if unknown, show "Time unknown", not a made-up slot.
- Window: now − 24h to now + 24h (48h sliding). Filter by **air time**, not upload date. Sort by start.
- Store UTC; convert to the viewer's zone only at render. Check server `TZ` and `Date` math for drift.
- Empty feed is an error state, not a cached success. Don't cache empty results.

## Channel ordering / grouping
1. Live channels first, then 24/7 scheduled, then on-demand collections.
2. Group by `group-title` (M3U) or category; keep a stable numeric channel number.
3. AJN network (Alex Jones, Harrison Smith War Room) is separate from Real America's Voice (Bannon's War Room, America's Newsroom). Never merge the two "War Room" channels.
4. Deleted/cleared slots show "Empty Slot", persisted.

## Performance (5,000+ rows)
- Rows virtualized (`react-window` or existing equivalent); fixed or memoized row heights.
- Now-line / clock ticker throttled (≥ 1s, ideally 30–60s for layout); no full re-render per tick.
- Row components memoized; props typed, no `any`.

## Debug checklist
- `curl -s localhost:$PORT/api/<epg-endpoint> | jq '.[0:3]'` — check start/stop present and in UTC.
- Count programmes per channel; channels with 0 → trace the feed fetch.
- Compare guide now-line with system clock; offset of whole hours = timezone bug.
- React Profiler: commits per second while idle should be ~0.

## Verify
Screenshot guide at two times 1h apart; programmes moved, times correct, no blank rows.
