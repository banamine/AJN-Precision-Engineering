# V2 Import Plan

Authoritative source:
`AJN-FULL-REBUILD-FIXED-DROP-IN-V2 (1).zip`

Verified locally from the uploaded ZIP:
- 309 non-directory files
- 121,530,123 bytes uncompressed
- 0 individual files above 25,000,000 bytes
- 5 stale entries in the embedded full-rebuild manifest
- 2 additional V2 diagnostic/root-cause files outside that embedded 307-file manifest

GitHub import policy:
1. Preserve the V2 application's original build paths at repository root where they are required by the Vite/TypeScript build.
2. Store the durable baseline inventory under `baselines/google-sandbox-v2/manifests/`.
3. Keep historical/drop-in material out of the active build tree.
4. Never overwrite `main`.
5. Do not mark the baseline complete until the complete ZIP inventory is represented in GitHub and the regenerated SHA-256 manifest matches the uploaded bytes.

This plan intentionally does not claim the ZIP has been bulk-imported; the available GitHub connector does not expose a local-archive upload operation.
