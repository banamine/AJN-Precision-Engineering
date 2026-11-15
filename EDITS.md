# Extra library drop-in (2026-11-14): @edith377 + @squidguin, search only
1. Copy `src/data/extraLibraryManifest.json`, `server/library/extraLibraryRecords.ts`, `test-extra-library.ts` into the repo (same paths).
2. From the repo root: `python apply-edits.py` (3 edits in `server/libraryIndex.ts`: import, a test switch, and `extraLibraryRecords()` in `allRecords()`; tests that install their own fixture ignore the extra records). Safe to re-run.
3. Test: `npx tsx test-extra-library.ts` expect `test-extra-library OK 392 records; 18 series`. Then `npm run test:library`.
Creates NO channel, no guide row, no schedule change. Items merge by id `ia-<identifier>`: if one is already in the Library it only gains a category.
Data: 116 @edith377 (78 Green Acres, 24 films, others) + 276 @squidguin movie favorites. All answered Range 206 on 2026-11-14. Not tested: browser playback, proxy path, payload size effect (manifest 75 KB).
Known: Man With a Camera "The Killer" and Town of the Times each have two uploads (both kept). Charlie Chan, Captain Midnight and Playhouse 90 groupings are by title only.
