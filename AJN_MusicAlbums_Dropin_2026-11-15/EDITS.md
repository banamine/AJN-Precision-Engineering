# AJN Music Albums (VA) — search-only drop-in
301 @only2try "VA - ..." albums, 19,567 songs. One Library record per album; every song is searchable inside it. NO channels, no guide changes.
Excluded: SoundBible sound effects. Skipped: va-reggae-tropical-party-2020 (no opus files on Archive).
Estimated lengths: tracks without Archive metadata use size*8/136000 s; those albums show the "Estimated length" tooltip (durEst).
Playback: opus originals via /api/archive/proxy. Needs the Opus patch (mediaSelector + .opus -> audio/ogg) only if the player selector rejects opus; tracks are played by direct path like concerts.

Apply (repo root): copy server/, src/ over the repo, then `python apply-edits.py`. Verify: `npx tsx test-music-albums.ts` -> "test-music-albums OK 301 albums 19567 songs", then `npm run test:library`.
Edits: libraryIndex.ts (import, category 'music-albums', allRecords, test switch), catalogRecords.ts (category counts as catalog: skips the probe), LibraryView.tsx (album plays as an in-order queue).
Regenerate: python gen_manifest.py only2try_VA_album_files_2026-11-15.json src/data/musicAlbumsManifest.json

## v2 (2026-11-15): Archive Music deck by GENRE
The Archive Music deck (Radio > Archive Music > Music channels) used one pool per channel, so the keys were channel names. It now works like Live Concerts: "All music" + one pool per genre (20 genres), mixing the existing 69 music channels and the 301 VA albums (22,633 tracks). Direct-tune genre keys (up to 24), pool dropdown, 24h Clock and Shuffle all work per genre; "All music" shuffles everything.
- New: `src/utils/musicGenrePools.ts`; albums now carry a genre (`g`) in the manifest, also searchable in the Library.
- `python apply-edits.py` again (idempotent): adds 7 anchored edits to `src/components/ScheduleDeck.tsx`. Copy `server/` and `src/` over the repo first (manifest + records changed).
- Verify: `npx tsx test-music-genres.ts` -> "test-music-genres OK 20 genres ... tracks 22633".
- Clock note: tracks with estimated length keep NO duration in the deck (never a fake clock). Genre pools that include VA albums are Shuffle-only; the Library still shows the estimates.
- Not changed: the 5-key preset browse list and the "Find & save" browser still list channels only.
