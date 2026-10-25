# AJN Bake Catalog — Phase 0 + Phase 1 Result (2026-10-10)

**TL;DR:** Phase 0 baseline and Phase 1 partial bake are done. Audio (Old-Time Radio, 18 channels / 2,636 tracks) and video (Daily Highlights, 27 channels / 43,082 items) bake cleanly, validate offline, are byte-deterministic, and 16/16 sampled items played as 206 through the local proxy. Two findings gate Phase 2: (1) playback still hits Archive.org per slice by design; (2) ~7% of sampled video items return 403. Nothing is wired into the server yet.

## Phase 0 (read-only; local server on this sandbox, `NODE_ENV=production`)
| Measure | Result |
|---|---|
| Outbound requests during first ~50 s of boot | 1,607 total; **324 to archive.org** (240 `/metadata`, 25 `advancedsearch`, 50 `/download`, 9 storage-node); 1,283 to IPTV/live-tv hosts (not Archive) |
| Of the archive.org boot calls, news/RT metadata | 60 (stays live) |
| Time to first 200 on movies-classics-vault | ~5 s; warm-up lines: classic-tv 1.8 s, cable-tv 2.3 s, live-tv 2.8 s, science-documentaries 8.2 s |
| `/api/schedule` classic-tv | raw **36.5 MiB**, gzip 3.8 MB; without `Accept-Encoding: gzip` the new guard answers **406** (was opaque 500). cable-tv 2.15 MB, movies 0.21 MB, science-docs 3.46 MB (uncompressed) |
| Files in the image | JSON imported by `server.ts`/`guideRegistry.ts` is **bundled into `dist/server.cjs`** by esbuild (no disk copy needed). Files read with `fs` need a Dockerfile `COPY`. **Dockerfile is not in the working tree I have** (CLOUD_RUN_DEPLOYMENT_CONTRACT.md says multi-stage, node:22-bookworm-slim) — UNVERIFIED; run `git show HEAD:Dockerfile` |

### Media proxy at playback (documented exception)
`/api/archive/proxy` sends `Cache-Control: no-store` for media and caches only images (memory). Every ≤8 MiB slice is an upstream GET to the Archive storage node; the redirect/node URL is cached 10 min (`REDIRECT_TTL_MS`) so a slice costs 1 request after the first (first costs 1-byte probe + GET). **So baking removes boot/metadata calls but playback remains Archive-dependent by design** (we do not host media). Tests must assert "zero Archive API calls at runtime" with this and the news EPG as named exceptions.

## Phase 1 (tools/bake/)
- `bake.ts` writes `src/data/baked/<version>/{audio-otr,video-daily-highlights}.json`, validates, then atomically renames `manifest.json`; keeps current + 1 previous version; exit 2 = nothing published (transient failure with no last-known-good), exit 3 = validation failed, previous kept.
- `validate.ts` (OFFLINE): schema, sha256, byte/item/channel counts, duplicate channel ids, unknown/repeated item refs, bad paths, audio without duration. Tested: tampered, truncated, missing file, missing manifest → each exits 1 with one clear line.
- `check-urls.ts` (NETWORK): dedupes, 4 concurrent, 1-byte range probe, availability and range support recorded separately, 24 h cache, report only — never edits catalogs.
- Failure classes: missing (404/410/403/dark), transient (5xx/429/network → last-known-good carried over, `stale:true`), invalid, excluded (policy: audio-only, non-browser formats). Transient carry-over path is **implemented but not exercised** by a test yet.
- Determinism: two audio bakes → identical sha256 (`1f6b3be1…`). `bakedAt` lives only in the manifest.

| Catalog | Items | Channels | Size | gzip | Unresolved |
|---|---|---|---|---|---|
| audio-otr | 2,636 | 18 | 1.35 MB | 0.19 MB | 0 |
| video-daily-highlights | 43,082 | 27 | 18.2 MB | 4.2 MB | 3,431 excluded (2,589 audio-only, 303 .avi, 216 .mkv, 187 .mpg, 94 .mov, 24 no-media, 11 .m3u, 5 playlists) |

- Load cost: video catalog read 109 ms + parse 137 ms, +68 MB heap; audio 17 ms. Acceptable for cold start; still worth splitting per channel in Phase 2.
- Largest channel: `classic-alex-24` has **13,062 items** (~15 MB as schedule rows) → proves windowing is required even after baking.
- Playback sample through the local proxy, `Range: bytes=0-65535`: 8/8 audio and 8/8 video returned 206 with correct Content-Range. Several video originals are 1.7–4.3 GB (huge originals; project rule prefers h.264 derivatives).
- URL health, 60 random video+audio URLs: 56 available, **4 DOWN (403)** — all in one item `01-tv-fighting-crime-part-2_20240703` (restricted). Extrapolated ≈7% of video rows may be dead → Phase 2 must filter via `--check-urls` results (full run ≈ 42,103 unique URLs).

## Open for Phase 2 (held)
1. Rotation: `dayIndex × slotsPerDay mod N` needs constant slots/day per channel, else cumulative counter; cycle length N/gcd(N,S); test small catalogs.
2. Size test over real serialized endpoints and boundary windows; 28 MiB threshold.
3. Dynamic OTR (`buildOtrChannel`, advancedsearch top-300) is not baked yet.
4. Full `--check-urls` run, and a policy for 403 items.
5. Confirm Dockerfile/COPY or keep JSON `import`-bundled.
