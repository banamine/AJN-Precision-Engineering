# Batch 3 drop-in (behaviour, 2026-11-15) - apply AFTER Batch 2
- LibraryView.tsx
  * RESTORES `music-albums` in the album-queue check (Batch 2 was built from an older export and dropped it; without it an album plays only track 1).
  * Video/audio card: the play circle on the picture and the title are now real buttons that play (before only the Watch button worked).
  * Music Albums (VA): new "Tracks (n)" list on the card; click a track to play from it to the end of the album.
- buildInfo.ts: "batch 3".
Checked, no change needed: "Clear filters" does clear the search box; the prefilled @squidguin was the shared search kept for the browser session.
Not in this batch: Listen Back header/Hour 4, Find & save 36 vs 578 count (need a look at the live behaviour first).
