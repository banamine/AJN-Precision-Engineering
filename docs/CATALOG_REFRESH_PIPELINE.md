# Catalog refresh pipeline (Archive lists → channels, nightly)

**What it does:** every night GitHub re-reads the owner's Archive.org lists, rebuilds the catalog data files,
measures the guide payloads, decides whether the change is safe, opens a PR, runs Application CI on it, and
merges it **only** when every rule passes and auto-merge is switched on. Merging never deploys; deploys stay manual.

```
Archive lists ──► tools/build-infobattalion-lists.py ──► src/data/{extraChannels,documentaries,archiveAudioChannels}
                    (admission: real runtime, no private/dark,          │
                     h.264 MP4 preferred, no placeholders)              ▼
                                         tools/catalog-measure.mts ──► payload sizes
                                         tools/catalog-gate.mjs   ──► verdict none | auto | review | block
                                                                        │
                                   PR (label catalog:auto / catalog:needs-review) ──► Application CI
                                                                        │
                         auto + CI success + AJN_CATALOG_AUTOMERGE=true ──► squash-merge   (else: owner review)
```

Files: `.github/workflows/ajn-catalog-refresh.yml`, `config/catalog-refresh.json`, `tools/catalog-gate.mjs`,
`tools/catalog-measure.mts`, `test-catalog-gate.mjs` (in Application CI as `npm run test:catalog-gate`).

## Baseline numbers (main `8063eb2`, 2026-10-28, measured offline from committed manifests)

| Payload | Now | Auto-merge ceiling | Hard limit | Room before ceiling |
|---|---:|---:|---:|---|
| Classic TV light schedule (what the guide loads) | 993,179 B | 1,782,579 B (85 % of 2 MiB) | 2,097,152 B (server returns 500 above it) | ~789 KB ≈ **2,900 more lazy channels** (270 B each) or ~200 eager ones (3.9 KB each) |
| Classic TV full schedule, gzip as sent | 3,024,033 B | 16 MiB | 32 MiB (Cloud Run HTTP/1 cap) | ~5× today |
| Classic TV full schedule, raw JSON in memory | 33,150,193 B | 60 MiB | 100 MiB | ~300 more lazy channels at 91 KB each |
| movies-classics-vault | 0.18 MB | 2.7 MB | 3 MB | ~2,300 movie rows (1.1 KB each) |
| cable-tv | 2.07 MB | 3.6 MB | 4 MB | ~500 rows (3.1 KB each) |
| science-documentaries | 3.66 MB | 5.4 MB | 6 MB | ~1,700 rows (1.05 KB each) |

Other facts the numbers rest on:
- 342 Classic TV channels, 93 of them lazy (`deferLightRows`). New Classic TV channels must be lazy to auto-merge.
- Classic TV exports: XMLTV 7.3 MB, M3U 5.7 MB (well under 32 MiB). Server RSS for building Classic ≈ 476 MB (Cloud Run has 3 GiB).
- **Archive pacing:** the builder starts at most one Archive request every 1.55 s → ~2,300 requests/hour.
  @infobattalion lists at last build: Documentary 192, Cartoons 101, Tv Classics 346, Movies 204 (+ Music, NWT, OTR, two movie searches).
  Cold crawl (~1,200 items) ≈ **30–35 min**; nightly with the metadata cache ≈ **only new items** (50 new items ≈ 1.5 min + list pages).
  GitHub job limit 6 h ≈ 13,000 requests, so a cold @seamac crawl of up to ~10,000 items still fits one run.
- **Thumbnails are not gated.** **Station numbers are alphabetical positions** (`src/guide/channelIndex.ts`), so every
  added channel renumbers the channels after it — not gated; pinned numbers would need a separate registry (owner decision).

## Gate rules (`config/catalog-refresh.json → autoMerge`)

| Rule | Auto | Otherwise |
|---|---|---|
| Channels/rows/doc entries/audio removed | none allowed | review |
| Channel renamed, or moved to another guide/group | none allowed | review |
| New channels | ≤ 20 | review |
| New rows | ≤ 3,000 | review |
| New documentary entries | ≤ 1,500 | review |
| New audio channels | ≤ 10 | review |
| New Classic TV channel not lazy-loaded | none allowed | review |
| Payload above auto-merge ceiling | — | review |
| Payload above hard limit, or measurement missing | — | **block** (PR opened, must not merge) |

The builder already rejects private/dark items, missing files, items needing transcode, <30 s placeholders and
duplicates (see `reports/infobattalion-lists.json → lists.*.rejected_reason_counts`).

## Switches

| Switch | Where | Default |
|---|---|---|
| Nightly run | `schedule` 10:23 UTC | on after merge (opens PRs; does not merge) |
| Auto-merge | repo variable `AJN_CATALOG_AUTOMERGE` = `true` | **off** |
| Manual run | Actions → AJN Catalog Refresh → Run workflow (`dry_run`, `automerge`) | dry run |
| PR dry run | any PR touching the pipeline files | real crawl, no PR, no merge |

Undo a bad auto-merge: `git revert <merge sha>` (or the PR's Revert button). Nothing reaches the live app until the next manual deploy.

## Rollout

1. Merge this pipeline PR after its dry-run job shows a sane report (artifact `catalog-refresh-report`).
2. Run the workflow manually with `dry_run` unticked, `automerge` unticked → review the PR it opens.
3. After 3–5 clean nightly PRs reviewed by hand, set `AJN_CATALOG_AUTOMERGE=true`.
4. @seamac: stays `enabled: false` until Replit's discovery report is reviewed and the builder has a @seamac section with owner-approved categories.

## Not covered yet (Replit follow-ups)
- HEAD/Range playability probe of each new MP4 (beyond the metadata admission) — candidate: reuse `server/archiveHealthProbe.ts` patterns.
- @seamac builder section and category mapping.
- Thumbnails for new channels.
