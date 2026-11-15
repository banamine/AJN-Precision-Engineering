# Music albums (VA) + Archive Music genre deck: drop-in
Drop the contents of this zip onto the project root (same paths, overwrite). No scripts, no edits.
Files (all full files, built from your current AI Studio export):
- NEW  server/library/musicAlbumRecords.ts, src/utils/musicGenrePools.ts, src/data/musicAlbumsManifest.json (1.8 MB), test-music-albums.ts, test-music-genres.ts
- FULL REPLACEMENTS (only the lines below changed in each):
  server/libraryIndex.ts (import, 'music-albums' category, albums added to the catalog-record list that tests can isolate)
  server/library/catalogRecords.ts ('music-albums' counted as a catalog category)
  src/components/LibraryView.tsx (album plays as an ordered queue)
  src/components/ScheduleDeck.tsx (Archive Music pools by genre, like Live Concerts)
Check after drop-in: Radio > Archive Music shows "All music" + genre buttons; Library search finds songs under "Music Albums (VA)".
Tests: npx tsx test-music-genres.ts  and  npx tsx test-music-albums.ts
