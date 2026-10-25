---
name: ajn-add-channel
description: Add a new channel or source (Archive collection, M3U/IPTV stream, Rumble or YouTube embed, RSS) to AJN through the existing ChannelManager and canonical MediaAsset pipeline, with verification.
---

# Add a channel to AJN

## Before adding
- Find the existing channel registry: `grep -rn "ChannelManager\|channels.ts" --include=*.ts* src server | head`. Confirm which file the build actually imports (dropin copies exist).
- Get one real sample URL and prove it plays: `curl -sI "<url>"` (status, content-type), or for Archive the metadata check in `ajn-expert-search`.

## Source routing
| Source | How |
|---|---|
| Archive MP4 | MediaAsset with h.264 MP4 URL, played via `/api/archive/proxy` |
| M3U / IPTV | Parse via existing M3U ingest; CORS/net error (code 3/4) → `/api/stream-proxy` (must pass `isUrlSafe`) |
| Rumble / YouTube | `iframe` embed only; never through a demuxer |
| RSS / podcast | Enclosure URL → MediaAsset (audio) |

## Steps
1. Add one entry in the existing registry: id, number, name, group, source type, source URL(s), optional backup.
2. Map to MediaAsset via the existing adapter; don't create a new adapter if one fits.
3. If live: set backup handling via existing circuit breaker; failure shows explicit error, no fake filler.
4. Schedule (24/7): through SchedulerEngine with real durations from metadata.

## Verify
- Channel appears in guide at its number and group.
- Tune: media request 200/206, first frame within ~5s, no console errors.
- Kill network for the source: truthful error shown, recovers when back.
