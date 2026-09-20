# EPG Identity Contract v1

## Runtime boundary

All producers normalize into a canonical EPG candidate before calling `buildEpgIdentity()`. Schedule timestamps are integer Unix epoch milliseconds in UTC. A feed adapter that receives a floating timestamp must resolve it using an explicit source timezone/default or reject the candidate; the browser's local timezone is never an implicit fallback. IANA timezone data is the authoritative model for regional civil-time conversion. citeturn0search0turn0search1

## Identity ownership

- `sourceId`: producer/channel ownership.
- `programId`: authoritative upstream ID when present; otherwise deterministic from source/channel/title/UTC window.
- `assetId`: deterministic content identity; transport host and volatile query parameters do not participate.
- `guideId` / `channelId`: routing ownership.

## Invariants

1. No array/index position participates in identity.
2. No `unknown` or fabricated default identity is emitted.
3. Re-ingestion and feed reorder are stable.
4. New sources/channels do not rewrite unrelated identities.
5. Unicode is NFC-normalized; common broadcast/resolution/re-run tags are removed from identity title normalization.
6. CDN mirror hosts do not change `assetId`; transport URLs remain source metadata.
7. Schedule overlap is a registry validation problem, not an identity collision rule. Conflicting candidates on the same channel/time window are rejected deterministically by source priority, then sourceId.
8. Playback receives the canonical EPG identity without generating a second EPG identity.

## Diagnostics

Adapters/registry emit structured `[EpgIdentityLog]` outcomes: `AUTHORITATIVE_MATCH`, `DETERMINISTIC_FALLBACK`, `SANITY_REJECTED`.
