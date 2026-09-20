# V2 Import Intake Report

Status: **SOURCE PACKAGE VERIFIED / GITHUB IMPORT PENDING**

Authoritative uploaded package:
- Filename: `AJN-FULL-REBUILD-FIXED-DROP-IN-V2 (1).zip`
- ZIP entry count: 343
- Non-directory file count: 309
- Embedded application manifest file count: 307
- Archive SHA-256: `dce90b0c7eb197a418569bea40f5673eb4ae098cf36b63fdca73f541769c7203`
- Largest individual file: 24,966,166 bytes
- Files exceeding 25,000,000 bytes: 0

Integrity note:
The embedded `AJN_FULL_REBUILD_MANIFEST.json` is stale relative to the uploaded bytes. Seven entries differ or are absent from that embedded manifest, including the V2 repair files `src/App.tsx`, `src/MinimalPlayer.tsx`, `src/components/PlayerView.tsx`, and `test-runtime-loop-guards.mjs`. The uploaded bytes are treated as authoritative; the GitHub import must generate a fresh manifest rather than copy the stale one.

Import layout:
```
baselines/google-sandbox-v2/
  README.md
  IMPORT-CHECKLIST.md
  source/
  manifests/
  artifacts/
```

Do not merge this baseline into `main` until the complete source tree is present and CI plus Builder runtime verification pass.
