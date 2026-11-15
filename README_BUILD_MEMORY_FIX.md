# Build memory fix (2026-11-14): one file

File: `package.json` (root). Only change: removed `--sourcemap` from the `build` script's esbuild step.

Why: the server bundle now inlines the 8 genre publication files. Measured on the same machine:
- untouched main, with --sourcemap: peak 1.50 GB
- with genre data, with --sourcemap: peak 2.32 GB  (too much for Builder's 4 GB container next to the 1.1 GB dev server)
- with genre data, no --sourcemap: peak 1.32 GB

`start` is `node dist/server.cjs` with no --enable-source-maps, so the .map file was never used at runtime.
Verified: production bundle starts and /api/schedule returns the 5 TV + 3 movie genre channels.

Apply: upload this package.json over the root one, restart the dev server, then Publish.
Rollback: put `--sourcemap ` back in the esbuild command in the `build` script.
