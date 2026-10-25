---
name: ajn-app-walkthrough
description: Guided, evidence-recording walkthrough of the AJN Precision Engineering app (Home, TV Guide/EPG, Archive, Radio, Podcasts, Playlists, Search, Health). Use for first-run orientation, smoke tests, or demo preludes.
---

# AJN app walkthrough

Goal: visit every top-level area once and record what actually happens. Do not fix anything during the walkthrough.

## Before starting
- Note the URL, commit SHA (`git rev-parse --short HEAD`), browser, viewport, and time (UTC).
- Open DevTools: Console + Network (filter `/api/`). Keep both open the whole time.

## Route (adapt names to the actual nav; list the real nav labels first)
1. **Home** — hero/on-air wall renders thumbnails, no autoplay. Click one: player opens.
2. **TV Guide / EPG** — rows render, now-line visible, scroll vertically and horizontally; times match the clock.
3. **Channel tune** — pick 3 channels (one Archive MP4, one M3U/IPTV, one embed). Record: first frame time, network status of the media request (expect 206).
4. **Archive** — browse + search one term; open one item.
5. **Radio / Podcasts** — start one stream; audio meter moves only if audio is real.
6. **Playlists** — load, reorder, play next.
7. **Search** — submit, suggestions, history; no page jump.
8. **Health / Diagnostics** — read the status panel (see `ajn-telemetry-reading`).
9. **Mini-player / PiP** — enter and leave; controls stay reachable.

## Record per stop
`area | action | expected | observed | evidence (screenshot name / request URL + status) | PASS/FAIL/UNKNOWN`

UNKNOWN is valid. Never mark PASS without having seen it.

## Prelude mode (demo)
For a short demo prelude, run steps 1, 2, 3 and 8 only, and state up front which features are not yet verified.
