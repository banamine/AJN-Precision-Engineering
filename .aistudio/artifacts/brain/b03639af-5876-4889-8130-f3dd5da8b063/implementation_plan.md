# AJN Interactive Browser Audit — Touch Target, SourcePrism3D & Dock Clearance Repairs

This plan addresses the remaining audit items from the live browser inspection across AJN TV Guide, AJN Radio, and AJN Rumble: enforcing strict $\ge 48 \times 48\text{px}$ touch targets across all dock, head-unit, and prism stepper controls (Item 1), aligning the 3D Source Prism cylinder test ID and responsive `340px` mobile / `260px` desktop height contract (Item 11), and expanding mobile bottom scroll padding so the fixed audio dock never obscures bottom cards or footers at `390px` (Item 2).

## User Review & Critical Decisions

> [!IMPORTANT]
> All three repair scopes have been aligned with your confirmed selections. Review the architectural summary below and click **Proceed** to apply the changes.

- **Confirmed Decision 1 — Strict $48 \times 48\text{px}$ Minimum Touch Targets on All Steppers (Audit Item 1)**:
  - Enforce explicit `!min-w-[48px] !min-h-[48px] w-12 h-12` sizing on `dock-prev`, `dock-next`, `dock-prev-round`, and `dock-next-round` in the persistent mini-player dock, on `radio-head-unit-prev` and `radio-head-unit-next` in the Radio head unit, and on the previous/next source stepper buttons inside the 3D Source Prism.
  - Using `!`-prefixed pixel minimums (`!min-w-[48px] !min-h-[48px]`) ensures the global `44px` shell floor in the platform theme stylesheet and any root `rem` scaling cannot shrink these buttons below `48×48px`.
- **Confirmed Decision 2 — `SourcePrism3D` Cylinder Test ID & Responsive Height Alignment (Audit Item 11)**:
  - Tag the rotating 3D cylinder element with `data-testid="source-prism-cylinder"` and apply `h-[340px] lg:h-[260px]` to both the 3D scene viewport and the cylinder container, leaving the outer `[data-testid="source-prism-3d"]` section free to house the top source tab bar without clipping or crowding.
- **Confirmed Decision 3 — Mobile & Desktop Bottom Scroll Clearance (Audit Item 2)**:
  - Increase bottom scroll clearance on both the root `<main id="canonical-main-viewport">` wrapper and the AJN Radio / TV Guide containers (`pb-[18rem] md:pb-[12rem]` during active playback and `pb-44 md:pb-32` when idle) so the fixed `72–80px` dock, its mobile radio stepper row, and the mobile bottom navigation bar cleanly clear all bottom-most cards and footers at `390px` and `1280px`.

---

## 1. Overview & Core Concept

- **What It Does**: Completes the final polish pass following the 11-point interactive browser audit, eliminating sub-48px touch target failures on station/source steppers, binding the exact `340px` (mobile) / `260px` (desktop) geometry to `[data-testid="source-prism-cylinder"]`, and guaranteeing full scroll clearance above the persistent bottom dock across all routes.
- **Target Audience / Persona**: Mobile (`390px`) and desktop (`1280px+`) listeners navigating live radio presets, archival music, syndicated podcasts, Rumble feeds, and the 139-channel broadcast grid.
- **Key Value**: Achieves 100% pass compliance across all 11 interactive audit checks while preserving uninterrupted persistent audio playback, Web Audio spectrum honesty, and single-strip 3D source switching.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Tactile Station & Source Stepping (Item 1)**: Whether stepping presets from the persistent bottom dock (`dock-prev`, `dock-next` on mobile; `dock-prev-round`, `dock-next-round` on desktop), tuning via the Radio head-unit buttons (`radio-head-unit-prev`, `radio-head-unit-next`), or cycling prism facets (`Previous source`, `Next source`), every button presents a $\ge 48 \times 48\text{px}$ interactive hit area.
  2. **3D Source Prism Rotation & Geometry (Item 11)**: Clicking `1. LIVE RADIO` $\rightarrow$ `2. ARCHIVE MUSIC` $\rightarrow$ `3. PODCASTS` (or dragging horizontally across the viewport) rotates `[data-testid="source-prism-cylinder"]` in exact $120^\circ$ increments (`0deg`, `-120deg`, `-240deg`) within a `340px`-tall mobile / `260px`-tall desktop 3D stage.
  3. **Unobstructed Bottom Scroll at 390px & 1280px (Item 2)**: Scrolling to the very bottom of AJN TV Guide, AJN Radio, or AJN Rumble brings the final cards and footer links completely above the fixed bottom dock and mobile navigation bar.

- **Visual Identity & Theme**:
  - *Aesthetic Direction*: High-contrast dark-room broadcast hardware with tactile automotive head-unit ergonomics.
  - *Color Palette & Mood*: Deep obsidian canvas (`--ajn-base: #0F1117`, `--ajn-card-2: #181B24`, `--ajn-line: #282D3D`) paired with Copper (`--ajn-accent: #E06D3B`) for active radio controls, Cyan (`#22D3EE`) for Archive Music, and Pink (`#EC4899`) for Podcasts.
  - *Typography & Hierarchy*: `Manrope` / `Plus Jakarta Sans` UI controls with `DM Mono` (`tabular-nums`) for preset indices (`01`–`05`), elapsed timestamps, and live status beacons.
  - *Component Styling & Layout*: Consistent `48px` (`w-12 h-12 !min-w-[48px] !min-h-[48px]`) control geometry, `perspective: 900px` CSS 3D stage with `backface-visibility: hidden` facets, and responsive container padding that respects `env(safe-area-inset-bottom, 0px)`.
- **Interactive Feedback & Motion**:
  - `0.6s cubic-bezier(0.16, 1, 0.3, 1)` rotation settling on prism facet changes, immediate `active:scale-95` tactile press feedback on stepper buttons, and `prefers-reduced-motion` support across all transitions.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1 — Enforcing `!min-w-[48px] !min-h-[48px]` Across Both Mobile & Desktop Steppers**:
  - *Chosen Approach*: Add `!min-w-[48px] !min-h-[48px] w-12 h-12` to `dock-prev`, `dock-next`, `dock-prev-round`, `dock-next-round`, `radio-head-unit-prev`, `radio-head-unit-next`, and the 3D prism's `Previous source` / `Next source` buttons.
  - *Why*: The global platform stylesheet sets a `44px` minimum on buttons with equal specificity, and `flex` shrinkage or root font scaling previously compressed `dock-prev-round` / `dock-next-round` to `40×40px` and `radio-head-unit-prev` / `radio-head-unit-next` to `36×42px`. Important-flagged pixel minimums guarantee a $\ge 48 \times 48\text{px}$ bounding box in `getBoundingClientRect()`.
  - *Alternatives Considered*: Adjusting only mobile steppers, which would still fail the audit script on `dock-prev-round` and `dock-next-round`.
- **Decision 2 — Tagging `[data-testid="source-prism-cylinder"]` with `h-[340px] lg:h-[260px]`**:
  - *Chosen Approach*: Place `data-testid="source-prism-cylinder"` on the inner `preserve-3d` rotating container and size the 3D stage and cylinder with `h-[340px] lg:h-[260px]`, while keeping `[data-testid="source-prism-3d"]` as the outer `<section>` wrapper.
  - *Why*: Matches the Entry 024 DOM contract (`[data-testid="source-prism-3d"]` and `[data-testid="source-prism-cylinder"]`) and ensures the 3D cylinder measures `340px` at `390px` mobile width and `260px` at `1280px` desktop width without cramping the top tab bar.
  - *Alternatives Considered*: Constraining the outer `<section>` to `260px` total height, which would compress the 3D facets by ~48px to make room for the tab strip.
- **Decision 3 — Unified Bottom Clearance on App Viewport & Route Containers**:
  - *Chosen Approach*: Expand bottom padding on `#canonical-main-viewport` (`pb-[18rem] md:pb-[12rem]` when media is active; `pb-44 md:pb-32` when idle) and align the AJN Radio (`#ajn-radio-view`) and TV Guide containers (`pb-[18rem] md:pb-[12rem]`).
  - *Why*: On `390px` viewports, the stacked mobile bottom navigation bar (`56px`), persistent mini-player dock (`72–80px`), and radio stepper bar (`52px`) occupy up to `188px` of fixed bottom screen real estate. Increasing scroll clearance ensures bottom card footers and the `.ajr-footer` bar scroll cleanly into view across `#tv-guide`, `#radio`, and `#rumble`.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:

```
┌────────────────────────────────────────────────────────────────────────────┐
│                   #canonical-main-viewport (App Shell)                     │
│        Bottom Clearance: pb-[18rem] md:pb-[12rem] (active) / pb-44         │
├─────────────────────────────────────┬──────────────────────────────────────┤
│           #ajn-radio-view           │         TV Guide & Rumble Views      │
│     (pb-[18rem] md:pb-[12rem])      │      (pb-[18rem] md:pb-[12rem])      │
│  ┌───────────────────────────────┐  │                                      │
│  │        RadioPresetsBar        │  │                                      │
│  │  • radio-head-unit-prev/next  │  │                                      │
│  │    (!min-w-[48px] !min-h-[48px│  │                                      │
│  │     h-12 min-w-12)            │  │                                      │
│  │  ┌─────────────────────────┐  │  │                                      │
│  │  │     SourcePrism3D       │  │  │                                      │
│  │  │ [data-testid=           │  │  │                                      │
│  │  │  "source-prism-3d"]     │  │  │                                      │
│  │  │  ├─ Tab & Step Controls │  │  │                                      │
│  │  │  │  (!min-w/h-[48px])   │  │  │                                      │
│  │  │  └─ 3D Viewport &       │  │  │                                      │
│  │  │     [data-testid=       │  │  │                                      │
│  │  │      "source-prism-     │  │  │                                      │
│  │  │       cylinder"]        │  │  │                                      │
│  │  │     (h-[340px]          │  │  │                                      │
│  │  │      lg:h-[260px])      │  │  │                                      │
│  │  └─────────────────────────┘  │  │                                      │
│  └───────────────────────────────┘  │                                      │
└─────────────────────────────────────┴──────────────────────────────────────┘
                                      │
                                      ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                  #persistent-mini-player (MiniPlayerDock)                  │
│  • Fixed bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] md:bottom-0 │
│  • Desktop Transport: dock-prev-round & dock-next-round                    │
│    (!min-w-[48px] !min-h-[48px] w-12 h-12)                                 │
│  • Mobile Stepper Row: dock-prev & dock-next                               │
│    (!min-w-[48px] !min-h-[48px] w-12 h-12)                                 │
└────────────────────────────────────────────────────────────────────────────┘
```

- **Data Model & State**:
  - All existing state contracts (`AudioSourceType`, `FACTORY_RADIO_PRESETS`, `NowPlayingMedia`, and `usePersistentMedia`) remain unchanged so zero regressions are introduced to items 3–10 of the audit.
- **Interactive Component & State Mapping**:
  - **MiniPlayerDock Steppers (`dock-prev`, `dock-next`, `dock-prev-round`, `dock-next-round`)**: Maintain `stepStation(-1 | 1)` handler walking `listRadioPresets()` via `pickAdjacentStation`, while enforcing `!min-h-[48px] !min-w-[48px] h-12 w-12 shrink-0` so both mobile and desktop steppers measure $\ge 48 \times 48\text{px}$.
  - **Radio Head Unit Steppers (`radio-head-unit-prev`, `radio-head-unit-next`)**: Maintain `turn(-1 | 1)` handler stepping the active bank or deck catalog, while enforcing `!min-h-[48px] !min-w-[48px] h-12` so neither button can compress below `48×48px`.
  - **3D Source Prism (`SourcePrism3D`)**:
    - Tab buttons (`radio-mode-live`, `radio-mode-archive`, `radio-mode-podcasts`) and `Previous source` / `Next source` steppers enforce `!min-h-[48px] !min-w-[48px]`.
    - The 3D viewport and inner `[data-testid="source-prism-cylinder"]` element use `h-[340px] lg:h-[260px]`, rotating via `translateZ(-${apothemPx}px) rotateY(${displayAngle}deg)` in exact $120^\circ$ increments (`0deg`, `-120deg`, `-240deg`).
