# AJN Runtime Repair + Telemetry Drop-In

Purpose:
- Track DEMUXER_ERROR_COULD_NOT_OPEN from channel/program/source through proxy and player.
- Require explicit ID-based telemetry mapping.
- Report unresolved files, datetimes, and location names.
- Provide a reusable Builder skill/prompt.

This package is a drop-in specification/prompt set. It has not been applied to the repository.
Install by comparing interfaces against the current code, then run TypeScript/build and targeted runtime verification.

Rules: no fake telemetry, random IDs, fabricated Archive URLs, silent fallback media, or masked upstream failures.
