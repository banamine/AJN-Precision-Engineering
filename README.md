# Shows v4 drop-in: the rest of the show list (whole files, no script)
Apply ON TOP of v3 (the wiring files you already dropped in). Copy each path over the same repo path:
- src/data/showDrawers.json                (474 shows, 38,996 episodes; was 206 / 9,662)
- src/data/showEpisodes/*.json             (474 files; 268 new, 8 existing shows extended - copy the whole folder)
- src/components/ShowDrawersView.tsx       (adds an episode filter box and "Show more" so 4,000-item lists stay fast)
- tools/verify-shows-data.mjs, tools/build-show-drawers-rest.py, reports/show-drawers/rest-report.json  (optional, for the repo)
Nothing else changes. Hard-refresh (Ctrl+F5) after publishing.

What was added: every show from your series manifests, extra channels (cartoons, movies, TV classics, soaps) and M3U lists whose FIRST and LAST file answered a Range request with 200/206 on 2026-11-14.
Not added (see rest-report.json): talk archives (Alex Jones/Infowars/Liberty Express etc.), Gunsmoke/Maverick/Lawman/Bonanza/Rifleman/Arsenio, 4 sources that return 403 today (American Experience, Dave's Classic British TV & Movies, Honey mooners, Man From U.N.C.L.E.).
