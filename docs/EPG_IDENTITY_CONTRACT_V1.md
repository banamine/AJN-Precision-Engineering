# EPG Identity Contract v1

This contract defines the canonical identity boundary for every EPG program, regardless of source.

## Identity ownership

- sourceId: owned by the channel/source producer.
- programId: authoritative upstream ID when available; otherwise deterministic from stable program fields.
- assetId: deterministic identity for the playable media asset represented by the EPG entry.
- guideId and channelId: routing ownership, not substitutes for media identity.

## Required invariants

1. No array/index position may participate in canonical identity.
2. No "unknown" or fabricated default identity may be emitted as a canonical value.
3. assetId must remain stable when an input feed is reordered.
4. Re-ingesting the same M3U/JSON entry must produce the same identity.
5. Adding a new source/channel must not rewrite existing identities.
6. Search/archive-derived entries and M3U/JSON-derived entries use the same identity engine.
7. Playback receives the exact EPG identity; it must not silently replace it with a second identity scheme.

## Producer flow

source -> normalized EPG candidate -> epgIdentity -> Program -> playback -> telemetry

## Future compatibility

Additive fields may be introduced in later contract versions. Existing identity fields must retain their semantics.
