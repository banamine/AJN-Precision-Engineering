# Listen View Layout Optimization: Preserving the Deck with Real-Data Search & Filters

A targeted enhancement to the **Listen** (`#radio` / `#listen`) view that keeps the radio deck and tuner unit intact, positions an instant search bar and format/genre pills directly under the deck, repositions the "Full shows by day" shelf below the primary Listen-back episode list, and operates exclusively on verified real data sources (live feeds, saved presets, and catalog full shows) without any mocked or hardcoded content.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> **Confirmed Directives & Decisions:**
> 1. **Keep the Deck Intact**: The interactive radio deck / presets unit (`RadioPresetsBar`), spectrum visualizer, and persistent playback head are fully preserved. No skeuomorphic head-unit deletion.
> 2. **Reposition Search & Genre Pills**: A fast search bar and category filter pills sit directly below the live deck section for immediate discovery.
> 3. **Move "Full shows by day"**: Relocate `<FullShowDays />` from the top of `#ajr-listen` to below the main Listen-back episode grid (`.ajr-grid`), matching the owner's workflow.
> 4. **Strictly Verified Data (Zero Hardcoded/Invented Content)**:
>    - Live radio and user presets driven strictly by real saved presets and live station channels.
>    - Search and genre filter pills dynamically driven by real catalog shows and broadcast types (e.g., *Alex Jones Show*, *War Room*, *Special Reports*, *Exclusive Interviews*) from `loadAjnFeeds()` and `buildRadioCatalog()`.
>    - Full show days derived strictly from verified feed items via `groupShowDays()`.
>    - Zero hardcoded fake series, fake dramas, or non-existent streams.
> 5. **Visual Styling**: Applied using the warm copper (`#E06D3B`), deep slate canvas (`#0F1117`), dark charcoal cards (`#181B24`), and hairline borders (`#282D3D`).
> 6. **Protected File Integrity**: Strict compliance with Addendum 2026-10-13. Zero modifications to `server.ts`, `guideRegistry.ts`, `channels.ts`, `src/MinimalPlayer.tsx`, `src/components/PlayerChrome.tsx`, `src/EpgGuide.tsx`, or `package.json`.

---

### 1. Overview & Core Concept

- **What It Does**: Streamlines the Listen view layout so users can immediately search and filter real AJN broadcasts and presets right underneath the live deck. Preserves the active tuner controls while establishing a logical top-to-bottom visual hierarchy:
  1. Live radio deck & user presets.
  2. Instant search bar & dynamic category/format filter pills.
  3. Now-playing broadcast panel.
  4. Listen-back episode grid (with active filters & sort).
  5. Full shows by day shelf.
- **Key Value**: Delivers instant discovery and clutter-free navigation without altering backend pipelines, breaking established player contracts, or introducing unverified metadata.

---

### 2. User Experience & Visual Design

#### Key User Flows
1. **Live Radio & Tuner Access**:
   - The user views the radio tuner deck at the top with their real saved presets, live status indicators, and frequency tuner.
2. **Instant Search & Category Filter Bar**:
   - Positioned immediately beneath the live deck.
   - The user types a keyword (e.g., host name, topic, or date) or clicks a dynamic category pill (e.g. *All*, *Alex Jones Show*, *War Room*, *Special Reports*, *Full Shows*).
   - Filtering occurs in real time across the real catalog without page reloads or spinners.
   - A single-tap `✕` button clears search inputs immediately.
3. **Listen-Back Episode Browsing**:
   - The filtered catalog is displayed in the responsive `.ajr-grid` with play action buttons, date metadata, and duration indicators.
4. **Full Shows by Day Section**:
   - Positioned below the episode grid, allowing listeners looking for complete multi-hour broadcast day recordings to find packaged daily shows without crowding the initial viewport.

#### Visual Styling & Tokens
- **Canvas Base**: Deep Slate `#0F1117`
- **Deck & Card Surfaces**: Dark Charcoal `#181B24` with hairline border `#282D3D`
- **Interactive Accents**: Warm Copper `#E06D3B` (hover `#F97316`) for active filter pills, search focus ring, and play buttons
- **Live Status**: Signal Red `#EF4444` indicator dot for active live streaming
- **Typography & Metadata**: Off-white `#F1F5F9` titles, `#9CA3AF` for dates and durations, tabular numerals (`tabular-nums`) for elapsed times

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Place Search & Filters Directly Under the Deck**:
  - *Approach*: Position the search input and quick format pills between the live deck section and the listen-back section.
  - *Why*: Provides immediate discovery utility right where the user lands, eliminating the need to scroll past multiple sections to search episodes.
- **Decision 2: Move "Full shows by day" Below Listen-Back Grid**:
  - *Approach*: Move `<FullShowDays />` to render after the `.ajr-grid` episode list.
  - *Why*: Daily full show archives are multi-hour collections that take up significant vertical height; placing them below the individual episode list allows users to immediately see fresh individual broadcasts first.
- **Decision 3: Exclusively Real Data Sources**:
  - *Approach*: All pills, counts, and search results are derived directly from `catalog.radio`, `catalog.exclusive`, and `showDays` populated by `loadAjnFeeds()`.
  - *Why*: Strict adherence to engineering rules prohibiting fabricated or unverified content.

---

### 4. Technical Architecture & Component Structure

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          RadioView / Listen View                            │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ 1. Header & Live Radio Presets Deck (RadioPresetsBar + Spectrum)      │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ 2. Instant Search & Topic/Format Filter Pills                         │  │
│  │    [All] [Alex Jones Show] [War Room] [Special Reports] [Sunday...]   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ 3. Now Playing Panel (Persistent Player status & scrub controls)      │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ 4. Listen-Back Episodes Grid (.ajr-grid)                              │  │
│  │    - Real feed episodes filtered by query and selected pill           │  │
│  │    - Pagination / Show More controls                                  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ 5. Full Shows by Day Section (<FullShowDays />)                       │  │
│  │    - Grouped multi-hour days from groupShowDays()                     │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Target Code Changes:
- **`src/components/RadioView.tsx`**:
  - Insert the instant search input and quick format pills directly under `<section className="ajr-live">`.
  - Move `<FullShowDays days={showDays.slice(0, 12)} onPlay={playFullShow} />` from the top of `#ajr-listen` to after `<ul className="ajr-grid">`.
  - Ensure filter state cleanly syncs with both search and pill selections.
  - Apply warm copper and dark slate styling tokens.
