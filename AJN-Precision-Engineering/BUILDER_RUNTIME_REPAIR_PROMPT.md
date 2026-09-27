# AJN Builder Prompt — Runtime Repair, Telemetry, and Freeze Gate

Critical symptom:
PipelineStatus::DEMUXER_ERROR_COULD_NOT_OPEN: FFmpegDemuxer: open context failed

PHASE 1 — TRACE
Trace:
Search/Guide -> Channel -> ChannelSource -> Program -> PlayerView -> MinimalPlayer -> /api/archive/proxy -> Archive.org -> browser media element.

Inspect the current repository before editing. Do not assume obsolete function names or paths.

Capture the real identity chain:
guideId, channelId, sourceId, programId, assetId, archiveIdentifier, mediaPath, proxyRequestId.

PHASE 2 — REPAIR
Fix only demonstrated defects.
Do not create a second player, add demo/fallback media, fabricate Archive URLs, mask failures as HTTP 200, poll Archive.org aggressively, use fake/random telemetry, or silently invent files/datetimes/locations.

Preserve MinimalPlayer, the AudioContext singleton, HLS teardown, bounded Archive discovery, retry/backoff, and intentional TV News slicing.

TELEMETRY
Every playback error must be traceable by explicit IDs. For code 4, capture the identity chain and proxy response details.

UNRESOLVED DATA
If a file, datetime, or location cannot be resolved, report field, object IDs, reason, and source of uncertainty. Do not invent values.

PHASE 3 — RUNTIME
Run:
npx tsc --noEmit
npm run build

Then test real browser playback for Fox News, CNN, and MSNBC.
Test valid proxy media, invalid media, Asset 1 -> Asset 2 -> Asset 3, final -> first loop, failed asset -> next valid asset, and absence of unrelated fallback media.

Build success is not playback proof.

FINAL REPORT
Include:
1. Phase 1 root cause
2. Files changed
3. Exact repair
4. Telemetry evidence
5. Runtime evidence
6. Unresolved files
7. Unresolved datetimes
8. Unresolved location names
9. Remaining issues
10. Freeze decision

If any live test still produces DEMUXER_ERROR_COULD_NOT_OPEN:
NOT FROZEN — REQUIRES REPAIR

Only when every runtime gate passes:
FROZEN — VERIFIED
