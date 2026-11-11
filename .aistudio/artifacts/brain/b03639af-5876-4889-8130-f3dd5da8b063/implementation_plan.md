# 24-Hour Continuous Round-Robin Schedule & Spectrum Deck (Final Specification)

This plan upgrades the right-hand Spectrum panel of the Radio Head Unit into a unified **Spectrum & 24-Hour Broadcast Schedule Deck** for **Music Channels**, **Live Concerts**, and **FM Broadcasts**, pairing a real-duration 24-hour round-robin engine (supporting both UTC-synced 24h Broadcast Clock mode and On-Demand Shuffle mode) with the existing Web Audio spectrum backdrop and an integrated **Now Playing + Next 3 Upcoming Tracks** readout.

## User Review & Critical Decisions

> [!IMPORTANT]
> This specification incorporates all six live-play fixes plus all five factual repository corrections so implementation aligns with the existing codebase and protected-file rules.

- **Fix 1 & Repo Correction 1 — Real Durations Only (71/98 Music Channels + All Concerts + All FM Broadcasts)**:
  - Zero estimated or hash-derived durations are used anywhere.
  - **Live Concerts** (14,529 tracks / ~1,734 hours) and **FM Broadcasts** (346 broadcasts / 1,467 tracks) carry baked `d` durations on every track and are 100% eligible for **24h Clock Mode**.
  - **Music Channels**: 71 of the 98 channels currently have real `durationSeconds` in the `2026-10-12` audio item snapshot and are immediately eligible for **24h Clock Mode**. The remaining **27 channels** (including the 26 recently added from List 2) are absent from the current snapshot and therefore run in **Shuffle Mode** with an honest notice (`Shuffle only · durations not in snapshot`) until the snapshot is regenerated.
- **Repo Correction 2 — Canonical Track Key Format (`<rawArchiveId>::<partNo>`, Zero Prefixes)**:
  - Every track key uses the **raw Archive identifier + `::` + `partNo`** (`${archiveId}::${partNo}`) with **no** invented `concert-`, `fm-`, or `item-music-` prefixes, matching the exact key format used by the song library.
  - Source and pool membership (`bank: 'music' | 'concerts' | 'fm'`, `poolId`, `channelId`) travel as separate fields on the item/slot.
- **Fix 2 — UTC Day Seeding & Global Wall-Clock Sync**:
  - Daily order is seeded by **UTC calendar day** (`Math.floor(Date.now() / 86_400_000)`) and pool/channel ID, and loop position is computed via `(Date.now() - utcMidnightMs) % loopDurationMs`. Every viewer in every timezone hears the exact same track at the exact same UTC instant; only `HH:MM` clock labels are formatted in the viewer's local timezone.
- **Fix 3 & Repo Correction 4 — Separate Schedule Layer & Protected `MinimalPlayer.tsx` Boundary**:
  - Leaves `showQueue` untouched so Full Show sessions preserve their exact behavior.
  - **Protected Core Files**: `MinimalPlayer.tsx` (which owns `new Audio()` in its host ref) and `PlayerChrome.tsx` are **never edited**. The schedule controller drives playback strictly through the existing `onPlayProgram` callback and reads/seeks via the existing `usePersistentMedia` / `findPersistentMedia` hook interface (`seek(seconds)`, `currentTime`, `duration`, `failed`, `paused`).
- **Fix 4 & Repo Correction 5 — Mid-Track Offset Seeking with 3-Second Verification Timeout**:
  - When tuning into **24h Clock Mode** mid-track, the schedule controller calls `seek(targetOffsetSeconds)` once metadata loads and allows up to a **3-second timeout** (`3000ms`) for the bounded-slice VBR stream (8 MiB slice / 32 MiB cap) to settle within 3 seconds of `targetOffsetSeconds`. If the seek fails or times out after 3 seconds, playback starts cleanly from `0:00` and displays `Playing from 0:00 · mid-track seek unavailable`.
- **Fix 5 — Clicking an Upcoming Row Enters `"Off schedule"` with `"Return to live"`**:
  - Clicking any of the **Next 3 Upcoming** rows in Clock Mode switches the deck to **`Off schedule`**, plays that track from `0:00`, and reveals a **`Return to live`** button that re-synchronizes to the live UTC wall-clock slot and offset.
- **Fix 6 & Repo Correction 3 — Failed Track Skip on `/api/archive/proxy`**:
  - If a track fails to load or errors on `/api/archive/proxy` (without nested proxy paths), the controller records the failure against its `<rawArchiveId>::<partNo>` key, immediately skips to the next playable slot, and displays **`Failed to load — skipped`** in the readout.

---

## 1. Overview & Core Concept

- **What It Does**:
  - Delivers continuous 24-hour playback and a live schedule monitor across **Music Channels** (71 clock-eligible + 27 shuffle-only until snapshot refresh), **Live Concerts** (14,529 tracks), and **FM Broadcasts** (346 broadcasts / 1,467 tracks).
  - Reclaims the unused vertical space above and below the spectrum in the right-hand Head Unit panel by combining the existing `RadioSpectrum` -> `ArchiveMusicSpectrum` canvas (zero new Web Audio nodes) with an overlaid **On Air Now** banner and a **Next 3 Upcoming Tracks** strip.
  - Maintains a bounded, in-memory `lastAiredLog` of `<rawArchiveId>::<partNo>` entries (rendered as clean unboxed text rows) for Step 1 library cross-referencing.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Selecting Archive Music (`Music channels`, `Live concerts`, or `FM broadcasts`)**:
   - Selecting **2. ARCHIVE MUSIC** on the 3D Source Prism presents three sub-source buttons: `Music channels`, `Live concerts`, and `FM broadcasts`.
   - The right-hand Spectrum & Schedule Deck fills the full height of Row 1 alongside the left column and displays:
     - **Header Bar**: Source title, repeat notice whenever a single-album channel or small concert pool loops within 24 hours (e.g., `Repeats every 40m · Cycle 14` for a single album, or `Repeats every 6h 12m` for a 4-concert pool), and the **`24h Clock` | `Shuffle`** mode toggle (or `Shuffle only` notice for the 27 un-snapshotted music channels).
     - **Spectrum Stage + Overlaid "On Air Now" Readout**: Existing `RadioSpectrum` canvas behind a dark contrast scrim (`from-black/85 via-black/45 to-black/25`), overlaid with the active track title, concert/channel subtitle, local `HH:MM – HH:MM` window, status text (`ON AIR · UTC SYNCED`, `PLAYING FROM 0:00 · SEEK UNAVAILABLE`, `OFF SCHEDULE`, or `SHUFFLE`), and a 1-second progress bar.
     - **Next 3 Upcoming Strip**: Three single-line rows beneath the spectrum stage showing the next 3 tracks with tabular-numeral start times (`HH:MM`) and real durations (`MM:SS` or `H:MM:SS` for 3+ hour tracks).
2. **Mid-Track Tune-In & 3-Second Seek Handshake**:
   - Tuning into a clock-eligible channel/pool loads the active UTC slot via `onPlayProgram` and issues `seek(targetOffsetSeconds)` through the persistent media hook, waiting up to **3 seconds** for the VBR stream to settle at the target offset before falling back to `0:00` with an honest status note.
3. **Manual Track Pick (`Off schedule`) & `Return to live`**:
   - Clicking any of the **Next 3 Upcoming** rows plays that track from `0:00` and switches the header state to **`Off schedule`** with a **`Return to live`** button.
   - Clicking **`Return to live`** re-evaluates `Date.now()` against the UTC day schedule and tunes back to the live slot and offset.
4. **Track Failure Recovery**:
   - When `usePersistentMedia` reports `failed: true` (such as a 404 from `/api/archive/proxy`), the schedule controller records the `<rawArchiveId>::<partNo>` key in `failedIds`, marks the slot as **`Failed to load — skipped`**, and immediately starts the next slot.

### Visual Identity & Layout Safeguards

- **Single-Line Truncation for Long Tracks (3+ Hours)**:
  - All schedule rows use `flex items-center gap-2 min-w-0` with `truncate` on titles and `shrink-0 font-mono tabular-nums` on `HH:MM` start times and `H:MM:SS` durations (e.g., `3:14:47` for 3.2-hour broadcasts) so long durations never wrap or misalign columns.
- **Zero-Pill Metadata**:
  - Schedule timestamps, durations, repeat intervals, failure notices, and `lastAiredLog` rows render as unboxed text with `·` separators.
- **1-Second Tick & Throttled Recompute**:
  - The 1-second interval updates *only* the progress bar width and elapsed/remaining clock text; the **Next 3 Upcoming** array is recomputed *only* at track boundaries, pool selection changes, or mode switches.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Honest Handling of the 27 Un-Snapshotted Music Channels**
  - *Chosen Approach*: Wire `durationSeconds` from `audioItemSnapshot.json` for the 71 present Music Channels so they run in `24h Clock` mode immediately, while the 27 channels missing from the `2026-10-12` snapshot default to `Shuffle` mode with `Shuffle only · durations not in snapshot` until the snapshot is refreshed.
  - *Why*: Avoids inventing fake durations for the 27 channels while making Clock Mode immediately available on the 71 snapshotted Music Channels, all 14,529 Concert tracks, and all 1,467 FM Broadcast tracks.
- **Decision 2: Raw `<archiveId>::<partNo>` Keys Everywhere**
  - *Chosen Approach*: Construct `programId` strictly as `${rawArchiveId}::${partNo}` (1-based `partNo`) across Music Channels, Live Concerts, and FM Broadcasts, storing `bank`, `poolId`, and `channelId` as separate metadata fields.
  - *Why*: Matches `listenCatalog.ts` and the song library's exact key contract without prefix translation.
- **Decision 3: Two-Step Rollout Isolated from Protected Player Internals**
  - *Chosen Approach*:
    - **Step 1**: Wire `durationSeconds` / `d` across Music, Concerts, and FM Broadcasts with raw `<archiveId>::<partNo>` keys; build the standalone schedule controller; ship the Spectrum + **Now Playing + Next 3 Upcoming** readout in **Shuffle Mode** + bounded in-memory `lastAiredLog`.
    - **Step 2**: Enable **24h UTC Clock Mode** using `onPlayProgram` + `usePersistentMedia.seek()` with the 3-second VBR seek verification window, honest `0:00` fallback, `Off schedule` / `Return to live` controls, and `/api/archive/proxy` failure skipping.
  - *Why*: Delivers the complete UI and catalog layer safely in Step 1 and isolates VBR range-seek verification in Step 2 without touching `MinimalPlayer.tsx`.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Radio Head Unit (RadioPresetsBar)                    │
│                                                                             │
│  ┌──────────────────────────────────┐  ┌─────────────────────────────────┐  │
│  │ Left Column (Row 1, Col 1)       │  │ Right Column (Row 1, Col 2)     │  │
│  │ • Head Unit LCD Display          │  │ [Spectrum & 24h Schedule Deck]  │  │
│  │ • SourcePrism3D                  │  │                                 │  │
│  │ • Archive Sub-Source Buttons:    │  │ ┌─────────────────────────────┐ │  │
│  │   [Music] [Concerts] [FM Bcast]  │  │ │ Header: 24h Clock | Shuffle │ │  │
│  └──────────────────────────────────┘  │ │ + Repeats every Xm / Return │ │  │
│                                        │ ├─────────────────────────────┤ │  │
│                                        │ │ Existing RadioSpectrum      │ │  │
│                                        │ │ + Overlaid ON AIR NOW Slot  │ │  │
│                                        │ │   <archiveId>::<partNo>     │ │  │
│                                        │ ├─────────────────────────────┤ │  │
│                                        │ │ Next 3 Upcoming (Throttled) │ │  │
│                                        │ │  1. 18:27  Track A  0:03:42 │ │  │
│                                        │ │  2. 18:31  Track B  3:14:47 │ │  │
│                                        │ │  3. 21:45  Track C  0:04:15 │ │  │
│                                        │ └──────────────┬──────────────┘ │  │
│                                        └────────────────┼────────────────┘  │
└─────────────────────────────────────────────────────────┼───────────────────┘
                                                          │
                                                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│        Schedule Controller (Separate from showQueue & MinimalPlayer)        │
│                                                                             │
│  • Keys: <rawArchiveId>::<partNo> (poolId / channelId / bank kept separate) │
│  • Durations: 71/98 Music Snapshot + 14,529 Concert d + 1,467 FM d          │
│  • UTC Clock: FNV-1a(utcDay:poolId) + (Date.now() - utcMidnight) % loopMs   │
│  • Player Bridge: Calls onPlayProgram() + usePersistentMedia().seek()       │
│  • Seek Timeout: 3-second verification window; falls back to 0:00 honestly  │
│  • Failure Path: Skips failed /api/archive/proxy loads; marks row skipped   │
│  • Aired Ledger: Bounded in-memory lastAiredLog of <rawArchiveId>::<partNo> │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Data Model & State

- **`ScheduledTrackSlot`**:
  - `programId`: `<rawArchiveId>::<partNo>` (no prefix)
  - `archiveId`: Raw Archive item identifier
  - `partNo`: 1-based track index within the Archive item
  - `bank`: `'music' | 'concerts' | 'fm'`
  - `poolId`: Pool or channel identifier (e.g., `concert-pool-rock`, `fm-broadcasts`, or music channel ID)
  - `channelId` & `guideId`: Routing identifiers passed to `onPlayProgram`
  - `title` & `subtitle`: Track title and album/concert/FM broadcast label
  - `src`: `/download/<archiveId>/<encodedFile>` (served via `/api/archive/proxy` without nested proxy wrapping)
  - `durationSeconds`: Verified positive duration from snapshot/manifest (`undefined` only for the 27 un-snapshotted music channels)
  - `startUtcMs` & `endUtcMs`: Exact UTC epoch timestamps for the scheduled slot window
  - `cycleNumber` & `loopDurationSeconds`: Used to display `Repeats every Xh Ym · Cycle N` when `loopDurationSeconds < 86_400`
  - `status`: `'scheduled' | 'playing' | 'failed'`
- **`RoundRobinControllerState`**:
  - `mode`: `'clock24h' | 'shuffle' | 'off-schedule'`
  - `clockEligible`: `boolean` (`true` for all Concerts, all FM Broadcasts, and the 71 snapshotted Music Channels; `false` for the 27 un-snapshotted Music Channels)
  - `seekStatus`: `'synced' | 'fallback-zero' | 'pending'`
  - `failedIds`: `ReadonlySet<string>` (`<rawArchiveId>::<partNo>`)
  - `lastAiredLog`: Bounded in-memory list (`max 50`) of `{ programId, title, subtitle, bank, poolId, airedAtUtcMs }`

### Verification Plan (Post-Build Checks)

1. **Clock Sync Check**: Tune into a clock-eligible pool twice, 30 seconds apart; confirm the `nowSlot` and `currentTime` offset match the wall clock within ~1 second.
2. **Timezone Invariance Check**: Evaluate the schedule resolver across two different timezone offsets at the same UTC epoch millisecond; confirm the exact same `<rawArchiveId>::<partNo>` and track offset are selected, with only the formatted `HH:MM` strings localized.
3. **Failure & Off-Schedule Exit Paths**: Force a 404 track URL through `/api/archive/proxy` and verify it is skipped and marked `Failed to load — skipped`; click a `Next 3` row during `24h Clock` mode and confirm the badge switches to `Off schedule` with a working `Return to live` button.
4. **Proxy Response Bound & Protected Files Check**: Confirm no proxied response exceeds `32 MiB`, and verify `MinimalPlayer.tsx` and all other protected core files remain untouched.
