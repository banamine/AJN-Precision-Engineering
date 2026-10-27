AJN FULL RESTORE DROP-IN v2 (2026-10-27) - replaces v1. Fixes the two errors from the v1 build.

FIX 1  "Cannot set property fetch of #<Window> which has only a getter"
  Cause: v1 shipped the offline DEMO mode (src/demo/demo-entry.tsx assigns window.fetch). Not needed in AI Studio.
  Fix: demo mode removed; src/main.tsx back to the normal entry.
FIX 2  "vite build Killed / exit code 137" (out of memory)
  Cause: the build ran while the old server was warming every guide (148 + 244 + 1521 channels) in the
  same container. The new server.ts only warms when AJN_BOOT_WARMERS=1. Vite now skips gzip size
  reporting and source maps. Measured peak build memory: 937 MB (main: 908 MB).

GOOGLE BUILDER: DO EXACTLY THIS
1. Copy every file in this ZIP to the same path, overwriting. Create folders if needed.
2. DELETE these files/folders:
     src/components/ArchiveOutageBanner.tsx
     src/demo/                       (whole folder)
     tools/build-demo.cjs
     tools/checks/demo-check.cjs
     tools/checks/production-demo-guard.cjs
     tools/demo-fixtures/            (whole folder)
3. Edit nothing else. Do not run tests. Then run the build once. If it is killed again, restart the
   app (stop the dev server) and build again.
4. Report: files written, files deleted, build result.

CONTENTS: same as v1 (status pills in the top bar, BANNED VIDEO tab, subtitles, Retry countdown, warmers gate,
music player + gate fix, live HLS probe, Jeffersons/Good Times/Mister Ed/Fish/Rob!, Library Soap Operas /
All My Children, podcast inactive labels, Archive waiting-room acronyms, affiliate listing relay kept,
visible archive.org text removed). Links/URLs/proxy unchanged.
Gate on this exact tree: tsc 0 errors, npm run build OK, restore tests PASS.
