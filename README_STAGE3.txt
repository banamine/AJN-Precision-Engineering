AJN Uniform Shell - Stage 3 v2 (2026-11-18). Install on top of Stage 2 v4 (stage 2 files stay).
 src/index.css + dock clearance. src/App.tsx  Shows, Today, Library, Search and TV Guide now use the fixed-height shell: page never scrolls, one scroll region each.
Known risk: the TV Guide used to restore its scroll position on the page; it now scrolls inside its own region, so a saved position may not restore. Tell me if so.
