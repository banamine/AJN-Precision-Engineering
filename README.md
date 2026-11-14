# Shows v3 drop-in (whole files, no script)
Your export already has the Shows data/view files from v2. It was missing the wiring. Copy each file here to the same repo path, overwriting:

- src/types.ts                         ('shows' added to Destination)
- src/nav/lastView.ts                  ("shows" added to VALID_DESTINATIONS)
- src/App.tsx                          (imports ShowDrawersView, 'shows' route + view)
- src/components/Navigation.tsx        (Shows nav item + Clapperboard icon import)
- server/classicNetworkPublication.ts  (classicWesternsChannel)
- guideRegistry.ts                     (AJN Westerns channel in classic-tv)
- server/libraryIndex.ts               (skip classic-westerns in library index)
- tools/compile-classic-network.mts, tools/check-classic-network-publication.mjs (classic-westerns file map)

Each file = your Builder export's version + only the Shows/Westerns edits. Verified on that export: tsc 0 errors, vite build OK, server esbuild OK, westerns publication check "ok".
After publishing, hard-refresh (Ctrl+F5). "Shows" appears in the top nav (after Live TV Guide) and under More on mobile.
