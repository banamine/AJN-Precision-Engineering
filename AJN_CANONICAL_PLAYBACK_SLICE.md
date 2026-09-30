# AJN Canonical Playback Slice

**Scope:** AJN Precision Engineering (`fix/p1`). This document describes the current implemented M3U-to-playback path. It does not introduce a new runtime abstraction.

## Canonical path

| Stage | Current implementation | Evidence / boundary |
|---|---|---|
| M3U input | `guideRegistry.ts` → `parseM3u(text)` | Parses `#EXTINF` metadata plus the following URL line into `ParsedM3uEntry[]`. |
| M3U ingestion | `guideRegistry.ts` → `ingestM3uPlaylist(playlist, text, targetGuideId?)` | Production path converts parsed entries into channel/source registry state. |
| Canonical media object | `Program` registered per ingested entry (`upsertCanonicalProgram`); **no `MediaAsset`** on the M3U path | `ingestM3uPlaylist` creates `Channel`, `ChannelSource` and one canonical `Program` (stable id/assetId/sourceId). `MediaAsset` remains Archive-only. |
| EPG / channel | `guideRegistry.ts` → `channelsMap` / `channelSourcesMap`; public readers include `getChannelsByGuide`, `getChannelById`, `getChannelSources` | M3U ingestion produces the channel/source projection used by the guide. |
| Direct MP4 playback identity | **No separate `PlaybackPlan` type/function is present** | `Program` exists in `src/types.ts`; M3U ingestion now registers one per entry, but no `PlaybackPlan` is derived from it. |
| Direct MP4 URL | M3U entry URL remains the `ChannelSource.url` value | The current channel/source path does not normalize a direct MP4 into a separate playback plan. |
| Archive MP4 URL | `src/utils/archivePlayback.ts` → `buildArchiveProxyUrl(archivePath)` | Requires a canonical `/download/` path and returns the `/api/archive/proxy` URL. |
| EPG selection → playback | `src/EpgGuide.tsx` → `onSelectProgram` → `src/App.tsx` → `handlePlayProgram` → now-playing state | This is the Program-based UI playback path, separate from M3U channel/source ingestion. |
| Actual player handoff | `src/components/PlayerView.tsx` and `src/MinimalPlayer.tsx` | These components consume the current now-playing media source. |

## What Task 5 verifies

The contract test in `test-canonical-playback-slice.ts` calls real repository functions against in-memory fixtures:

1. Registry programs held by `getCanonicalPrograms()` carry proxied direct-MP4 `mediaUrl` values that decode back to canonical Archive `/download/` paths, with required program/source identity.
2. Those same-origin proxy URLs pass the existing audio bridge contract: `bridgeSrc` leaves the URL unchanged and `corsModeFor` admits it as `anonymous`.
3. `buildArchiveProxyUrl` converts a canonical Archive `/download/` path into the existing proxy URL contract.
4. The production `ingestM3uPlaylist` path is exercised in the test's own process. It produces `Channel` + `ChannelSource` records, classifies the HLS entry, and registers one canonical `Program` per entry (re-ingesting does not duplicate); it adds no `MediaAsset`.
5. The negative no-URL fixture records the parser's actual behavior: an EXTINF entry without a following URL is not emitted.
6. The negative non-MP4 fixture is represented by the production M3U fixture: the parser/ingestion path classifies the `.m3u8` source as HLS rather than enforcing an MP4-only parser policy.

## Ingestion boundary

`ingestM3uPlaylist` was reviewed before this test was selected. It owns module-level `channelsMap`, `channelSourcesMap`, and `playlistsMap`, and updates playlist timestamps during ingestion. The new contract test deliberately calls it **once inside its own test process** so the production boundary is exercised without sharing its mutated registry state with other test processes. No network or timer behavior is introduced by the test.

## Known gap, not fixed by Task 5

`MediaAsset` exists in `src/archive-types.ts`, but the production M3U path does not produce `MediaAsset`. The production M3U path is currently:

`parseM3u` → `ingestM3uPlaylist` → `Channel + ChannelSource + Program`

There is also no `PlaybackPlan` type/function in the current codebase. `classicM3uContract` is not used in production; it is exercised by `test-source-contracts.ts`. Task 5 documents these boundaries; it does not add or retrofit either abstraction.

**Test result:** [not run by ChatGPT; tested by Claude locally, offline, with two deliberate breaks failing]

## Scope lock

Task 5 does not modify `channels.ts` or `server.ts`. It does not add a new playback abstraction, change M3U ingestion semantics, or change Archive proxy behavior.
