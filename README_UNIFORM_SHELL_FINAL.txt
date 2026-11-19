AJN Uniform Shell - FINAL drop-in (2026-11-18). Replaces ALL earlier stage 1/2/3 zips. Drop in over your latest export.
Files:
  src/App.tsx                     one-screen shell for Home, Radio, Shows, Today, Library, Search, News, News Cube, Weather, History, Watch Later (page never scrolls; one scroll region each; dock clearance). Dev unchanged.
                                  TV Guide deliberately NOT in the shell: EpgGuide virtualizes rows from window scroll (EpgGuide.tsx ~771, 1229, 1271); an inner scroller would blank rows.
  src/index.css                   shell, player layout (A >=1024 / B <1024 + landscape), audio compact stage, dark scrollbars, dock clearance
  src/components/PlayerWidget.tsx shared collapsible widgets (aria-expanded/controls, hidden region, per-breakpoint memory, accordion <1024)
  src/components/PlayerView.tsx   video Full player = stage + transport + widgets; audio page compact stage
  src/components/MiniPlayerDock.tsx  visible "Full player" label (Radio: Expand Deck + Full player)
  src/components/HomeView.tsx     On now wall 2x2 <1024, 4 across >=1024
Checked: esbuild syntax on all TSX; PlayerWidgets behaviour in headless Chrome (wide: defaults open, toggles independent; 390px: accordion, aria-expanded matches visibility).
NOT checked: the full app (no dependencies here) - test in the live Gemini preview.
Not done: News/Weather/History/etc. are not rebuilt as widgets (shell only); TV Guide layout; Radio reflow; audio page widgets.

UPDATE v2 (Discover/Home as widgets): HomeView.tsx now renders Discover as collapsible widgets (Now playing/Featured, Live now, Live radio & hubs, AJN Programs, Today on AJN, Recently played, Favorites, Jump to). Wide: 2-column grid, hero spans both; <1024: single column accordion, hero open by default. PlayerWidget.tsx gained an optional className per widget. Syntax-checked only; test Discover at phone/tablet/desktop.

UPDATE v3: (1) Discover widgets now flow in two balanced columns on wide screens (CSS columns, hero spans both) so no empty space beside a tall widget; widget gaps tightened; less top padding on one-screen tabs. (2) TV Guide: compact header (description hidden on phones), "Select guide" is a collapsible widget (closed by default on phones, title shows the current guide), Rush picker / live health / legend are widgets below. The guide grid itself (EpgGuide.tsx) is UNCHANGED and still scrolls with the page (its row virtualization needs window scroll).
New in this zip vs v2: src/components/TvGuideView.tsx. Also changed: HomeView.tsx, PlayerWidget.tsx, index.css.
