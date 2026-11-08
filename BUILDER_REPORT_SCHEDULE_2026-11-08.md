# BUILDER REPORT — GUIDE SCHEDULE OVERHAUL (2026-11-08)

## 1. Phase 0 Evaluation (`F1–F7`, `G1`, `G2`)

- **F1**: `CONFIRMED` — `src/EpgGuide.tsx:948` (`intersects(b.startHour, b.endHour, win)`) and `src/EpgGuide.tsx:957` (`intersects(p.sHour, p.eHour, win)`).
- **F2**: `CONFIRMED` — `src/EpgGuide.tsx:528` (`filtered.rows.slice(0, visibleCount)`), grown by `PAGE_ROWS = 40` (`src/EpgGuide.tsx:415, 526, 574, 590, 1026`).
- **F3**: `CONFIRMED` — `src/EpgGuide.tsx:346` (`setInterval(() => setNowHour(currentHourFraction()), 30_000)`), flowing into `onNowTest` (`519`), `grouped` (`646`), and every rendered row (`809, 950, 959`).
- **F4**: `CONFIRMED` — `src/EpgGuide.tsx:26` (`ROW_HEIGHT_PX = 68`) and `src/EpgGuide.tsx:30` (`AUDIO_ROW_HEIGHT_PX = 84`).
- **F5**: `CONFIRMED` — `src/MinimalPlayer.tsx:990-993` (`hls.stopLoad(); hls.detachMedia(); hls.destroy(); hlsRef.current = null;`) and `src/MinimalPlayer.tsx:16` (`releaseMediaElementAudioSource`).
- **F6**: `CONFIRMED` — `src/App.tsx:362` (`<main id="canonical-main-viewport"...>`) and `src/App.tsx:398` (`<TodayView ... />`).
- **F7**: `CONFIRMED` — `package.json:123-152` has `"hls.js": "^1.7.3"` at `package.json:131` and neither `react-window` nor `@tanstack/react-virtual`.
- **G1**: `NONE FOUND` — `grep -ril "EpgGuide" README* docs *.md` matched 5 files (`docs/classic-lazy-prefetch-lanes/REPORT.md`, `AJN_CANONICAL_PLAYBACK_SLICE.md`, `AJN_LIVE_VS_CURRENT_EDIT_FORENSIC_REPORT.md`, `AJN_PHASE1_CURRENT_STATE.md`, `AJN_SANDBOX_REPAIR_MANIFEST.md`); none contain `"protected"`.
- **G2**: `ONLY TODAY` — `src/guide/loadSchedule.ts:18`, `src/guide/scheduleCache.ts:3-6`, `src/types.ts:46-51`, `src/guide/groupProgramsForGrid.ts:54-61`, `src/EpgGuide.tsx:41-48` carry 0–24 local-day hours only.

```text
  DECISION: A
  REASON: F1, F2, and F3 are CONFIRMED, and G1 returned NONE FOUND in the repository documentation, so the literal decision rule selects Option A (finish inside the existing guide).
  DATE_SWITCHING: TODAY_ONLY
```

---

## 2. Scroll Container & Row Virtualization Details

- **Scroll Container Read by `computeRowWindow`**:
  - `window` is the scroll container (`window.addEventListener("scroll", scheduleMeasure, { passive: true })`, throttled to one measurement per animation frame via `window.requestAnimationFrame`).
  - `viewportHeight` is read from `window.innerHeight` (with a fallback of `800` when `window` is undefined in SSR tests such as `test-archive-item-guide.tsx`).
  - `scrollTop` into the channel rows is computed relative to the grid/roster rows wrapper `<div ref={rowsBodyRef}>`: when `rowsBodyRef.current` has layout (`rect.height > 0 || rect.top !== 0`), `scrollTop = Math.max(0, -(rect.top + TIMELINE_HEADER_HEIGHT_PX))` (where `TIMELINE_HEADER_HEIGHT_PX = 44`), falling back to `Math.max(0, window.scrollY)`.
- **Row Memoization & Tick Isolation**:
  - `MemoStationRow` (`src/EpgGuide.tsx`), `MemoTimelineRow` (`src/EpgGuide.tsx`), and `RosterRow` (`src/guide/ChannelRoster.tsx`) use **plain `React.memo` with ordinary shallow prop comparison** (no custom comparator).
  - Raw `nowHour` is replaced on row props with `liveKey: string | null` (built by `buildLiveKey` in `src/guide/programHours.ts`, which uses `${program.id}:${sHour}` when `program.id` is non-empty and falls back to `${channel.id}:${sHour}:${program.title}` when `program.id` is missing/empty), while preserving all other row props (`winStartHour`, `winEndHour`, `winHours`, `pxPerHour`, `viewWidth`, `channelRowStatus`, `playNowStatus`, `playingChannelId`, `isFlashing`, `matchedShowTitle`).
- **No Circular Imports (`src/guide/programHours.ts`)**:
  - `withLocalHours`, `currentHourFraction`, `hourLabel`, `buildProgramLiveKey`, and `buildLiveKey` live in `src/guide/programHours.ts`.
  - `src/guide/rundown.ts`, `src/guide/ChannelRundown.tsx`, and `src/guide/ChannelRoster.tsx` import from `./programHours` and never import from `src/EpgGuide.tsx`.
  - `src/EpgGuide.tsx` imports and re-exports `withLocalHours`, `currentHourFraction`, `hourLabel`, `buildProgramLiveKey`, and `buildLiveKey` from `./guide/programHours` as well as `ROW_HEIGHT_PX` and `AUDIO_ROW_HEIGHT_PX` from `./guide/virtualRows`.

---

## 3. Existing Test Files Referencing `visibleCount`, `PAGE_ROWS`, or `"Load more"`

A full-repo search (`grep -rnE "visibleCount|PAGE_ROWS|Load more"`) found:
1. **`visibleCount`**: Referenced in **0** test files (only `src/EpgGuide.tsx`).
2. **`PAGE_ROWS`**: Referenced in **0** test files (only `src/EpgGuide.tsx`).
3. **`"Load more"`**:
   - `test-classic-light-guide.mjs` (line 168): Previously clicked the `"Load more"` button to mount rows 41–80 (`demo-channel-048`, `demo-channel-060`, `demo-channel-050`). Updated lines 167–190 to scroll `window` to the virtualized row offsets (`47 * 68`, `59 * 68`, `49 * 68`) before querying those rows.
   - `test-dock-playback-overlap.mjs` (line 267): Already guarded with `if (loadMore) { ... }`; **no change needed**.

---

## 4. Files Created or Modified (with Byte Sizes)

- **Untouched per `R4`**: `src/MinimalPlayer.tsx` (unchanged), `server.ts` (unchanged).
- **Zero new npm dependencies added** (`package.json` `dependencies` and `devDependencies` unchanged).

| File Path | Action | Size (bytes) |
|---|---|---|
| `src/guide/programHours.ts` | Created | 1,781 |
| `src/guide/virtualRows.ts` | Created | 2,618 |
| `src/guide/rundown.ts` | Created | 5,519 |
| `src/guide/ChannelRundown.tsx` | Created | 11,648 |
| `src/guide/ChannelRoster.tsx` | Created | 6,785 |
| `src/EpgGuide.tsx` | Modified | 50,331 |
| `test-virtual-rows.ts` | Created | 4,171 |
| `test-rundown.ts` | Created | 3,661 |
| `test-classic-light-guide.mjs` | Modified | 13,341 |
| `package.json` | Modified (scripts only) | 9,098 |

---

## 5. Verification Outputs (`V1`)

### `npm run test:virtual-rows`
```text
> ajn-precision-engineering@0.1.0 test:virtual-rows
> tsx test-virtual-rows.ts
[virtual-rows] PASS — N=0, 1 row, 150 mixed 68/84 rows, scrollTop 0/mid/end, overscan 0/3, spacer conservation & mounted bounds
```

### `npm run test:rundown`
```text
> ajn-precision-engineering@0.1.0 test:rundown
> tsx test-rundown.ts
[rundown] PASS — before-first, mid-program, gap (now=null), after-last, midnight crossing, empty list, nextUp count>available, liveKey fallback
```

### `npm test` (raw tail)
```text
ok 66 - decodes entities, normalizes episode markers, and preserves calendar dates
ok 67 - keeps malformed encoding intact and removes a lowercase Archive suffix only
1..67
# tests 67
# suites 0
# pass 67
# fail 0
# duration_ms 84.947479
> ajn-precision-engineering@0.1.0 test:virtual-rows
> tsx test-virtual-rows.ts
[virtual-rows] PASS — N=0, 1 row, 150 mixed 68/84 rows, scrollTop 0/mid/end, overscan 0/3, spacer conservation & mounted bounds
> ajn-precision-engineering@0.1.0 test:rundown
> tsx test-rundown.ts
[rundown] PASS — before-first, mid-program, gap (now=null), after-last, midnight crossing, empty list, nextUp count>available, liveKey fallback
```

### `npm run build` (`compile_applet`)
```text
Build succeeded - the applet is compiled
```

### `NOT VERIFIED`
- Standalone `npm run lint` (`tsc --noEmit` over the full repository) hits the container's default Node V8 heap limit when run without an increased `--max-old-space-size`, while `compile_applet` (`vite build && esbuild server.ts ...`), `npm run test:virtual-rows`, `npm run test:rundown`, and `npm test` all completed and passed with exit code 0.

---

## 6. Manual Check for the Owner (5 Clicks to Try)

1. **Grid Scroll Virtualization**: Open any Guide (e.g., **Live TV** or **Classic TV**) in **Grid** view and scroll vertically from top to bottom — confirm the left station column and right timeline lane stay pixel-aligned and only ~15–20 `[data-epg-channel-row]` nodes are mounted at a time.
2. **Switch to Roster View**: Click **Roster** in the `Grid | Roster | Channel` toolbar switch — confirm current search/category/`On now` filters remain active and each 68px row shows the station number, channel name, **Now Playing** progress bar + minutes left, and next two upcoming shows.
3. **Open Single-Channel Rundown from Roster**: Click **Open rundown** on any channel row in **Roster** view — confirm the guide switches to **Channel** view for that station showing **Now Playing** (with progress bar & `Tune Live`), **Upcoming** (with `font-mono tabular-nums` start–end times and real `S##E##` badges only when present), and dimmed (`opacity-60`) **Earlier Today** entries.
4. **Tune Live from Channel Rundown**: Click **Tune Live** on the active **Now Playing** card in **Channel** view (or change the channel via the **Channel** dropdown) — confirm playback starts at the live clock offset for that station.
5. **Honest Date Control (`TODAY_ONLY`)**: Click **Yesterday** or **Tomorrow** in the `Yesterday | Today | Tomorrow` segmented control — confirm it displays `"No schedule data for this day"` with a **Back to Today** button rather than fabricating projected schedules.
