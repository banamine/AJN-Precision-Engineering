# Archive music player redesign — Phase 1 findings

Baseline: `origin/main` at `02938ae` (`2026-10-27`).

## Scope and identity

- Archive music playlist rows are audio channels whose IDs start with `item-music-`. The server's light schedule keeps the current track and the next two tracks from the same daily loop for long rows (`server/audioLightSchedule.ts`).
- `LibraryView` hands the selected item's existing path and identity to `App`; `App` stores the canonical source identity in `recentlyPlayed` and creates the current `nowPlaying` item. Display-title cleanup must not change those identifiers or source paths.

## Queue, history, and playback

- `PlayerView.schedulePrograms()` caches the selected channel's schedule for the current playback instance. `resolveNext()` calls the existing `pickNext()` result for preloading and end-of-track advancement (`src/components/PlayerView.tsx`). There is no Archive music queue panel today; the only visible generic-player “Up Next” line is Rush-specific. The new panel must derive from that same schedule source, not maintain another queue.
- `App` already records `recentlyPlayed`; Home displays it, but `PlayerView` does not currently consume it. The Archive music panel can use the existing history without changing its storage contract.
- `MinimalPlayer` owns the single persistent audio element through `audioHostRef`. It must remain the only media element and continue to use the existing playback and cleanup pipeline.
- `PlayerChrome` reads current time and duration from media-element events (`timeupdate`, `durationchange`, and metadata/seek events); no React timer is needed for the redesign.
- The player stage currently shows central artwork, two circular side-art thumbnails, and an “On air” badge for playing audio. These are presentation elements, not separate spectrum analyzers. The player title/favorite row above the stage and the Chrome title area can duplicate the track title.

## Visualizer and Archive media

- `use-audio-normalization.ts` owns the shared audio runtime and calls `createMediaElementSource` for the actual media element; the Archive-specific visualizer must consume its existing analyser rather than create another source or AudioContext.
- `AudioVisualizerOverlay` reads real analyser frequency data and draws it with `requestAnimationFrame`. A targeted search found no `Math.random` or canned bar data in this path. Its current disabled/paused state clears the canvas; the Archive-specific display should instead draw a flat baseline when paused or silent.
- Archive playback already uses the same-origin `/api/archive/proxy` URL builder for canonical `/download/` paths. No proxy or range-serving changes are in scope. If analysis is unavailable, display a static analyzer-unavailable label rather than inventing bars.

## Live-radio boundary

- The live-radio route is rendered by `App` through `RadioView`. The player also recognizes live-radio media through `isLiveRadioPlayback()` (`radio:` channel IDs and the `:live:d0` program ID) and renders its existing radio-specific stage.
- `src/components/PlayerView.tsx`, `src/MinimalPlayer.tsx`, and `src/components/PlayerChrome.tsx` are shared with the live-radio player path. Any Archive music behavior in those files must be behind an Archive-music-only condition; the existing live-radio render branch must remain unchanged.
- `RadioView`, `RadioDock`, `LiveRadioNowPlaying`, the authoritative audio runtime, proxy/server files, and scheduling code are out of scope.

## Baseline source map

References below are from `origin/main` at `02938ae`:

- **Now Playing and favorite row:** `src/components/PlayerView.tsx:475-485`; it renders the current title and favorite control. `src/components/PlayerChrome.tsx:261-275` renders the bottom audio title/subtitle, while `:83-87` updates playback time from media-element events.
- **Up Next source:** `src/components/PlayerView.tsx:113-134` fetches and caches one channel schedule per playback item; `:153-167` calls `pickNext()` for preload and end-of-track advance. The visible “next hour” case is Rush-specific (`:259-260`). Archive music had no corresponding queue panel.
- **Recently Played:** `src/App.tsx:93-116,134-166,209-229` owns persistence and updates; `src/components/HomeView.tsx:332` renders the Home list. `src/components/LiveRadioNowPlaying.tsx:32` has a separate, radio-only recent list.
- **Spectrum, On Air, and live-level label:** `src/MinimalPlayer.tsx:1071-1095` renders the audio stage and its existing radio badge/level state; `src/components/AudioVisualizerOverlay.tsx:33-46,83-121` reads analyser bins and draws bars.
- **Audio source and shared analyser graph:** `src/use-audio-normalization.ts:62-67,110-122` creates the shared graph and connects the actual media element once. The Archive visualizer must not make another `AudioContext`, source, or analyser.
- **Live-radio routing:** `src/App.tsx:321-327` keeps the persistent `PlayerView` mounted while another destination is selected; `:370-372` renders `RadioView`. `src/MinimalPlayer.tsx:112,1071-1095,1154-1159` contains the live-radio-specific stage and Chrome settings.

## Verification still required

No Archive track or live-radio playback was tested during Phase 1. The implementation phase must capture desktop and phone Chromium evidence for Archive music playing and paused, compare live-radio rendering against the main-branch baseline, and verify a single visible Up Next panel.
