# Entry 024 — SourcePrism3D & Dock Audit Fixes

This update implements the 3-sided equilateral **SourcePrism3D** audio source switcher directly inside the Radio head unit in place of the static 3-button source selector, enforces 48px touch targets and mobile bottom-bar clearance on the persistent mini-player dock, verifies honest Web Audio spectrum status indicators, and expands bottom scroll clearance on the TV Guide and Radio views.

## User Review & Critical Decisions

> [!IMPORTANT]
> This revised plan incorporates your exact four-step Builder Directive. Click **Proceed** to execute the build and verification suite.

- **Confirmed Decision 1 — 3-Sided Equilateral `SourcePrism3D` Component**:
  - Implement the CSS 3D prism ($120^\circ$ increments, `perspective: 900px`, `backface-visibility: hidden`) with dynamic apothem geometry `apothemPx = Math.round((prismWidth / 3.4641) * 10) / 10`.
  - Enforce Entry 015 mobile height `h-[340px] sm:h-[260px]` with `overflow-hidden` on both the scene and facets so there is zero internal scrolling.
  - Strict Doctrine 1 compliance: zero `Math.random`, zero `Math.sin`, and no unverified FM strings—using only the five canonical channel IDs (`radio:ajn-alex-jones-show`, `radio:infowars-live-aac`, `radio:ch109-original`, `radio:ch109-classic-rock`, `radio:ch109-warm-109`).
- **Confirmed Decision 2 — Replace Static Source Buttons in `RadioPresetsBar`**:
  - Mount `<SourcePrism3D />` directly in place of the static 3-button source selector (`Live Radio`, `Archive Music`, `Podcasts`) so no duplicate source buttons are rendered, mapping `mode` (`'live' | 'archive' | 'podcasts'`) cleanly to `AudioSourceType` (`'radio' | 'music' | 'podcasts'`).
  - Keep `<RadioSpectrum playing={live || Boolean(playingNow)} />` active whenever any audio plays and surface the honest `"Spectrum unavailable"` indicator when `playingNow` is true without an active `AnalyserNode`.
- **Confirmed Decision 3 — MiniPlayerDock Touch Targets & Mobile Clearance**:
  - Enforce `!min-h-[48px] !min-w-[48px] h-12 w-12 shrink-0` on `dock-prev` and `dock-next` to override the global 44px shell rule.
  - Set mobile dock positioning to `bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] md:bottom-0` so the dock never overlaps the bottom navigation bar.
- **Confirmed Decision 4 — Scroll Viewport Bottom Clearance**:
  - Set the outer container bottom padding in both the TV Guide view and Radio view to `pb-[17rem] md:pb-[12rem]` so all trailing content scrolls clear above the dock and bottom navigation bar.

---

## 1. Overview & Core Concept

- **What It Does**: Replaces the flat 3-button audio source switcher inside the Radio head unit with a 3-sided equilateral 3D prism (`Live Radio`, `Archive Music`, `Podcasts`), while resolving mobile audit failures for stepper touch-target dimensions, dock-to-navbar vertical clearance, and scroll container bottom padding.
- **Target Audience / Persona**: Mobile (390px) and desktop listeners switching between live streams, archival music/concerts, and daily talk podcasts.
- **Key Value**: Eliminates duplicate source buttons, guarantees $\ge 48\text{px}$ touch targets and unobstructed scrolling on mobile viewports, and maintains strict audio signal honesty.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Single Authoritative Source Switcher (`SourcePrism3D`)**: Inside the Radio head unit, listeners switch between `1. LIVE RADIO`, `2. ARCHIVE MUSIC`, and `3. PODCASTS` via the prism tabs, `‹` / `›` steppers, or horizontal pointer drag ($\pm 40\text{px}$ threshold), rotating the 3-sided prism in $120^\circ$ steps and driving the head unit's active mode (`live`, `archive`, `podcasts`) without duplicate source buttons.
  2. **Factory Live Radio Presets (`P01`–`P05`)**: On Facet 0 (`Live Radio`), tapping any of the five factory presets tunes the corresponding canonical `radio:*` channel ID through the persistent player and reflects live `● ON AIR` / `STANDBY` status.
  3. **Honest Spectrum Bay**: The head-unit spectrum bay receives `playing={live || Boolean(playingNow)}` and displays `"Spectrum unavailable"` whenever audio is playing without an active Web Audio `AnalyserNode`.
  4. **Mobile Dock & Viewport Clearance**: On mobile viewports, the persistent dock is anchored at `bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] md:bottom-0` with `!min-h-[48px] !min-w-[48px] h-12 w-12 shrink-0` on `dock-prev` and `dock-next`, and both the TV Guide and Radio views include `pb-[17rem] md:pb-[12rem]` bottom padding.

- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Precision dark-room broadcast hardware with tactile 3D facet transitions.
  - *Color Palette & Mood*: Obsidian surfaces (`#0F1117`, `#181B24`) with semantic facet accents—Copper (`#E06D3B`) for Live Radio, Cyan (`#22D3EE`) for Archive Music, and Pink (`#EC4899`) for Podcasts.
  - *Typography & Hierarchy*: Crisp uppercase tab controls, bold facet titles, and `font-mono tabular-nums` preset numbers (`01`–`05`) and status badges.
  - *Component Styling & Layout*: CSS 3D scene (`perspective: 900px`, `h-[340px] sm:h-[260px]`, `overflow-hidden`) with `ResizeObserver`-driven apothem offset `translateZ(±apothemPx)` and `backface-visibility: hidden` on all three facets.
- **Interactive Feedback & Motion**:
  - Smooth settling curve (`transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)`) on tab and stepper clicks; immediate `transition: none` tracking during pointer drag.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1 — Mounting `SourcePrism3D` Directly in `RadioPresetsBar`**:
  - *Chosen Approach*: Replace the existing `role="group" aria-label="Radio source"` 3-button strip inside the head unit with `<SourcePrism3D />`, mapping `mode === 'live' ? 'radio' : mode === 'archive' ? 'music' : 'podcasts'` to `activeSource`.
  - *Why*: Prevents duplicate source selectors on the Radio page and keeps the head unit's LCD, sub-mode pills (`Music channels` / `Live concerts`), preset keys, and `DeckPicker` synchronized with the 3D prism.
  - *Alternatives Considered*: Rendering `SourcePrism3D` alongside the existing 3-button strip, which would create redundant controls and split state.
- **Decision 2 — Important-Prefixed Touch Targets (`!min-h-[48px] !min-w-[48px] h-12 w-12 shrink-0`)**:
  - *Chosen Approach*: Apply `!min-h-[48px] !min-w-[48px] h-12 w-12 shrink-0` to `dock-prev` and `dock-next` in the mobile dock stepper bar.
  - *Why*: Overrides the `.ajn-platform-shell` 44px rule in `theme.css` and satisfies both the 48px audit and `test-touch-targets.tsx`.
- **Decision 3 — Scroll Viewport Bottom Padding (`pb-[17rem] md:pb-[12rem]`)**:
  - *Chosen Approach*: Apply `pb-[17rem] md:pb-[12rem]` to the outer containers of the TV Guide and Radio views.
  - *Why*: Guarantees 272px of bottom scroll clearance on mobile viewports so the bottom-most rows clear the dock and navigation bar.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:

```
┌───────────────────────────────────────────────────────────────────────────┐
│                         App Shell & Persistent Media                      │
│  ┌─────────────────────────┐              ┌────────────────────────────┐  │
│  │ #persistent-player      │◄────────────►│ findPersistentMedia('audio'│  │
│  │ (Single <audio>/<video>)│              └──────┬──────────────┬──────┘  │
│  └───────────┬─────────────┘                     │              │         │
└──────────────┼───────────────────────────────────┼──────────────┼─────────┘
               │                                   │              │
               ▼                                   ▼              ▼
┌────────────────────────────────────┐  ┌───────────────────────────────────┐
│             RadioView              │  │          MiniPlayerDock           │
│    (pb-[17rem] md:pb-[12rem])      │  │ • bottom-[calc(3.5rem+env(...))]  │
│                                    │  │   md:bottom-0                     │
│  ┌──────────────────────────────┐  │  │ • dock-prev & dock-next:          │
│  │       RadioPresetsBar        │  │  │   !min-h-[48px] !min-w-[48px]     │
│  │  ┌────────────────────────┐  │  │  │   h-12 w-12 shrink-0              │
│  │  │     SourcePrism3D      │  │  │  └───────────────────────────────────┘
│  │  │  • Facet 0: Live Radio │  │  │
│  │  │    (P01–P05 Presets)   │  │  │  ┌───────────────────────────────────┐
│  │  │  • Facet 1: Music      │  │  │  │            TvGuideView            │
│  │  │  • Facet 2: Podcasts   │  │  │  │ • pb-[17rem] md:pb-[12rem]        │
│  │  └────────────────────────┘  │  │  └───────────────────────────────────┘
│  │  ┌────────────────────────┐  │  │
│  │  │     RadioSpectrum      │  │  │
│  │  │  (live || playingNow)  │  │  │
│  │  └────────────────────────┘  │  │
│  └──────────────────────────────┘  │
└────────────────────────────────────┘
```

- **Data Model & State**:
  - `AudioSourceType`: `'radio' | 'music' | 'podcasts'` mapped 1-to-1 with `RadioPresetsBar` mode (`'live' | 'archive' | 'podcasts'`).
  - `FACTORY_RADIO_PRESETS`: Canonical 5-preset array (`radio:ajn-alex-jones-show`, `radio:infowars-live-aac`, `radio:ch109-original`, `radio:ch109-classic-rock`, `radio:ch109-warm-109`).
- **Interactive Component & State Mapping**:
  - `SourcePrism3D.onSelectSource`: Maps `'radio' -> 'live'`, `'music' -> 'archive'`, and `'podcasts' -> 'podcasts'`, resetting `listPage`, `browse`, and `storeArmed`, and triggering `loadConcerts()` / `loadSpoken()` as needed.
  - `SourcePrism3D.onPlayStation`: Tunes the matching saved or factory preset via `onPlay` and registers CORS-verified streams with `registerLiveRadioMeter`.
  - Verification suite (`npm run lint && npm run test:radio-ui && npm run build`): Executed after applying all four edits once the plan is approved.
