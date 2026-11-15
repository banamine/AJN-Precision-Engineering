# Batch 1 drop-in (2026-11-15)
Unzip over the project root (paths are root-relative, no wrapper). Base: your newest AI Studio export. 6 files:
- src/data/showDrawers.json : 22 shows re-filed (Soaps & Drama -> Sci-Fi / Sitcoms & Comedy / Crime & Spy; Mr Rogers -> Ch 103; Superman -> Sci-Fi). Pill only, no episode data touched. Regenerating with tools/build-show-drawers-rest.py would undo this.
- src/components/ShowDrawersView.tsx : "474 shows - 38,996 episodes" line.
- src/components/TodayView.tsx : "programmes" -> "programs".
- src/guide/genreBuckets.ts : "&amp" shown as "&"; "Western" chip merged into "Westerns".
- src/components/Navigation.tsx + src/buildInfo.ts : build line at the bottom of both More menus (bumped by hand each drop-in).
Not changed: Amen thumbnail (data), layout clips (Batch 2).
