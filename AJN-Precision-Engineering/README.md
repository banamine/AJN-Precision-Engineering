# AJN Safe News Proxy Repair Pack

Purpose: a drop-in, Builder-ready repair package for the Archive.org news proxy path.

IMPORTANT:
- This pack is intentionally safe for the currently-working LIVE deployment.
- Do NOT publish/redeploy directly from this pack.
- Apply the surgical server.ts changes in the sandbox, run all verification gates, and only then publish.
- Do not change the canonical player, EPG, navigation, or news channel definitions as part of this repair.

Known runtime failure:
PipelineStatus::DEMUXER_ERROR_COULD_NOT_OPEN: FFmpegDemuxer: open context failed

Known failure mode:
The proxy can return a JSON error body after media headers have been prepared, or abort a long-running upstream request because an initialization timeout remains attached to the entire stream lifetime. Either can present as a media demuxer failure.

Target:
server.ts — /api/archive/proxy (or the equivalent Archive.org media proxy handler in the installed sandbox).

See:
- server.ts.patch.md
- BUILDER_INSTALL_AND_VERIFY.md
