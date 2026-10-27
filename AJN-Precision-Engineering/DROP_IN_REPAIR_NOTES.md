# AJN Precision Engineering — Direct Playback Repair

This drop-in repairs the confirmed Archive playback URL construction defect.

## Direct edits

- `src/App.tsx`
  - Added one canonical `toPlayableSrc()` resolver.
  - Already-proxied `/api/archive/proxy?path=` URLs pass through unchanged.
  - Internal `/download/...` Archive paths are proxied exactly once.
  - Absolute `archive.org/download/...` URLs are normalized to the same single proxy.
  - HLS/DASH/direct remote media URLs are preserved as direct sources.

- `src/MinimalPlayer.tsx`
  - Explicitly keeps transport ownership out of the player component. The player consumes the final playable URL supplied by `App.tsx`.

- `server.ts`
  - Rejects accidental nested `/api/archive/proxy` paths at the proxy boundary.
  - Restricts the Archive proxy to `/download/...` paths.
  - Preserves the existing bounded Range/chunking implementation and stream cleanup.

## Root defect addressed

Before:

`/api/archive/proxy?path=/download/...` → wrapped again → `/api/archive/proxy?path=/api/archive/proxy?...`

After:

`/download/...` → one proxy → `/api/archive/proxy?path=/download/...`

or

`/api/archive/proxy?path=/download/...` → used unchanged.

## Validation note

The source package did not contain installed `node_modules`, so a complete dependency-backed production build could not be executed in this environment. The repository-level `tsc --noEmit` invocation reached the source files but reported missing installed dependencies/types rather than a syntax error in the repaired files.
