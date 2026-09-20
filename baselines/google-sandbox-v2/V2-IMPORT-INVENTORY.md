# V2 Import Inventory — Gate 2

Uploaded ZIP audit (source of truth):
- Archive: `AJN-FULL-REBUILD-FIXED-DROP-IN-V2 (1).zip`
- Non-directory files: 309
- Uncompressed bytes: 121,530,123
- Largest file: 24,966,166 bytes
- Individual files over 25,000,000 bytes: 0

Top-level inventory:
- `src/`: 34 files
- `lib/`: 90
- `images/`: 46
- `m3u_files/`: 39
- `api-server/`: 9
- `json_files/`: 8
- `server/`: 5
- `scripts/`: 3
- `public/`: 3
- `docs/`: 3
- `other_files/`: 3
- `pls_files/`: 2
- `collections/`: 2
- additional root-level config/docs/tests

Critical root files in the ZIP that are not yet present at the same repository paths on the baseline branch:
- `AJN_REBUILD_V2_MANIFEST.json`
- `AJN_FULL_REBUILD_BASELINE.md`
- `AJN_PHASE1_RENDER_LOOP_ROOT_CAUSE.md`
- `V1_FILE_SHA256.txt`
- `GOOGLE_BUILDER_README.md`
- `V1_SCOPE.md`
- `pnpm-workspace.yaml`
- `cloudbuild.yaml`

Already present examples include `src/App.tsx`, `src/MinimalPlayer.tsx`, `src/components/PlayerView.tsx`, `src/components/AudioBridgeStatus.tsx`, `package.json`, `vite.config.ts`, `tsconfig.json`, and `guideRegistry.ts`.

Gate 2 conclusion:
**The uploaded ZIP contains a broader source/config/support tree than the currently mirrored GitHub branch. The branch is not a complete V2 mirror.**

Do not run the final CI/lock step until the missing ZIP inventory is imported or explicitly recorded as intentionally excluded with reasons.
