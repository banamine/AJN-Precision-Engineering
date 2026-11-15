# AJN 24/7 Genre Channels drop-in (8 channels: 5 TV + 3 movie)

Base: `banamine/AJN-Precision-Engineering` `origin/main` @ `a0d5659` (2026-11-14). Files below replace the repo copies at the SAME paths.
Flagship channels (`classic-network` Station 1, `classic-westerns`, `classic-movies`) are unchanged: lanes-mode output is byte-identical (verified old vs new compiler).

## Replace (full files)
| Path | Change |
|---|---|
| `server/classicNetwork.ts` | + `shuffle-in-order` and `random-movie` modes, `evidenceReport()`, `seededIndex()`; `lanes` code path untouched |
| `server/classicNetworkPublication.ts` | + 8 lazy publication readers, `genreTvChannels()`, `genreMovieChannels()` |
| `guideRegistry.ts` | 3 one-line edits (import, classic-tv list, movies list) - see fallback below |
| `server/libraryIndex.ts` | 1 import + 1 condition: genre channels skipped by library index like the other classic networks |
| `src/guide/genreBuckets.ts` | + `cartoons` bucket and fixed pills for the 5 TV channels |
| `src/guide/channelIndex.ts` | the 5 TV genre channels are pinned at stations 2-6, right behind Classic Network (station 1); everything else stays alphabetical |
| `config/classic-networks.json` | + 8 `ajn247-*` networks; the 3 existing networks are identical |
| `tools/compile-classic-network.mts` | per-network `publicationRef`, evidence report output |
## Add (new)
`src/guide/genreChannelIds.ts`, `config/genre-channels.json`, `config/movie-genre-overrides.json`, `tools/build-genre-catalogs.mts`, `tests/test-genre-channels.ts`,
`src/data/genre/*Catalog.json` + `*Publication.json` (8 each), `reports/classic-network/genre-*.json` and `ajn247-*-evidence.json`.

## If Google Builder cannot take full-file replacement for the 3 small files, apply exactly these edits
`guideRegistry.ts`:
1. `import { classicNetworkChannel, classicMoviesChannel, classicWesternsChannel } from './server/classicNetworkPublication';` -> add `, genreTvChannels, genreMovieChannels` inside the braces.
2. `return [classicNetworkChannel(),classicWesternsChannel(),...classic,...additions];` -> `return [classicNetworkChannel(),classicWesternsChannel(),...genreTvChannels(),...classic,...additions];`
3. `return [classicMoviesChannel(),{` (the `id:'classic-cinema'` object in the movies-classics-vault branch) -> `return [classicMoviesChannel(),...genreMovieChannels(),{`
`server/libraryIndex.ts`: add `import { isGenreChannelId } from '../src/guide/genreChannelIds';` and change the `classic-westerns` skip line to `... || ch.id === 'classic-westerns' || isGenreChannelId(ch.id)) continue;`

## Verify (run from repo root; expected output in brackets)
1. `npx tsx tests/test-genre-channels.ts`  [13 PASS lines then `ALL 13 GENRE CHANNEL CHECKS PASSED`]
2. `npx tsx tools/build-genre-catalogs.mts` then `npx tsx tools/compile-classic-network.mts --network ajn247-sitcoms`  [revision equals `src/data/genre/ajn247-sitcomsPublication.json` revision - deterministic]
3. In the running app: Classic TV guide shows AJN Classic TV (Station 1), AJN Westerns, then the 5 new channels; Movies guide shows AJN Classic Movies then the 3 movie channels. Pills: Comedy / Crime & Mystery / Sci-Fi + Horror & Thriller / Action & Adventure / Cartoons + Family & Kids.

## Evidence (compiled 60 days from 2026-11-14 00:00 America/Los_Angeles)
See `reports/classic-network/ajn247-*-evidence.json`: min repeat gap >= 168h on all 8; cartoons used 23 window relaxations (no-back-to-back only, never the 168h gate).

## Operator notes
- Publications end 2027-01-13. Renew by ~2026-12-30: `npx tsx tools/compile-classic-network.mts --network <id> --previous src/data/genre/<id>Publication.json --active-from <future instant>Z` (copy the old file first; the tool overwrites). After expiry the channel shows an explicit "Schedule ends ... Operator action needed" error, never a loop.
- Movie pools: 1,858 of 6,502 films are classified (title words + Archive item/director hints). 4,644 are listed in `reports/classic-network/genre-movie-triage.json`; add `episodeKey -> bucket` lines to `config/movie-genre-overrides.json` and re-run the builder to move them.
- Era note: X-Men, Gargoyles, Star Trek: Voyager are on the owner blacklist of the CLASSIC network catalog (crossover rule). These channels are separate catalogs, so they are included as the plan specified; remove the shows in `config/genre-channels.json` if you want the old rule to apply here too.
- Rod Serling Anthology = Twilight Zone, Night Gallery, Playhouse 90, Danger, Suspense episodes from item `01-rod-serling`; interviews/documentaries/films excluded; duplicate Twilight Zone filenames collapsed by episode title.
- Adds ~19 MB of JSON to the server bundle (8 publications). Readers are validated lazily on first request.
- Pre-existing, unrelated: `tests/test-classic-network-compiler.ts` and `test-classic-network-publication.ts` fail identically on untouched `origin/main` (stale show-list expectation); not caused by this drop-in.
