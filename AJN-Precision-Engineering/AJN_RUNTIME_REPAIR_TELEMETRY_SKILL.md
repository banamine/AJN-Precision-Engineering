# AJN Runtime Repair & Track-and-Trace Skill

## Identity chain
guideId -> channelId -> sourceId -> programId -> assetId -> archiveIdentifier -> mediaPath -> proxyRequestId

Use only identifiers actually present in the application. Unknown values must be null or explicitly unresolved.

## Runtime events
discovery.started
discovery.completed
asset.normalized
playlist.built
program.selected
proxy.request.started
proxy.response
media.load
media.error
playback.started
playback.progress
playback.ended
playback.advance
playback.loop
unresolved.file
unresolved.datetime
unresolved.location

## Demuxer error
For MediaError.code === 4 or an equivalent demuxer failure, record eventId, timestamp, guideId, channelId, sourceId, programId, assetId, archiveIdentifier, mediaPath, proxyRequestId, HTTP status, contentType, mediaErrorCode/message, readyState, and networkState.

A source/code inspection is never sufficient to claim runtime playback PASS.

## Archive policy
Use targeted requests, bounded concurrency, exponential backoff for 429/5xx, and successful metadata caching. Do not poll Archive.org for minute-by-minute updates. Try known older recordings when current recordings are unavailable. Never substitute unrelated media.

## Unresolved-data policy
For an unresolved file, datetime, or location: emit the matching unresolved event, record the exact field/object IDs/reason, and never invent a value.

## Freeze gate
FROZEN — VERIFIED requires actual browser playback, proxy delivery, sequential advancement, and loop evidence.
