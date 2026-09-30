# AJN Canonical Playback Slice

**Scope:** AJN Precision Engineering (`fix/p1`). This document describes the current implemented M3U-to-playback path. It does not introduce a new runtime abstraction.

## Canonical path

| Stage | Current implementation | Evidence / boundary |
|---|---|---|
| M3U input | `guideRegistry.ts` → `parseM3u(text)` | Parses `#EXTINF` metadata plus the following URL line into `ParsedM3uEntry[]`. |
| M3U ingestion | `guideRegistry.ts` → `ingestM3uPlaylist(playlist, text, targetGuideId?)` | Production path converts parsed entries into channel/source registry state. |
| Canonical media object | **Not present on the production M3U path** | `ingestM3uPlaylist` creates `Channel` and `ChannelSource`; it does not create `Program` or `MediaAsset`. |
| EPG / channel | `guideRegistry.ts` → `channelsMap` / `channelSourcesMap`; public readers include `getChannelsByGuide`, `getChannelById`, `getChannelSources` | M3U ingestion produces the channel/source projection used by the guide. |
| Direct MP4 playback identity | **No separate `PlaybackPlan` type/function is present** | `Program` exists in `src/types.ts`, but the production M3U ingestion path does not construct one. |
| Direct MP4 URL | M3U entry URL remains the `ChannelSource.url` value | The current channel/source path does not normalize a direct MP4 into a separate playback plan. |
| Archive MP4 URL | `src/utils/archivePlayback.ts` → `buildArchiveProxyUrl(archivePath)` | Requires a canonical `/download/` path and returns the `/api/archive/proxy` URL. |
| EPG selection → playback | `src/EpgGuide.tsx` → `onSelectProgram` → `src/App.tsx` → `handlePlayProgram` → now-playing state | This is the Program-based UI playback path, separate from M3U channel/source ingestion. |
| Actual player handoff | `src/components/PlayerView.tsx` and `src/MinimalPlayer.tsx` | These components consume the current now-playing media source. |

## What Task 5 verifies

The contract test in `test-canonical-playback-slice.ts` calls real repository functions against in-memory fixtures:

1. `parseM3u` parses a direct MP4 M3U entry and preserves its title, URL, TVG identity, group, and duration.
2. `buildArchiveProxyUrl` converts a canonical Archive `/download/` path into the existing proxy URL contract.
3. The negative no-URL fixture records the parser's actual behavior: an EXTINF entry without a following URL is not emitted.
4. The negative non-MP4 fixture records the parser's actual behavior: the parser preserves the URL rather than enforcing an MP4-only policy.

## Ingestion boundary

`ingestM3uPlaylist` was reviewed before this test was selected. It owns module-level `channelsMap`, `channelSourcesMap`, and `playlistsMap`, and updates playlist timestamps during ingestion. It is therefore not treated as a pure, shared-state-free test function in Task 5.

Task 5 deliberately does **not** call `ingestM3uPlaylist`. No network or timer behavior is introduced by the test, and no singleton registry state is shared between test cases.

## Known gap, not fixed by Task 5

`MediaAsset` exists in `src/archive-types.ts`, but the production M3U path does not produce `MediaAsset`. The production M3U path is currently:

`parseM3u` → `ingestM3uPlaylist` → `Channel + ChannelSource`

There is also no `PlaybackPlan` type/function in the current codebase. Task 5 documents these boundaries; it does not add or retrofit either abstraction.

## Scope lock

Task 5 does not modify `channels.ts` or `server.ts`. It does not add a new playback abstraction, change M3U ingestion semantics, or change Archive proxy behavior.