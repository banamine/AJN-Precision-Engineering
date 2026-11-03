# My Library (WatchLaterView) — mockup 08 — 1 file
Only src/components/WatchLaterView.tsx (AJN_LIBRARY.patch).
- Row list -> responsive card grid (1/2/3 columns): thumbnail (real thumbnailUrl, hides itself if it fails) with duration, title, Audio/Video + channel tags, resume position, progress bar, "Play" and copper "Remove" buttons.
- Kept: header, History link, Clear all + confirm, empty state, test ids (watch-later-view, watch-later-row, watch-later-empty), aria-labels on Play/Remove, no new props/data.
- New: data-testid="watch-later-grid". Thumbnail button is aria-hidden/tabIndex -1 (the Play button is the accessible control).
Not run in the real app (checks: syntax parse only). Verify: git diff --stat = 1 file; save an item with Watch Later, open My Library.
