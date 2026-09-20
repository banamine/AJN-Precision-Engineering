# V2 Physical Import Status

## Phase 1 — inventory gate

Authoritative uploaded artifact:

- `AJN-FULL-REBUILD-FIXED-DROP-IN-V2 (1).zip`
- 309 non-directory files
- 121,530,123 bytes uncompressed
- no individual file exceeds 25,000,000 bytes
- verified archive SHA-256: `dce90b0c7eb197a418569bea40f5673eb4ae098cf36b63fdca73f541769c7203`

## Active-source parity check

The branch `baseline/google-sandbox-v2` contains V2 evidence documents and some source files, but the following key runtime files do **not** yet match the uploaded V2 archive by Git blob SHA-1:

| Path | Uploaded V2 blob SHA-1 | Current branch blob SHA-1 |
|---|---|---|
| `src/App.tsx` | `3a87df90715a91c4a63b1ba6299e7e49c6ce46e4` | `25bbf2bcdee1ae7251c30933836c01296f98d031` |
| `src/MinimalPlayer.tsx` | `cbbebb01680fa64bbc4140755d27f7bdd841be18` | `324e8621099d97a23db0aad8aa9176da14a5d88d` |
| `src/components/PlayerView.tsx` | `7182f7195a2ca4f7b0c927cf94a0b5b764fe7573` | `af29b78b92c77899c7f662a7fe32390d4d45fa22` |
| `src/components/AudioBridgeStatus.tsx` | `2419cc416096990450520b9c4f94d873b17d9a5c` | `c04e195ddd6cecb191b82a170c45c4eca84bce33` |

This means the GitHub branch is **not yet a byte-parity mirror of the working Builder V2 source**. CI or merge must not be treated as V2 parity evidence until the active source tree is imported.

## Uploaded active-source inventory

The archive contains 34 `src/` files, including the four runtime-critical files above. It also contains root build/runtime files such as `package.json`, `vite.config.ts`, `tsconfig.json`, `server.ts`, `guideRegistry.ts`, `channels.ts`, and `archiveProxy.ts`.

## Gate

- [x] Archive enumerated.
- [x] Archive SHA-256 recorded.
- [x] 25 MB individual-file limit audited.
- [x] V2 evidence documents imported.
- [ ] Complete active source tree imported.
- [ ] Uploaded source hashes regenerated and matched.
- [ ] CI run against the complete imported tree.
- [ ] Builder runtime re-verified.
- [ ] Merge/lock decision.

**Do not merge this branch and do not call it runtime-parity complete yet.**
