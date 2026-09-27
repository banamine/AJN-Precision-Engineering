# AJN Domain Separation — Phase 2

This drop-in is based on `AJN_PRECISION_ENGINEERING_18_CORS_PLAYBACK_FIX.zip`.

## Purpose

Separate content/catalog ownership while retaining shared playback infrastructure.

Domains:

1. Cable TV & News → `cable-tv`
2. Classic TV & Series → `tv-series`
3. Classic Cinema Vault → `classic-cinema`
4. AJN Archive & Special Feeds → `archive-vault`
5. Audio & Music Mixer → `audio-podcasts`

## Runtime changes

- AjnMediaCenter now loads non-Classic domain schedules from their own guide endpoint.
- Classic TV remains on the verified series/M3U catalog and deterministic schedule path.
- Cross-domain selection state is explicitly reset when changing domains.
- Classic playback resolves the selected catalog item's Archive URL rather than an unrelated persisted Archive selection.
- Audio Mixer uses the shared audio element and the selected audio-guide program.
- SourceDomainSelectors exposes all five domains.
- PlayerView no longer presents hardcoded default media as a fallback and passes guide/channel/program identity when selecting schedule items.
- HomeView no longer substitutes BigBuckBunny when a guide item is missing; it reads the five guide schedules.
- Standalone `other_files/tv-player.html` no longer boots from the hardcoded mixed playlist. It loads the requested guide from `/api/schedule`, populates its channel list, then loads channel items.

## Deliberately unchanged

- Archive proxy transport
- Archive URL encoding contract
- ZIP 18 CORS playback repair
- News resolver implementation
- HLS engine/lifecycle
- telemetry architecture
- Cloud Storage configuration

## Verification performed

- TypeScript/TSX syntax transpilation passed for all modified TSX files.
- Standalone player JavaScript syntax check passed.
- Full ZIP integrity is checked after packaging.

Production behavior still requires the user's Cloud/AI Studio smoke test.
