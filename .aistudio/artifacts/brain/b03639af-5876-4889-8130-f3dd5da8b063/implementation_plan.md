# Guide Schedule Overhaul — Gated Evaluation & Option A Execution Plan

This plan incorporates the completed **Phase 0 read-only repository evaluation** (`F1–F7`, `G1`, `G2`), records the literal gate decision (**Option A** with **TODAY_ONLY** honest date switching), and defines the complete implementation across **Phase 1**, **Phase 2**, **Phase 3A**, and **Finish (`V1–V4`)** with zero new npm dependencies, zero fake/projected schedule data, and full reuse of existing guide utilities.

## Phase 0 Evaluation & Gate Decision

> [!IMPORTANT]
> **Phase 0 Read-Only Verification Results**
>
> - **F1**: **CONFIRMED** — Horizontal block limiting already exists via `intersects(b.startHour, b.endHour, win)` (`EpgGuide` line 948) and `intersects(p.sHour, p.eHour, win)` (`EpgGuide` line 957).
> - **F2**: **CONFIRMED** — Vertical rows are not windowed; rows are sliced via `filtered.rows.slice(0, visibleCount)` (`EpgGuide` line 528) and grown by `PAGE_ROWS` (`EpgGuide` lines 526, 574, 590, 1009) with no `scrollTop`-based slicing.
> - **F3**: **CONFIRMED** — A 30-second interval calls `setInterval(() => setNowHour(currentHourFraction()), 30_000)` (`EpgGuide` line 346), and `nowHour` flows into `onNowTest` (line 519), `grouped` (line 646), and every rendered row (lines 809, 950, 959).
> - **F4**: **CONFIRMED** — Row heights are defined as constants `ROW_HEIGHT_PX = 68` (`EpgGuide` line 26) and `AUDIO_ROW_HEIGHT_PX = 84` (`EpgGuide` line 30).
> - **F5**: **CONFIRMED** — `MinimalPlayer` already tears down `hls.js` in the exact order `hls.stopLoad()`, `hls.detachMedia()`, `hls.destroy()`, `hlsRef.current = null` (`MinimalPlayer` lines 990–993) and imports `releaseMediaElementAudioSource` (line 16).
> - **F6**: **CONFIRMED** — `#canonical-main-viewport` is mounted at `App` line 362, views switch on `destination`, and `TodayView` is mounted at line 398.
> - **F7**: **CONFIRMED** — Neither `react-window` nor `@tanstack/react-virtual` is in `package.json` (lines 123–152); `"hls.js": "^1.7.3"` is present at line 131.
> - **G1**: **NONE FOUND** — Searching `grep -ril "EpgGuide" README* docs *.md` matched 5 files (`docs/classic-lazy-prefetch-lanes/REPORT.md`, `AJN_CANONICAL_PLAYBACK_SLICE.md`, `AJN_LIVE_VS_CURRENT_EDIT_FORENSIC_REPORT.md`, `AJN_PHASE1_CURRENT_STATE.md`, `AJN_SANDBOX_REPAIR_MANIFEST.md`); none contain the word `"protected"` (and `AJN_PHASE1_CURRENT_STATE.md` line 126 marks `EpgGuide` as `GREEN`).
> - **G2**: **ONLY TODAY** — Schedule loaders and caches (`loadSchedule` line 18, `scheduleCache` lines 3–6, `types` lines 46–51) carry 0–24 local-day hours (`startHour`/`endHour` or `startTime`/`endTime`), and UTC-timed programs (`metadata.epg === 'utc'`) are clipped to the viewer's current local day (`0..24`) in `localHours` (`groupProgramsForGrid` lines 54–61) and `withLocalHours` (`EpgGuide` lines 41–48).

```text
  DECISION: A
  REASON: F1, F2, and F3 are CONFIRMED, and G1 returned NONE FOUND in the repository documentation, so the literal decision rule selects Option A (finish inside the existing guide).
  DATE_SWITCHING: TODAY_ONLY
```

---

## 1. Overview & Core Concept

- **What It Does**:
  1. Adds pure, zero-dependency row-windowing (`computeRowWindow`) and single-channel chronological rundown (`buildRundown`, `nextUp`) helpers backed by dedicated unit test suites.
  2. Replaces the growing `visibleCount` pagination in the existing EPG Guide with prefix-sum vertical row virtualization (`topSpacer`, windowed rows, `bottomSpacer` synchronized across both the left station column and the right timeline lane) and `React.memo` row-level tick isolation so 30-second clock updates only re-render rows whose active live program key actually changed.
  3. Completes **Option A** inside the existing guide by adding a 3-way view switch (**Grid | Roster | Channel**), a virtualized **Channel Roster** view, a chronological **Channel Rundown** view (**Past**, **Now Playing**, **Upcoming**), and an honest **Today-only** date control that displays `"No schedule data for this day"` if another day is selected rather than inventing or projecting fake schedules.
- **Target Audience / Persona**: Viewers browsing 150+ channels across TV and Audio guides who need smooth scrolling, zero 30-second tick lag, and instant switching between the 2D timeline grid, a compact station roster, and a full-day single-channel rundown.
- **Key Value**: Eliminates full-list DOM mounting and unnecessary 30-second row re-renders while unifying Grid, Roster, and Channel Rundown views under the existing search, category, and "On now" filters.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Unified Filter & View Switch Bar**:
   - Retains the existing search input, "On now" filter toggle, and category pills/select without duplication.
   - Adds a 3-way segmented view switch (**Grid | Roster | Channel**, defaulting to **Grid**) that preserves the current `category`, `query`, `onNowOnly`, and focused channel across view changes.
   - Includes a **Date Control** (`Yesterday` | `Today` | `Tomorrow`): because `DATE_SWITCHING` is `TODAY_ONLY`, `Today` renders the live schedule while selecting `Yesterday` or `Tomorrow` displays the honest empty state (`"No schedule data for this day"`) with a one-click return to `Today`.

2. **Grid View (Virtualized & Tick-Isolated)**:
   - Both the $272\text{px}$ sticky left station column and the horizontal timeline lane render a top spacer (`topSpacer` px), the active slice of rows (`start..end` with `overscan = 3`), and a bottom spacer (`bottomSpacer` px).
   - Preserves `data-epg-channel-row` and `data-channel-id` attributes for `classic-tv` on-demand row hydration and programmatic channel focus (scrolling the container to the target row's prefix-sum offset).
   - Each channel row is wrapped in `React.memo` keyed by its live program identity (`liveKey = liveProgram ? `${liveProgram.id}:${sHour}` : null`) so the 30-second `nowHour` tick updates the red scrubber line and time header without re-rendering rows whose live program has not changed.

3. **Roster View (`ChannelRoster`)**:
   - Compact fixed-height ($68\text{px}$) rows windowed with `computeRowWindow`.
   - Each row displays: station number (`font-mono tabular-nums`), channel logo and cleaned name, **Now Playing** title with live progress bar and minutes remaining, the next two programs via `nextUp(programs, nowMs, 2)`, and an **Open rundown** button that switches the guide directly to the **Channel** view for that station.

4. **Channel View (`ChannelRundown`)**:
   - Features a channel selector dropdown populated by the active filtered channel list.
   - Renders the selected channel's 24-hour chronological schedule using `buildRundown(programs, nowMs)`:
     - **Past**: Dimmed entries (`opacity-60`) with start–end times and cleaned titles.
     - **Now Playing**: Highlighted active card with live progress bar (`0..1`), minutes remaining, synopsis if present, and a **Tune Live** button wired through `tuneIn` and `onSelectProgram`.
     - **Upcoming**: Chronological rows with `font-mono tabular-nums` start–end times, real `S##E##` code only when present in program data/title, and cleaned title.

### Visual Identity & Theme

- **Aesthetic Direction**: Seamless extension of the dark studio broadcast grid (`bg-neutral-950`, `border-neutral-800` hairlines, sky/amber live accents, `font-mono tabular-nums` timestamps).
- **Zero-Pill & Honesty Discipline**: Season/episode codes (`S##E##`) are shown only when genuinely present in the program metadata or title; missing days or empty schedules show explicit, honest empty states with zero fabricated data.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Option A (In-Guide Integration) per Gated Protocol**
  - *Chosen Approach*: Integrate vertical virtualization, tick isolation, `ChannelRoster`, `ChannelRundown`, and the 3-way view switch directly into the existing guide workflow.
  - *Why*: Follows the literal Phase 0 gate rule (`G1 = NONE FOUND`) and reuses all existing filter, search, cache, and hydration state without duplicating logic.
- **Decision 2: Prefix-Sum Binary-Search Windowing (`computeRowWindow`)**
  - *Chosen Approach*: Pure prefix-sum array over row heights (`ROW_HEIGHT_PX = 68`, `AUDIO_ROW_HEIGHT_PX = 84`) with binary search for `scrollTop`.
  - *Why*: Supports both uniform and mixed row heights in $O(\log N)$ time with zero external dependencies and exact spacer height conservation ($\text{topSpacer} + \text{mountedHeight} + \text{bottomSpacer} = \text{totalHeight}$).
- **Decision 3: Honest `TODAY_ONLY` Date Control**
  - *Chosen Approach*: Because `/api/schedule` and `localHours` provide current-day schedules (`0..24`), selecting another day renders `"No schedule data for this day"` rather than inventing rotated schedules.
  - *Why*: Strictly enforces Rule R1 (no fake data, no invented schedule times, no projected rotation days).

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Component Diagram

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│                                  EpgGuide Shell                                   │
│  ┌─────────────────────────────────────────────────────────────────────────────┐  │
│  │ Existing Filter Bar (Search | On Now | Categories)                          │  │
│  │ + 3-Way View Switch: [ Grid | Roster | Channel ]                            │  │
│  │ + Date Control: [ Yesterday | Today | Tomorrow ] (TODAY_ONLY honest state)  │  │
│  └───────────────┬─────────────────────────────┬───────────────────────────────┘  │
│                  │                             │                                  │
│         (View === 'grid')             (View === 'roster')      (View === 'channel')│
│                  ▼                             ▼                        ▼         │
│  ┌───────────────────────────────┐  ┌──────────────────────┐  ┌────────────────┐  │
│  │ Virtualized 2D Timeline Grid  │  │ ChannelRoster        │  │ ChannelRundown │  │
│  │ - computeRowWindow(heights)   │  │ - computeRowWindow   │  │ - Channel Sel. │  │
│  │ - Top/Bottom Spacer Divs      │  │   (68px rows)        │  │ - buildRundown │  │
│  │ - Memoized Left & Right Rows  │  │ - Now Playing + %    │  │   Past (dim)   │  │
│  │   (isolated by liveKey)       │  │ - nextUp(progs, 2)   │  │   Now (Tune)   │  │
│  │ - Existing BlockCell / Blocks │  │ - "Open rundown" btn │  │   Upcoming     │  │
│  └───────────────┬───────────────┘  └──────────┬───────────┘  └────────┬───────┘  │
│                  └─────────────────────────────┼───────────────────────┘          │
│                                                ▼                                  │
│  ┌─────────────────────────────────────────────────────────────────────────────┐  │
│  │ Pure Guide Helpers & Shared Cache Layer                                     │  │
│  │ - virtualRows.ts: computeRowWindow({ heights, scrollTop, viewportHeight })  │  │
│  │ - rundown.ts: buildRundown(programs, nowMs) & nextUp(programs, nowMs, n)    │  │
│  │ - Reused: groupProgramsForGrid, liveTune, timeWindow, channelIndex, cache   │  │
│  └─────────────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────────────┘
```

### Phase-by-Phase Execution Checklist

1. **Phase 1 — Pure Helpers & Unit Tests**:
   - Create `computeRowWindow` using `ROW_HEIGHT_PX` ($68$) and `AUDIO_ROW_HEIGHT_PX` ($84$), binary-searching prefix sums and clamping negative/overflow `scrollTop` and zero `N` or `viewportHeight`.
   - Create `test-virtual-rows.ts` covering $N=0$, $1$ row, $150$ mixed $68/84$ rows at `scrollTop` $0$/middle/end, `overscan` $0$ and $3$, spacer sum conservation, and mounted count bound.
   - Create `buildRundown` and `nextUp` reusing `localHours` / `withLocalHours` and `cleanAjnDisplayTitle`, extracting real `S##E##` codes only when present, and computing `durationMinutes`, `progress` ($0..1$), and `minutesRemaining`.
   - Create `test-rundown.ts` covering before-first-program, mid-program, gap between programs (`now = null`), after-last-program, midnight-crossing program, empty list, and `count > available`.
   - Register `"test:virtual-rows"` and `"test:rundown"` in `package.json` and append both to `"test"`.

2. **Phase 2 — Row Virtualization & Tick Isolation**:
   - Replace `visibleCount` / `PAGE_ROWS` pagination in `EpgGuide` with `computeRowWindow` driven by a `requestAnimationFrame`-throttled passive scroll listener.
   - Synchronize `topSpacer`, windowed rows (`overscan = 3`), and `bottomSpacer` across both the left channel column and right program lane.
   - Isolate 30-second `nowHour` ticks with `React.memo` channel row components keyed on each row's live program key.
   - Verify with `npm run lint`, `npm run test:virtual-rows`, `npm run test:rundown`, and `npm test`.

3. **Phase 3A — Roster, Rundown, 3-Way View Switch & Honest Date Control**:
   - Build `ChannelRundown` (`Past`, `Now Playing` with progress bar & `Tune Live`, `Upcoming`, plus channel selector dropdown).
   - Build `ChannelRoster` (`computeRowWindow` 68px rows, `Now Playing` progress, `nextUp(..., 2)`, and `"Open rundown"` trigger).
   - Wire the **Grid | Roster | Channel** switch and **Today-only** date control (showing `"No schedule data for this day"` for non-Today selections) into `EpgGuide`.

4. **Finish — Verification & Report (`V1–V4`)**:
   - Run `npm run lint`, `npm run test:virtual-rows`, `npm run test:rundown`, `npm test`, and `npm run build`.
   - Write `BUILDER_REPORT_SCHEDULE_2026-11-08.md` with the Phase 0 table, Decision block, modified/created file byte sizes, raw command output tails, `NOT VERIFIED` list, and 5-step manual owner checklist.
