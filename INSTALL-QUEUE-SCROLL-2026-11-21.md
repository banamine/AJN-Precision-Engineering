# Queue lists + stage height (2026-11-21)
Supersedes AJN_OneScreen_Dock zip: includes all of its files plus index.css and BrowsePanel.tsx. Drop each at the same path.
- index.css: slim scrollbar (thumb #334155, transparent track) on .ajn-queue-scroll; new .ajn-queue-scroll--rows-3 (3 rows at every width) and --tall (56 px rows); the video stage .ajn-player-page-video has max-height 40dvh and a floor.
- PlayerChrome.tsx: Recently Played + Up Next (and their empty states) use --rows-3.
- BrowsePanel.tsx: the two lists in the Up Next / On Now flyout now use ajn-queue-scroll (they were unbounded).
