# Guide Schedule Overhaul — Gated Evaluation & Option A Execution Plan

This plan records the verified **Phase 0 read-only evaluation** (`F1–F7`, `G1`, `G2`), confirms the literal gate decision (**DECISION: A**, **DATE_SWITCHING: TODAY_ONLY**), and incorporates the owner's Phase 1, Phase 2, and final report constraints.

## User Review & Gate Verification Summary

> [!IMPORTANT]
> **Gate, Constraints, File Scope & Dependency Verification**
>
> 1. **Gate Answer (`G1`)**: **`NONE FOUND`** — Searching `grep -ril "EpgGuide" README* docs *.md` in the repository documentation returned no line protecting `EpgGuide.tsx`. Combined with `F1 = CONFIRMED`, `F2 = CONFIRMED`, and `F3 = CONFIRMED`, the literal decision rule selects **Option A** (finish inside the existing guide).
> 2. **Phase 2 Constraint — Plain `React.memo` Shallow Comparison**:
>    - Row components (`StationRow`, `TimelineRow`, `RosterRow`) use **plain `React.memo` with standard shallow prop comparison** (no custom `areEqual` comparator function).
>    - Raw `nowHour` is **not** passed as a prop to memoized rows; instead, each row receives `liveKey: string | null` alongside all other props the row uses (`channel`, `guideId`, `rowH`, `stationNumber`, `winStartHour`, `winEndHour`, `pxPerHour`, `viewWidth`, `channelRowStatus`, `playNowStatus`, `playingChannelId` / `isPlaying`, `isFlashing`, `matchedShowTitle`, and stable callbacks).
>    - **Fallback `liveKey` Rule**: When a live program has a non-empty `id`, `liveKey` is `${program.id}:${sHour}`; if a program has no `id`, `liveKey` is built from `${channel.id}:${sHour}:${program.title}`.
> 3. **Phase 1 Constraint — Shared Hour Helpers in `src/guide/programHours.ts` (No Circular Imports)**:
>    - `rundown.ts`, `ChannelRundown.tsx`, and `ChannelRoster.tsx` **never** import from `src/EpgGuide.tsx`.
>    - `withLocalHours` and shared hour helpers (`currentHourFraction`, `hourLabel`) live in `src/guide/programHours.ts`.
>    - `src/EpgGuide.tsx` imports and re-exports them so all existing exports from `src/EpgGuide.tsx` remain unchanged.
> 4. **Strict File Scope**:
>    - **Edited**: `src/EpgGuide.tsx`, `package.json` (test scripts only), and any test file that requires a minimal update if it relied on `"Load more"` in Phase 2c (recorded in the final report).
>    - **Created**: `src/guide/programHours.ts`, `src/guide/virtualRows.ts`, `src/guide/rundown.ts`, `src/guide/ChannelRundown.tsx`, `src/guide/ChannelRoster.tsx`, `test-virtual-rows.ts`, `test-rundown.ts`, and `BUILDER_REPORT_SCHEDULE_2026-11-08.md`.
>    - **Untouched (`R4`)**: **`src/MinimalPlayer.tsx` and `server.ts` are NOT edited.**
> 5. **Dependencies**: **Zero new npm packages added** (`package.json` `dependencies` and `devDependencies` remain completely unchanged).

```text
  DECISION: A
  REASON: F1, F2, and F3 are CONFIRMED, and G1 returned NONE FOUND in the repository documentation, so the literal decision rule selects Option A (finish inside the existing guide).
  DATE_SWITCHING: TODAY_ONLY
```

### Phase 0 Read-Only Table (`F1–F7`, `G1`, `G2`)

| Check | Verdict | Evidence (`file:line`) |
|---|---|---|
| **F1** (Horizontal block windowing) | **CONFIRMED** | `src/EpgGuide.tsx:948` (`intersects(b.startHour, b.endHour, win)`) and `src/EpgGuide.tsx:957` (`intersects(p.sHour, p.eHour, win)`). |
| **F2** (Vertical rows not windowed) | **CONFIRMED** | `src/EpgGuide.tsx:528` (`filtered.rows.slice(0, visibleCount)`), grown by `PAGE_ROWS = 40` (`src/EpgGuide.tsx:415, 526, 574, 590, 1026`). |
| **F3** (30s `nowHour` tick propagation) | **CONFIRMED** | `src/EpgGuide.tsx:346` (`setInterval(() => setNowHour(currentHourFraction()), 30_000)`), flowing into `onNowTest` (`519`), `grouped` (`646`), and every rendered row (`809, 950, 959`). |
| **F4** (Row height constants) | **CONFIRMED** | `src/EpgGuide.tsx:26` (`ROW_HEIGHT_PX = 68`) and `src/EpgGuide.tsx:30` (`AUDIO_ROW_HEIGHT_PX = 84`). |
| **F5** (Player HLS & audio teardown) | **CONFIRMED** | `src/MinimalPlayer.tsx:990-993` (`hls.stopLoad(); hls.detachMedia(); hls.destroy(); hlsRef.current = null;`) and `src/MinimalPlayer.tsx:16` (`releaseMediaElementAudioSource`). Left untouched per `R4`. |
| **F6** (Main viewport & `TodayView`) | **CONFIRMED** | `src/App.tsx:362` (`<main id="canonical-main-viewport"...>`) and `src/App.tsx:398` (`<TodayView ... />`). |
| **F7** (Virtual list & `hls.js` packages) | **CONFIRMED** | `package.json:123-152` contains `"hls.js": "^1.7.3"` at `package.json:131` and neither `react-window` nor `@tanstack/react-virtual`. |
| **G1** (Protected-file search in repo docs) | **NONE FOUND** | `grep -ril "EpgGuide" README* docs *.md` matched 5 files; zero contain `"protected"`. |
| **G2** (Schedule multi-day support) | **ONLY TODAY** | `src/guide/loadSchedule.ts:18`, `src/guide/scheduleCache.ts:3-6`, `src/types.ts:46-51`, `src/guide/groupProgramsForGrid.ts:54-61`, `src/EpgGuide.tsx:41-48` carry 0–24 local-day hours only. |

---

## 1. Overview & Core Concept

- **What It Does**:
  1. **Phase 1 (Pure Helpers + Shared Program Hours + Unit Tests)**: Extracts `withLocalHours`, `currentHourFraction`, and `hourLabel` into `src/guide/programHours.ts` (re-exported by `src/EpgGuide.tsx` so no `src/guide/*` module ever imports from `src/EpgGuide.tsx`); implements `computeRowWindow` (`virtualRows.ts` + `test-virtual-rows.ts`) and `buildRundown` / `nextUp` (`rundown.ts` + `test-rundown.ts`); registers `"test:virtual-rows"` and `"test:rundown"` in `package.json`.
  2. **Phase 2 (Vertical Row Virtualization + Plain `React.memo` Tick Isolation)**: Replaces `visibleCount` / `PAGE_ROWS` pagination in `EpgGuide` with `computeRowWindow` (`overscan = 3`) reading `window` scroll metrics relative to the rows container, and isolates 30-second `nowHour` ticks using **plain `React.memo` (default shallow comparison)** by replacing raw `nowHour` on row components with `liveKey` (falling back to `${channel.id}:${sHour}:${program.title}` when a program has no `id`) while keeping all other row props (`winStartHour`, `winEndHour`, `pxPerHour`, `viewWidth`, `channelRowStatus`, `playNowStatus`, `playingChannelId`).
  3. **Phase 3A (Option A In-Guide Views & Honest Date Control)**: Adds `ChannelRundown`, `ChannelRoster`, a 3-way view switch (**Grid | Roster | Channel**, default **Grid**), and an honest **Today-only** date control (**Yesterday | Today | Tomorrow**) that displays `"No schedule data for this day"` for non-Today selections.
- **Target Audience / Persona**: Viewers browsing 150+ channels across TV and Audio guides who need smooth scrolling, zero 30-second tick lag, and instant switching between the 2D timeline grid, a compact station roster, and a full-day single-channel rundown.
- **Key Value**: Eliminates full-list DOM mounting and unnecessary 30-second row re-renders while unifying Grid, Roster, and Channel Rundown views under the existing search, category, and "On now" filters.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Unified Filter & View Switch Bar**:
   - Retains the existing search input, "On now" filter toggle, and category pills without duplication.
   - Adds a 3-way segmented view switch (**Grid | Roster | Channel**, defaulting to **Grid**) that preserves the current `category`, `query`, `onNowOnly`, and focused channel across view changes.
   - Includes a **Date Control** (`Yesterday` | `Today` | `Tomorrow`): because `DATE_SWITCHING` is `TODAY_ONLY`, `Today` renders the live schedule while selecting `Yesterday` or `Tomorrow` displays the honest empty state (`"No schedule data for this day"`) with a one-click return to `Today`.

2. **Grid View (Virtualized & Shallow-Memoized)**:
   - **Scroll Container**: Reads `window` scroll position (`window.scrollY` / `rowsBodyRef.current.getBoundingClientRect().top`) and `window.innerHeight` (`viewportHeight`), throttled via `requestAnimationFrame`.
   - Both the $272\text{px}$ sticky left station column and the horizontal timeline lane render a top spacer (`topSpacer` px), the active slice of rows (`start..end` with `overscan = 3`), and a bottom spacer (`bottomSpacer` px).
   - Preserves `data-epg-channel-row` and `data-channel-id` attributes for `classic-tv` on-demand row hydration and programmatic channel focus (scrolling `window` to the target row's prefix-sum offset).
   - Each channel row is wrapped in **plain `React.memo`** (ordinary shallow prop comparison, no custom comparator). Instead of passing raw `nowHour`, the parent passes `liveKey` (`${program.id}:${sHour}` or `${channel.id}:${sHour}:${program.title}` if `program.id` is empty) alongside primitive window/pan props (`winStartHour`, `winEndHour`, `pxPerHour`, `viewWidth`), row hydration state (`channelRowStatus`), `playNowStatus`, and `playingChannelId`.

3. **Roster View (`ChannelRoster`)**:
   - Compact fixed-height ($68\text{px}$) rows windowed with `computeRowWindow` and wrapped in plain `React.memo`.
   - Each row displays: station number (`font-mono tabular-nums`), channel name, **Now Playing** title with live progress bar and minutes remaining, the next two programs via `nextUp(programs, nowMs, 2)`, and an **Open rundown** button that switches the guide directly to the **Channel** view for that station.

4. **Channel View (`ChannelRundown`)**:
   - Features a channel selector dropdown populated by the active filtered channel list.
   - Renders the selected channel's 24-hour chronological schedule using `buildRundown(programs, nowMs)`:
     - **Past**: Dimmed entries (`opacity-60`) with start–end times and cleaned titles.
     - **Now Playing**: Highlighted active card with live progress bar (`0..1`), minutes remaining, synopsis if present, and a **Tune Live** button wired through `tuneIn` and `onSelectProgram`.
     - **Upcoming**: Chronological rows with `font-mono tabular-nums` start–end times, real `S##E##` code only when present in program data/title, and cleaned title.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Plain `React.memo` with Shallow Comparison + `liveKey` Prop**
  - *Chosen Approach*: Remove raw `nowHour` from row component props and pass `liveKey` (`id + startHour` or `channelId + startHour + title` fallback) alongside all other props used by the row (`winStartHour`, `winEndHour`, `pxPerHour`, `viewWidth`, `channelRowStatus`, `playNowStatus`, `playingChannelId`), relying on React's built-in shallow prop comparison.
  - *Why*: Guarantees that any legitimate change to pan/window, `pxPerHour`, hydration state, `playNow` status, or `playingChannelId` triggers a re-render while 30-second clock ticks that do not change `liveKey` or the snapped 30-minute window do not re-render unchanged rows.
- **Decision 2: Shared `src/guide/programHours.ts` Module**
  - *Chosen Approach*: Place `withLocalHours`, `currentHourFraction`, and `hourLabel` in `src/guide/programHours.ts`, imported by `rundown.ts`, `ChannelRundown.tsx`, `ChannelRoster.tsx`, and `src/EpgGuide.tsx` (which re-exports them).
  - *Why*: Eliminates any dependency from `src/guide/*` back into `src/EpgGuide.tsx` while keeping `src/EpgGuide.tsx`'s public exports identical.
- **Decision 3: Honest `TODAY_ONLY` Date Control**
  - *Chosen Approach*: Because `/api/schedule` and `withLocalHours` provide current-day schedules (`0..24`), selecting another day renders `"No schedule data for this day"` rather than inventing rotated schedules.
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
│  │ - Scroll source: window       │  │ - computeRowWindow   │  │ - Channel Sel. │  │
│  │ - computeRowWindow(heights)   │  │   (68px rows)        │  │ - buildRundown │  │
│  │ - Top/Bottom Spacer Divs      │  │ - Plain React.memo   │  │   Past (dim)   │  │
│  │ - Plain React.memo Rows       │  │ - Now Playing + %    │  │   Now (Tune)   │  │
│  │   (shallow props + liveKey)   │  │ - nextUp(progs, 2)   │  │   Upcoming     │  │
│  │ - Existing BlockCell / Blocks │  │ - "Open rundown" btn │  │                │  │
│  └───────────────┬───────────────┘  └──────────┬───────────┘  └────────┬───────┘  │
│                  └─────────────────────────────┼───────────────────────┘          │
│                                                ▼                                  │
│  ┌─────────────────────────────────────────────────────────────────────────────┐  │
│  │ Pure Guide Helpers & Shared Cache Layer (No imports from src/EpgGuide.tsx)  │  │
│  │ - programHours.ts: withLocalHours, currentHourFraction, hourLabel           │  │
│  │ - virtualRows.ts: computeRowWindow({ heights, scrollTop, viewportHeight })  │  │
│  │ - rundown.ts: buildRundown(programs, nowMs) & nextUp(programs, nowMs, n)    │  │
│  │ - Reused: groupProgramsForGrid, liveTune, timeWindow, channelIndex, cache   │  │
│  └─────────────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────────────┘
```

### Verification & Finish Steps (`V1–V4`)

1. Run `npm run lint`, `npm run test:virtual-rows`, `npm run test:rundown`, `npm test`, and `npm run build`.
2. Write `BUILDER_REPORT_SCHEDULE_2026-11-08.md` including:
   - Phase 0 table (`F1–F7`, `G1`, `G2`) and the `DECISION` block.
   - Explicit statement of which element is the scroll container (`window`, measuring offset relative to the grid/roster rows container `rowsBodyRef` and `window.innerHeight`) read by `computeRowWindow`.
   - Complete audit of every existing test file in the repository that referenced `visibleCount`, `PAGE_ROWS`, or `"Load more"` and what (if anything) was changed in it.
   - Every file created or changed with its byte size.
   - Raw tail of each `V1` command's output.
   - `"NOT VERIFIED"` list and a 5-click `"Manual check for the owner"` list.
