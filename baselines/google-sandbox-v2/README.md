# AJN V2 Baseline Storage

This directory is the canonical storage area for complete AJN Builder/V2 source drops.

## Storage policy

- Keep repository text/source files as normal Git files.
- Keep any individual binary/archive artifact at **25 MB or less**.
- Split larger artifacts into deterministic numbered parts: `part-001`, `part-002`, etc.
- Store a SHA-256 manifest beside every multi-part artifact.
- Never treat a split archive as the live application source; the source tree remains the authoritative build input.
- Future Builder drops should be added under a dated/versioned subdirectory rather than overwriting an earlier baseline.

## Current baseline

Working source package supplied for this baseline:
`AJN-FULL-REBUILD-FIXED-DROP-IN-V2 (1).zip`

Supplied archive SHA-256:
`dce90b0c7eb197a418569bea40f5673eb4ae098cf36b63fdca73f541769c7203`

The source package contains historical drop-ins as well as the working V2 project. Before importing into Git, preserve the working project tree and keep historical packages separated from it.

## Import verification

After import, verify:

1. Every expected source/config/document file exists in GitHub.
2. No stored artifact exceeds 25 MB.
3. SHA-256 manifest matches the source package.
4. The V2 build passes CI.
5. Builder/runtime playback still passes the known V2 smoke test.

Created as a durable storage contract; do not delete this file when updating the baseline.
