---
name: ajn-visual-review
description: Screenshot-based visual QA of the AJN UI — layout, overlap, scroll jumps, mini-player clearance, dock panels, mobile widths, dark theme contrast — with a structured findings table.
---

# AJN visual review

## Viewports
1440×900, 1024×768, 390×844 (mobile). Capture each key screen at each.

## Look for
- Overlap: mini-player covering controls or guide rows; dock panels covering content.
- Scroll: page jumps when typing in search or opening suggestions; nested scrollbars.
- Text: truncation without tooltip, unreadable contrast, `null`/`undefined`/`NaN` visible.
- State: spinners that never resolve, stale results shown after new search, repeated items (e.g. radio news repeats).
- Guide: now-line aligned, row heights uniform, headers sticky.
- Touch: targets ≥ 40px on mobile; remote/16-button pad reachable.

## Findings table
`# | screen | viewport | issue | screenshot | severity (P1 broken / P2 wrong / P3 polish)`

Only report what is visible in a screenshot. Suggest the likely file via grep, but mark it "suspected".
