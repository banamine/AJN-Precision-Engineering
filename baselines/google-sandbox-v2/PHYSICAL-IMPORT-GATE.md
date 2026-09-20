# V2 GitHub Physical-Import Gate

Current evidence shows the branch has core V2 files such as:
- `src/App.tsx`
- `src/MinimalPlayer.tsx`
- `src/components/PlayerView.tsx`

The authoritative uploaded ZIP contains 309 non-directory files. The complete ZIP has **not** been physically mirrored into GitHub yet.

Required completion test:
1. Enumerate all 309 uploaded ZIP file paths.
2. Verify each intended path is present in GitHub or explicitly recorded as intentionally excluded.
3. Regenerate SHA-256 manifest from the uploaded bytes.
4. Record the imported-file count and excluded-file list.
5. Run CI only after the source inventory is complete.

Do not declare V2 locked, do not merge to `main`, and do not claim runtime parity until this gate passes.
