# Radio Page Collapsible Cockpit Drawers — Maximum Functionality Plan

## 1. Overview & Architecture
Upgrade the lower sections of the Radio page (`#ajn-radio-view`) into a cohesive **Cockpit Drawer System** matching the `Find & save` (`ck-key`) switch aesthetic while adding five high-leverage capabilities:

1. **3-Stage Sizing (`closed` · `preview` · `full`)**:
   - **Minimized (`closed`)**: Collapses the panel body (with auto-pinning for any actively playing episode).
   - **Compact Preview (`preview`)**: Shows a tight **Top 4** view (4 latest episodes in `Listen Back`, 4 latest days in `Full Shows by Day`, or top 2 briefing notes + 4 stories in `Daily Briefing`) so the page stays compact and scannable without a 36-card wall.
   - **Full Expanded (`full`)**: Opens the full 24-card grid (with `+24 More from AJN Radio` step expansion and `Collapse to Top 4` reset) or all 12 `Full Shows by Day` cards.
2. **1-Click Quick-Play & Resume Header Controls**:
   - **Listen Back Header Bar**: Includes a 1-click **`Resume · <Episode> (<mm:ss>)`** cockpit key (`data-testid="drawer-quick-resume"`) whenever `recentlyPlayed` has a saved AJN Radio episode (`progressSeconds >= 5`), plus **`Jump to Playing`** when an archive episode is active.
   - **Full Shows by Day / More from AJN Radio Header Bar**: Includes a 1-click **`Play Latest Full Show · <Show> (<Date>)`** cockpit key (`data-testid="drawer-quick-fullshow"`) for `showDays[0]` (audio, plus video when available) so listeners can start the newest full broadcast without opening the drawer.
3. **Auto-Pin Currently Playing Episode When Minimized**:
   - When `Listen Back` is set to `closed` (minimized) while an archive episode (`playingEntry`) is actively playing or paused in the persistent player, `section#ajr-listen` renders a single pinned `<li className="ajr-card playing" data-testid="radio-entry">` card (complete with progress bar, `FULL SHOW`, and `VIDEO` buttons) beneath the collapsed header bar.
4. **Persistent Drawer State in `localStorage` (`ajn.radio.drawers.v1`)**:
   - Stores `{ findOpen: boolean; listenStage: 'closed' | 'preview' | 'full'; fullShowsStage: 'closed' | 'preview' | 'full'; briefingStage: 'closed' | 'preview' | 'full' }` in `localStorage` under `ajn.radio.drawers.v1` with safe JSON parsing so user layout preferences persist across reloads.
5. **Master Cockpit Command Bar (`Collapse All` · `Preview Top 4` · `Expand All`)**:
   - A compact toolbar (`data-testid="radio-drawer-master"`) right below `NowPlayingPanel` with status indicators for all four drawers (`Find & Save`, `Listen Back`, `Full Shows`, `Daily Briefing`) and one-tap **Collapse All** (`all -> closed`) and **Expand All** (`all -> full`) cockpit switches.

---

## 2. File-Level Changes

### A. `src/utils/radioDrawers.ts` (New Pure Helper Module)
- Define and export:
  - `export type DrawerStage = 'closed' | 'preview' | 'full';`
  - `export interface RadioDrawerPrefs { findOpen: boolean; listenStage: DrawerStage; fullShowsStage: DrawerStage; briefingStage: DrawerStage; }`
  - `export const RADIO_DRAWERS_KEY = 'ajn.radio.drawers.v1';`
  - `export const PREVIEW_COUNT = 4;`
  - `readRadioDrawerPrefs(storage?: Pick<Storage, 'getItem'> | null): RadioDrawerPrefs` — safely reads and validates persisted drawer states, defaulting to `{ findOpen: false, listenStage: 'preview', fullShowsStage: 'closed', briefingStage: 'preview' }` (which keeps the initial page compact at 4 preview cards while keeping all `test-radio-view.js` DOM selectors mounted).
  - `writeRadioDrawerPrefs(prefs: RadioDrawerPrefs, storage?: Pick<Storage, 'setItem'> | null): void` — persists changes cleanly.
  - `nextDrawerStage(current: DrawerStage): DrawerStage` — cycles or toggles stage transitions.

### B. `src/components/RadioView.tsx`
1. **Master Cockpit Command Bar (`data-testid="radio-drawer-master"`)**:
   - Rendered directly below `<NowPlayingPanel />` when `!listenBackOpen`.
   - Provides:
     - `Collapse All` (`ck-key ck-key--sm`, `data-testid="drawers-collapse-all"`): Sets `findOpen = false`, `listenStage = 'closed'`, `fullShowsStage = 'closed'`, `briefingStage = 'closed'`.
     - `Preview Mode (Top 4)` (`ck-key ck-key--sm`, `data-testid="drawers-preview-all"`): Sets `listenStage = 'preview'`, `fullShowsStage = 'preview'`, `briefingStage = 'preview'`.
     - `Expand All` (`ck-key ck-key--sm`, `data-testid="drawers-expand-all"`): Opens `listenStage = 'full'`, `fullShowsStage = 'full'`, `briefingStage = 'full'`.
2. **`Find & save` Drawer (`section[data-testid="find-drawer"]`)**:
   - Connected to `prefs.findOpen` (`ck-key` with `.is-latched` when open).
3. **`Listen Back` Archive Drawer (`section#ajr-listen`)**:
   - **Cockpit Header Bar**:
     - Primary toggle button (`ck-key`, `data-testid="listen-archive-toggle"`, `aria-expanded={listenStage !== 'closed'}`):
       - Toggles between `closed` and `preview` (or `full`).
       - Displays live counts: `{listenStage === 'closed' ? 'Listen back' : 'Hide Listen back'} · {catalog.radio.length} AJN Radio · {catalog.exclusive.length} Exclusive`.
     - Stage switcher button (`ck-key ck-key--sm`, `data-testid="listen-stage-toggle"`):
       - Switches between `Top 4 Preview` (`preview`) and `Full Archive (${shown.length})` (`full`).
     - **1-Click Quick-Resume Button (`ck-key ck-key--sm`, `data-testid="drawer-quick-resume"`)**:
       - Finds the latest resumable episode from `recentlyPlayed` matching `everyEntry` and plays/resumes it in one click (`Resume · {entry.title} · {formatClock(saved)}`).
   - **Auto-Pinned Playing Card When `listenStage === 'closed'`**:
     - If `listenStage === 'closed'` and `playingEntry` exists, renders a single-item `ul.ajr-grid` containing only `playingEntry` with a `PINNED · NOW PLAYING` label so the listener retains full episode controls (`FULL SHOW`, `VIDEO`, progress bar) while the rest of the archive is minimized.
   - **Open Body (`listenStage === 'preview' | 'full'`)**:
     - Renders the heading, channel tabs, filter chips, sort & search controls, and `ul.ajr-grid` sliced to `PREVIEW_COUNT` (4) in `'preview'` mode or `visible` (24, expandable in steps of 24) in `'full'` mode.
4. **`More from AJN Radio & Full Shows by Day` Collapsible Drawer**:
   - Placed at the bottom of `section#ajr-listen` with its own cockpit control bar:
     - **Expand / Collapse Episodes Button (`ck-key`, `data-testid="more-ajn-episodes-toggle"`)**:
       - In `preview` mode or when `shown.length > currentSlice.length`, clicking expands to show more episodes (`More from ${label} · +${shown.length - currentSlice.length} episodes`); when expanded past 4, includes a companion `Collapse to Top 4` (`ck-key ck-key--sm`) button.
     - **Full Shows by Day Drawer Button (`ck-key`, `data-testid="full-shows-drawer-toggle"`, `aria-expanded={fullShowsStage !== 'closed'}`)**:
       - Opens/closes `<FullShowDays>` (`closed` -> `preview` (4 days) -> `full` (12 days)).
     - **1-Click Play Latest Full Show (`ck-key ck-key--sm`, `data-testid="drawer-quick-fullshow"`)**:
       - Immediately starts `playFullShow(showDays[0], 'audio')` (and offers a compact `Latest Video` key if `planFullShow(showDays[0], 'video').playable`) right from the header bar even when the Full Shows drawer is closed.

### C. `src/components/DailyBriefing.tsx`
- Accept optional `stage?: DrawerStage` and `onStageChange?: (next: DrawerStage) => void` props from `RadioView` (with internal fallback state if rendered standalone).
- Add a cockpit header bar at the top of `section#ajr-news`:
  - **Primary Toggle (`ck-key`, `data-testid="daily-briefing-toggle"`, `aria-expanded={stage !== 'closed'}`)**:
    - Toggles between `closed` and `preview` (`Daily briefing · Read the news · ${digest.briefing.length} notes · ${digest.top.length} stories`).
  - **Stage Switcher (`ck-key ck-key--sm`, `data-testid="daily-briefing-stage"`)**:
    - Toggles between `Compact Preview` (up to 2 briefing blocks and 4 story cards) and `Full Briefing` (all briefing blocks and all stories for the selected source).

---

## 3. Guardrails & Verification
- **Protected Files Untouched**: Only `src/utils/radioDrawers.ts`, `src/components/RadioView.tsx`, and `src/components/DailyBriefing.tsx` are created/updated.
- **Regression Compatibility**: Default `'preview'` stage keeps `.ajr-tabs`, `.ajr-chips`, `.ajr-search`, `.ajr-select`, the 4 test `[data-testid="radio-entry"]` cards, `[data-testid="briefing-block"]`, and `[data-testid="digest-story"]` mounted so `test-radio-view.js` passes without modification.
