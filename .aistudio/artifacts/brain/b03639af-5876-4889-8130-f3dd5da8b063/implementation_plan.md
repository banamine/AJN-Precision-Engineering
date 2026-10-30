# TV Guide Layout & Button Geometry Fix in theme.css

Scoped CSS adjustment in `src/components/ajn-platform-redesign/theme.css` to exempt TV Guide buttons from the global 44px touch target on mouse/fine-pointer devices, keep an 11px typography floor, and prevent "ON AIR NOW" badges from wrapping.

### User Review & Critical Decisions

> [!IMPORTANT]
> The button exemption rule is scoped strictly to `@media (hover: hover) and (pointer: fine)` as requested, ensuring standard desktop/pointer interactions preserve the compact 24px button geometry while touch devices retain larger tap targets.

- **Confirmed Decision 1**: Scoped pointer exemption via `@media (hover: hover) and (pointer: fine)` for `[data-epg-channel-row]`, `[data-epg-window-start]`, `[data-music-row]`, and `[data-epg-toolbar]`.
- **Confirmed Decision 2**: Strict `white-space: nowrap !important` on live badges (`[class*="tracking-wider"]`, `[data-testid="replay-tag"]`) to eliminate multi-line text breaking.
- **Confirmed Decision 3**: Readable 11px font floor with `line-height: 1.25` for guide subtext to ensure vertical centering within 52px and 68px cell heights.
- **Zero Protected File Edits**: Zero modifications to `src/EpgGuide.tsx`, `src/guide/BlockCell.tsx`, or any backend/EPG logic.

---

### 1. Overview & Core Concept

- **What It Does**: Resolves layout collision, truncation, and vertical misalignment in the TV Guide by overriding platform-shell broad rules for button sizing and typography.
- **Target Audience / Persona**: Users navigating the TV Guide, music radio blocks, and podcast schedules on desktop and mouse/pointer devices.
- **Key Value**: Restores full visibility of station names, unoverlaps the play button from the `NowPlayingLine` and category info, and guarantees clean single-line vertical centering for "ON AIR NOW" blocks.

---

### 2. User Experience & Visual Design

- **Station Column**:
  - The play button (`data-play-live`) and `ShowInfoButton` render at their natural 24×24px (`h-6 w-6`).
  - Channel name (`span.truncate`) retains ~40px of extra width without truncating early.
  - The play button stays inline with the title and does not protrude downward into the station category or `NowPlayingLine`.
- **Timeline Blocks & Program Cells**:
  - Short-duration blocks (<44px width) are no longer artificially expanded or distorted.
  - Live indicator badges ("ON AIR NOW") remain on a single line with pulsing dot.
  - Cell text stays vertically centered across all row heights (52px/68px standard, 68px/84px audio).
- **EPG Toolbar**:
  - Pan chevrons (`h-6 w-6`), "Now" button, and duration selector stay aligned to 24px height.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Pointer Media Query Scoping**
  - *Chosen Approach*: Wrap the button exemption in `@media (hover: hover) and (pointer: fine)`.
  - *Why*: Accommodates precise mouse navigation on desktop without interfering with mobile/coarse touch targets.
- **Decision 2: Subtext Font Floor (11px @ 1.25 line-height)**
  - *Chosen Approach*: Specific override for guide subtext (`text-[9px]`, `text-[10px]`, `text-[11px]`) down to 11px.
  - *Why*: The global 12px / 1.5 line-height created ~60px text blocks that overflowed 52px cell containers. 11px @ 1.25 line-height totals ~38px across 3 lines, fitting comfortably within the 52px container.

---

### 4. Technical Architecture & Data Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│               src/components/ajn-platform-redesign/             │
│                            theme.css                            │
├─────────────────────────────────────────────────────────────────┤
│ Lines 72-79 (Global Shell Baseline)                            │
│  ├── :where(button, ...) { min-height: 44px; min-width: 44px; } │
│  └── :where([class*="text-[9px]"], ...) { font-size: 12px; }    │
├─────────────────────────────────────────────────────────────────┤
│ Lines 80+ (Proposed Guide Precision Overrides)                  │
│  ├── @media (hover: hover) and (pointer: fine)                  │
│  │    └── :is([data-epg-channel-row], [data-epg-window-start],  │
│  │           [data-music-row], [data-epg-toolbar]) :is(...)     │
│  │           { min-height: 0; min-width: 0; }                   │
│  ├── Guide subtext floor (11px, 1.25 line-height)              │
│  └── Live badge nowrap ([class*="tracking-wider"])              │
└─────────────────────────────────────────────────────────────────┘
```

#### Exact Edits to Apply (Pending Approval):

In `/src/components/ajn-platform-redesign/theme.css`, insert after line 79:

```css
/* Guide-specific button exemptions scoped to mouse / fine-pointer devices */
@media (hover: hover) and (pointer: fine) {
  .ajn-platform-shell :is([data-epg-channel-row], [data-epg-window-start], [data-music-row], [data-epg-toolbar]) :is(button, a[role="button"], select) {
    min-height: 0;
    min-width: 0;
  }
}

/* Maintain readable 11px floor with compact line height to fit 52-68px cell heights */
.ajn-platform-shell :is([data-epg-channel-row], [data-epg-window-start], [data-music-row]) :is([class*="text-[9px]"], [class*="text-[10px]"], [class*="text-[11px]"]) {
  font-size: 11px !important;
  line-height: 1.25 !important;
}

/* Prevent "ON AIR NOW" / status badges from wrapping and vertically pushing cell content off-center */
.ajn-platform-shell :is([data-epg-window-start], [data-music-row]) :is([class*="tracking-wider"], [data-testid="replay-tag"]) {
  white-space: nowrap !important;
}
```
