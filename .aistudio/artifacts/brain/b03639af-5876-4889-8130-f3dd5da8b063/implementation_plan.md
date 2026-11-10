# Classic TV EPG Admin Decisions — Revised Implementation Plan & Critique

This revised plan maps all six tasks in `GO_BUILD_TEAM — CLASSIC TV EPG ADMIN DECISIONS DEPLOY` (Google Doc `1qRC10kBGyQuZUiVReysXjFPetsr4rIZkaV7fhEDVZps`, 2026-11-09) to the exact files and schemas in `banamine/AJN-Precision-Engineering`, provides the surgical changes to execute upon approval, and supplies the corrected prompt and PR body for your local Claude Code environment.

## User Review & Critical Decisions

> [!IMPORTANT]
> **Summary of Confirmed Decisions & Exact Repo Mapping**
> - **Task 1 (Missing Classic Guide Popup Files — Bug #1 & Bug #4)**: `ClassicGuideSheet.tsx`, `ClassicNetworkGuide.tsx`, and `classicNetworkSchedule.ts` are not present in this branch/workspace. Per your prompt rule (*"If ANY file is missing: STOP. Report which file is missing and on which branch"*), they are reported below and included in the rewritten local Claude Code prompt so you can cherry-pick them from your local `feat/classic-guide-popup` branch without fabricating stubs.
> - **Task 2 (Ch 026 *All Dogs Go to Heaven* -> Cartoon Weekend-Morning)**: Reassign `"All Dogs Go to Heaven"` to the `"Cartoons"` category/group and register it in the weekend-morning (`06:00–12:00 PT` Sat/Sun) `cartoons-inera` rotation pool while preserving alphabetical station numbering (`001..375`) so `M*A*S*H` stays at Ch 209.
> - **Task 3 (`M*A*S*H` Search Normalization — Bug #2)**: Strip asterisks (`*`) in `fold()` inside the EPG channel indexer (which powers both client EPG search and server `/api/schedule/search`) and align the global search normalizer so searching `"MASH"` routes directly to Ch 209 (`M*A*S*H`) instead of matching an episode title on Ch 148.
> - **Task 4 (Pacific Time `(PT)` Label — Bug #3)**: We located the exact string `"your local 24-hour day"` from your prompt in the Today schedule header (`{dateLabel} · your local 24-hour day, 12:00 AM to 11:59 PM`) as well as the EPG toolbar and Channel Rundown time headers. All schedule headers and time labels will display `(PT)` / `Pacific Time (PT)` without altering time conversion math.
> - **Task 5 (Missing Channel Cross-Reference: `33, 39, 40, 50, 51, 52, 55, 70, 71, 75, 91, 100, 102, 135`)**: Audit and report the exact station-number table across the Classic TV manifests and exclusion/held lists without adding or removing channels.

---

## 1. Overview & Task-by-Task Forensic Critique

### First 10 Lines of Each Existing File to Be Touched (Prompt Rule #1)

1. **EPG Search & Station Numbering (`src/guide/channelIndex.ts`, lines 1–10)**:
   ```ts
   /* Pure helpers for the EPG channel list: alphabetical order, sequential station numbers, categories, search.
    * No React, no DOM, no network. EpgGuide calls these once per schedule load / filter change. */
   import type { ScheduleChannel } from '../types';

   export interface NumberedChannel { channel: ScheduleChannel; station: number }
   export interface CategoryCount { id: string; label: string; count: number }
   export const ALL_CATEGORIES = 'all';

   /** Lowercase, accent-free, whitespace-collapsed. */
   export function fold(s: string): string {
   ```

2. **Global Search Normalization (`src/search/normalize.ts`, lines 1–10)**:
   ```ts
   export function joinedKey(s: string): string {
     return String(s ?? '')
       .normalize('NFKD')
       .replace(/\p{M}/gu, '')
       .toLowerCase()
       .replace(/&/g, ' and ')
       .replace(/['"’‘“”`]/g, '')
       .replace(/[^\p{L}\p{N}]/gu, '');
   }
   ```

3. **Today Schedule View (`src/components/TodayView.tsx`, lines 1–10)**:
   ```tsx
   import { LaneImage } from "./LaneImage";
   import { bufferGaugeMetadata } from "../utils/bufferGauge";
   import { useCallback, useEffect, useMemo, useRef, useState } from "react";
   import { CalendarDays, Clock, Headphones, ListChecks, Play, RefreshCw, Tv } from "lucide-react";
   import type { Destination, Guide, MediaType, PlayProgramCallback, ScheduleChannel } from "../types";
   import { clearScheduleCache, getCachedLightSchedule, getCachedSchedule, isStale, setCachedLightSchedule, setCachedSchedule, shouldDisplayCachedSchedule } from "../guide/scheduleCache";
   import { buildToday, formatHour, thumbnailOf, type TodayChannel, type TodayEntry } from "../guide/todayList";
   import { tuneIn, mediaTypeFor } from "../guide/liveTune";
   import { ChannelLogo } from "./ChannelLogo";
   ```

4. **Single-Channel Schedule Rundown (`src/guide/ChannelRundown.tsx`, lines 1–10)**:
   ```tsx
   import { useEffect, useMemo } from "react";
   import { Play, Radio, Tv, CircleAlert } from "lucide-react";
   import type { PlayProgramCallback, Program, ScheduleChannel } from "../types";
   import { bufferGaugeMetadata } from "../utils/bufferGauge";
   import { cleanAjnDisplayTitle } from "../utils/ajnTitleNormalizer";
   import { stationLabel, type NumberedChannel } from "./channelIndex";
   import { mediaTypeFor, tuneIn } from "./liveTune";
   import { buildRundown, type Entry } from "./rundown";

   export interface ChannelRundownProps {
   ```

5. **Classic Network Schedule Pool Config (`config/classic-network-draft.json`, lines 1–10)**:
   ```json
   {
     "stationZone": "America/Los_Angeles",
     "originMonday": "2026-11-09",
     "horizonDays": 14,
     "activeFrom": "2026-11-09T00:00:00 America/Los_Angeles",
     "repeatGapHours": 168,
     "pools": {
       "overnight": {
         "series": ["mister-ed", "get-smart", "benson", "good-times", "the-jeffersons", "archie-bunkers-place", "chico-and-the-man"],
         "mode": "variety-single"
   ```

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Searching `"MASH"` (Task 3 / Bug #2)**:
     - Previously, `fold("M*A*S*H")` retained asterisks (`"m*a*s*h"`), so typing `"MASH"` in the Classic TV EPG search box failed to match the channel title `"M*A*S*H"` (Ch 209) and instead matched an episode title containing `"mash"` on Ch 148.
     - With `.replace(/\*/g, '')` in `fold()`, both client-side filtering and server-side `/api/schedule/search` fold `"M*A*S*H"` and `"MASH"` to `"mash"`, highlighting **CH 209 — M\*A\*S\*H** immediately.
  2. **Pacific Time (`(PT)`) Display Labels (Task 4 / Bug #3)**:
     - The Today schedule subtitle (`{dateLabel} · your local 24-hour day, 12:00 AM to 11:59 PM (PT) — Pacific Time`), the EPG toolbar time window (`{hourLabel(win.startHour)} – {hourLabel(win.endHour)} (PT)`), and the Channel Rundown time ranges (`{start} – {end} (PT)`) explicitly display `(PT)` without changing any underlying UTC/local hour math.
  3. **Ch 026 Cartoon Weekend-Morning Assignment (Task 2)**:
     - Reclassifies Ch 026 (*All Dogs Go to Heaven*) under the `Cartoons` category and admits it to the `cartoons-inera` (`06:00–12:00 PT` Saturday/Sunday) pool without shifting station numbers `027..375`.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Preserve Station Numbers `001..375` When Reassigning Ch 026**
  - *Chosen Approach*: Update the category/group and weekend-morning pool membership for Ch 026 without deleting its channel entry from the `classic-tv` guide list.
  - *Why*: `numberChannels()` numbers all `classic-tv` channels `001..N` sequentially in alphabetical order (`classic-network` pinned to `001`, then `002..375` sorted by `sortKey(name)`). Deleting Ch 026 from `classic-tv` would shift every subsequent channel down by 1 (making `M*A*S*H` Ch 208 instead of Ch 209).
- **Decision 2: Fix `fold()` in `channelIndex.ts` + `joinedKey()` in `normalize.ts`**
  - *Chosen Approach*: Add `.replace(/\*/g, '')` to `fold()` while preserving whitespace tokenization, and keep `joinedKey()` in `normalize.ts` aligned.
  - *Why*: `server/classicScheduleSearch.ts` and `src/EpgGuide.tsx` both import `fold()` from `src/guide/channelIndex.ts`. Stripping `*` inside `fold()` fixes both client and server search in one surgical edit without disturbing `sortKey()`'s leading-article (`"the "`, `"a "`, `"an "`) alphabetical sort order.

---

## 4. Technical Architecture & Rewritten Local Claude Code Prompt

### Architecture & Data Flow Diagram

```
┌────────────────────────────────────────────────────────────────────────────┐
│                     CLASSIC TV EPG & ADMIN DECISIONS FLOW                  │
└────────────────────────────────────────────────────────────────────────────┘
                                      │
        ┌─────────────────────────────┼─────────────────────────────┐
        ▼                             ▼                             ▼
┌───────────────────────┐   ┌───────────────────────┐   ┌───────────────────────┐
│   Task 3: Search Fix  │   │  Task 4: (PT) Labels  │   │ Tasks 2 & 5: Lineup   │
│ • fold() strips '*'   │   │ • TodayView subtitle  │   │ • Ch 026 -> Cartoons  │
│ • Client EPG filter   │   │   + (PT) Pacific Time │   │   + cartoons-inera    │
│ • Server title search │   │ • EPG toolbar window  │   │   weekend-morning     │
│ • "MASH" -> Ch 209    │   │ • ChannelRundown slot │   │ • Station #001..375   │
│   (M*A*S*H)           │   │   headers show (PT)   │   │   audit (14 numbers)  │
└───────────────────────┘   └───────────────────────┘   └───────────────────────┘
```

### Rewritten Self-Contained Prompt for Your Local Claude Code Environment

Copy and paste the block below into Claude Code in your local repository (`B:\AJN Precision Engineering\AJN-Precision-Engineering\repo`):

```text
GO_BUILD_TEAM — CLASSIC TV EPG ADMIN DECISIONS DEPLOY (REPO-VERIFIED)
Repo: banamine/AJN-Precision-Engineering  branch: main
Date: 2026-11-09
Auth: Admin review complete (Google Doc ID: 1qRC10kBGyQuZUiVReysXjFPetsr4rIZkaV7fhEDVZps)

RULES:
- Read every file before editing and report the first 10 lines of each touched file.
- Surgical edits only. No new npm dependencies. Node 22. TypeScript strict.
- Protected files (do not rewrite): server.ts, src/MinimalPlayer.tsx,
  src/components/PlayerChrome.tsx, guideRegistry.ts, channels.ts.
- Open ONE draft PR (`fix/classic-epg-admin-decisions-2026-11-09`). Do NOT merge or deploy.

TASK 1 — Check local branches for Classic Guide popup files [Bug #1 & Bug #4]
1. Run `git branch -a` and `git log --all --full-history -- "**/ClassicGuideSheet*" "**/ClassicNetworkGuide*" "**/classicNetworkSchedule*"`
2. If those 3 files exist on a local unmerged branch (e.g. `feat/classic-guide-popup`),
   checkout/cherry-pick them onto `fix/classic-epg-admin-decisions-2026-11-09` and report
   their byte sizes and modified dates.
3. If they do not exist on any local branch, report that fact in the PR body and do NOT
   fabricate stub files.

TASK 2 — Reassign Ch 026 (All Dogs Go to Heaven) to Cartoons / weekend-morning [Admin decision]
NOTE: `src/data/classicNetworkCatalog.json` has schema `{ "schema": 1, "assets": [...] }`
(episode assets), while EPG channel numbers 001..375 are assigned alphabetically at runtime
by `numberChannels()` in `src/guide/channelIndex.ts`.
1. Locate the "All Dogs Go to Heaven" channel entry in `src/data/extraChannelsManifest.json`
   (or `src/data/organizerShowsManifest.json`) and report its JSON metadata.
2. Update its `group` to `"Cartoons"` in place (so station numbers 027..375 do not shift).
3. Add `"all-dogs-go-to-heaven"` to `SHOWS` / `SHOW_NAMES` in `tools/build-classic-network-catalog.mts`
   and to `pools["cartoons-inera"].series` (weekend-morning 06:00–12:00 PT) in
   `config/classic-network-draft.json`.

TASK 3 — M*A*S*H search normalization fix [Bug #2]
1. Read `src/guide/channelIndex.ts` (line 10 `fold()`) and `src/search/normalize.ts` (`joinedKey()`).
2. In `src/guide/channelIndex.ts`, update `fold()` to strip asterisks:
     export function fold(s: string): string {
       return String(s ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\*/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
     }
   This fixes both client EPG filtering (`filterChannels`) and server title search
   (`server/classicScheduleSearch.ts`) so searching `"MASH"` matches `"M*A*S*H"` (Ch 209)
   instead of routing to Ch 148.

TASK 4 — Add Pacific Time (PT) label to schedule blocks [Bug #3]
1. Read `src/components/TodayView.tsx` (line 163), `src/guide/ChannelRundown.tsx` (lines 195, 267, 309),
   and `src/EpgGuide.tsx` (line 1657).
2. Append static `(PT)` display labels to:
   - `src/components/TodayView.tsx`: `{dateLabel} · your local 24-hour day, 12:00 AM to 11:59 PM (PT)`
   - `src/guide/ChannelRundown.tsx`: `{rundown.now.start} – {rundown.now.end} (PT)` and upcoming/past slot ranges
   - `src/EpgGuide.tsx`: `{hourLabel(win.startHour)} – {hourLabel(win.endHour)} (PT) · follows the red line`
   (And if `ClassicNetworkGuide.tsx` / `classicNetworkSchedule.ts` were cherry-picked in Task 1, append `(PT)` there too.)

TASK 5 — Missing channel cross-reference table [Admin decision]
Audit station numbers `33, 39, 40, 50, 51, 52, 55, 70, 71, 75, 91, 100, 102, 135` against the
numbered `classic-tv` channel list (`numberChannels()`) and `tools/build-classic-network-catalog.mts`
(`EXCLUDED_CHANNEL_IDS`, `HELD_CHANNEL_IDS`, `SHOWS`) and include the table in the PR body:
  Ch# | Present? | Show name (if present) | Era-eligible (<=1995)?

TASK 6 — Commit and open DRAFT PR `fix/classic-epg-admin-decisions-2026-11-09`
Do NOT merge. Do NOT deploy.
```
