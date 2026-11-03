# AJN Concert Library — v2 drop-in (2026-11-03)
Supersedes v1. Source: @paris-portland, `subject:"live concert"`. Library data + pooled genre channels only; no UI work.

## What changed vs v1
1. **Genre overrides** `config/concert-genre-overrides.json` (576 identifier-level assignments, DRAFT, unreviewed by you). Unclassified 45.1% -> 1.5% (20 of 1,304; all compilations/mixed bills left Unclassified on purpose).
2. **includeMissingLanguage: true** -> +30 no-language concerts. 1,304 concerts / 13,660 tracks (manifest 1.54 MB, 410 KB gzipped).
3. **Stratified staging manifest** `reports/concertPoolsManifest.staging.json`: 25 concerts, all 7 pools, hash-picked (not alphabetical), always includes up to 3 concerts with `# & % ' ( ) , ...` filenames. Rebuild: `python tools/build-concert-library.py --stage-sample 25`.
4. **Gate now measures the manifest** (`catalog-gate.mjs`, `catalog-refresh.json`, workflow, tests). Before this patch the gate read only `dataFiles` extra/docs/audio, so the concert manifest was invisible. New concert/pool changes => verdict `review`; removals, genre moves, in-place edits and >100 new concerts / >1,500 new tracks also review; new pool channels flagged (station numbers after them shift).
5. `tools/verify-concert-proxy.mjs`: checks special-character filenames through `/api/archive/proxy`.

## Install (file-by-file)
Copy: `tools/build-concert-library.py`, `tools/test_concert_library.py`, `tools/verify-concert-proxy.mjs`, `server/concertPools.ts`, `test-concert-pools.ts`, `config/concert-genre-overrides.json`.
Patch: `patch -p1 < patches/guideRegistry.concert-pools.patch` and `patch -p1 < patches/gate-config-workflow.patch` (both verified to apply to the originals; applied result byte-identical to my tested copies).
Data: **staging first** - copy `reports/concertPoolsManifest.staging.json` to `src/data/concertPoolsManifest.json`. (`concertPoolsManifest.placeholder.json` = empty state if the import must exist before data.) Full manifest `src/data/concertPoolsManifest.json` goes in only after staging passes.
Config: `sources["paris-portland"].enabled` stays **false** in the patch; flip to true deliberately (nightly workflow then rebuilds the manifest and the gate reviews it).

## Verification you run (nothing below was run against your app)
```
python tools/test_concert_library.py          # expect: Ran 15 tests ... OK
npx tsx test-concert-pools.ts                 # expect: concert pools: all passed
node test-catalog-gate.mjs                    # expect: PASS catalog-gate ...
npm run typecheck && npm test                 # NOT run by me
npm run dev                                   # then, other shell:
node tools/verify-concert-proxy.mjs           # expect: N/N passed; each line PASS 206 audio/mpeg bytes ...
```
Special-char URL form = `/api/archive/proxy?path=` + encodeURIComponent(`/download/<id>/<per-segment-encoded file>`) (same as `toProxy()`); the thing under test is that the proxy decodes exactly once. Any FAIL line is a real proxy bug: send it to me, do not mask it.
Then in the app: Audio guide shows 7 "Live Concerts: <genre>" channels, each filled for a full 24 h with no gaps, thumbnails load, tracks play and seek (Range).

## Verified here vs not
Verified (offline/real data): enumeration of 1,759 uploads; 1,304 metadata fetches 0 errors; all unit tests above incl. mutation checks; rotation coverage 100% on real pools; patches apply cleanly.
NOT verified: full repo typecheck/npm test, app render, `/api/schedule` payload size (concerts bake ~13.7k tracks into the audio guide - check against guide MB budget), `thumbnailUrl` via proxy, 51 MB track behaviour on Cloud Run (bounded slices should cover it), `catalog-probe.mjs` does NOT probe concert tracks.

## Open decisions
- Overrides are my draft: skim `reports/unclassified-for-review.csv` and the 576 entries (e.g. Dave Grusin big band sits in Electronic - arguably wrong; edit the JSON, rebuild is instant from cache).
- Rights: FM broadcast recordings, licence fields empty - your call before publishing.
- 7 new channel names shift later audio station numbers by <=7.
- One French-host item `the-cure-black-sessions-paris-france-inter-2004` slipped through English filter.
