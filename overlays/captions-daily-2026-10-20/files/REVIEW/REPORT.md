Input SHA-256 — owner export: `002749be159fb37413495bdfd0273475b8dfdaf21ca9a4a9ee2d154577249353`; all-in-one overlay: `1f4243577e5f160c5f96688cc0067ad1f9ae57fee277ce5b7dffe98b88fab047`; task prompt: `73c3888fbc1036c2375f6d667a5f6446898b4a7291271b9c6bc4350a888b2939`.

# Captions Daily CSV — review report

**Overall: PARTIAL.** The offline tool and synthetic tests pass. The bounded live run returned usable public radio ASR data, but the requested TV sample was unavailable and the live dry-run preceded the final CSV/manifest schema corrections. No application runtime, Builder, dependency, or lockfile files were changed. No GitHub branch was pushed, and no app deployment was run.

## P1 — live measurement

P1 used **37/40** physical starts, including redirects. One public terms-page request redirected once; final response was HTTP 200, 1,951 bytes. The response did not match the simple rights/API keyword scan. This does **not** establish that the response was the current applicable terms or API guidance; no terms were quoted, and permission/licence questions remain unverified.

| Network / day | Search hits | Metadata read | Identifier-time spread | `addeddate` / `publicdate` age in metadata | Public align / cc5 / asr | Private align / cc5 / asr | Full TV SRT samples |
|---|---:|---:|---|---|---|---|---:|
| NTD / 2026-10-19 | 0 | 0 | — | — | 0 / 0 / 0 | 0 / 0 / 0 | 0 |
| MS NOW / 2026-10-19 | 18 | 17 of 18 | 00:00–22:00 UTC (22 h) | 0 / 0 / 0 h min/median/max for 17 metadata records | 0 / 0 / 0 | 0 / 17 / 0 | 0 |

The NTD search had no hits, so MS NOW was used as the P1 network. The final query found 18 items; metadata for one item was not fetched because only three P1 starts remained, which was not enough for one metadata request plus three requested TV SRT samples. All 17 inspected items listed only private `cc5.srt`; **no private caption file was requested**. There were no eligible public TV caption files, so three TV SRT byte/cue samples and a TV-derived channel-hour rate could not be measured.

Radio scheduler evidence for 2026-10-19: 12 scheduled items, 43,200.5 scheduled seconds (about 12 h), 12 metadata results, and 12 listed public ASR files. Two full public ASR SRT samples were requested:

| Sample | SRT bytes | Cues | Merged rows (≤30 s) | Merged text bytes | CSV bytes | Runtime seconds | CSV bytes / channel-hour |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | 79,981 | 846 | 127 | 52,044 | 79,483 | 3,586.00 | 79,793.3 |
| 2 | 68,800 | 740 | 129 | 44,358 | 72,232 | 3,629.09 | 71,653.0 |

The two measured radio samples average **75,723.15 CSV bytes/channel-hour**. This is a radio-ASR measurement, not a measured TV-caption rate. For a clearly conditional capacity illustration only, treating all channels as if they matched that radio average and treating the owner’s nine radio items as nine channel-hours gives:

| Scenario | Proxy bytes/day | 50,000,000-byte raw-cap equivalent | Seven-day retention / per-day budget implication |
|---|---:|---:|---|
| CNN + FOX + MS NOW (3 TV networks) + 9 radio hours | 6,133,575 | 8.15 days | Nominal day fits the 7,142,857-byte budget; retention caps this at 7 days |
| CNN + FOX + MS NOW + BBC + NTD (5 TV networks) + 9 radio hours | 9,768,286 | 5.12 full-data-day equivalents | Nominal day exceeds the day budget; uniform-rate proxy admits about 73.1% before whole-item `day_budget` skips |

**Measured days held for 3/5 TV networks: NOT VERIFIED.** No public TV SRT was available. The table above must not be treated as a TV forecast. The collector’s hard day budget is 7,142,857 bytes; it never truncates an item or row.

## P2 — offline implementation

The drop-in contains 17 files under `tools/captions-daily/` and one workflow file at `.github/workflows/ajn-captions-daily.yml`. It uses Node 22 ESM and the existing `tsx` dependency; no dependency or lockfile changes were made. The collector reuses the app’s `parseSrt`, `pickCaptionFile`, `NEWS_NETWORKS`, and `archive-infowars-radio` schedule. Public caption priority is aligned > broadcast-cc > ASR; private, dark, and access-restricted records/files are skipped. The source priority used for day-budget admission is radio, CNN, FOXNEWSW, MSNOW, BBCNEWS, NTD; final CSV rows are ordered by source kind, channel, UTC start, item ID, and local start.

The default radio limit is nine items/day, as directed. The existing app scheduler returned 12 items, so the collector records over-limit items as whole-item `radio_limit` skips. The app exposes no durable playback ledger; this is a deterministic schedule selection, not proof that each item actually played. NTD is included because the owner approved it, although it is not present in the app’s `NEWS_NETWORKS` registry. Genre labels use `News` for TV and the existing `audioGroupOverrides.json` `Talk Radio` group for `archive-infowars-radio`.

The final daily CSV schema is `day_utc,start_utc,start_s,end_s,source_kind,channel,program,item_id,item_url,caption_kind,machine_generated,genre,text`. It is BOM-prefixed, RFC4180-quoted, and uncompressed. `MANIFEST.csv` records `day,bytes,rows,items_ok,items_skipped,reason_counts,sha256`. The seven-day rotation counts the manifest toward the 50,000,000-byte **folder** cap. A whole item and later candidates are skipped on `day_budget`; one day plus manifest above the folder cap fails loudly.

**Verification on Node v22.22.0:**

- `NET_GUARD=block ... node --import=tsx --test tools/captions-daily/test/*.test.mjs` — **31 passed, 0 failed; 0 outbound Archive attempts**.
- `node --import tsx tools/captions-daily/cli.mjs --selftest` — **3 synthetic days; each 676 CSV bytes, 2 rows, 2 items, 0 skips; 333-byte manifest; 2,361 total folder bytes; 3 retained days**. All fixture text is invented.
- `node --check` on all 14 `.mjs` implementation/test files — passed.
- Workflow copies compare byte-for-byte; static workflow checks pass.
- Local bare-Git simulation of the workflow’s orphan `commit-tree` plus `--force-with-lease` — **PASS**: after two replacements, the branch had one parentless commit and only `README.md` and `data/` at its root.

The workflow is scheduled at `23 12 * * *`, uses `workflow_dispatch` inputs `day` and `dry_run`, `contents: write` only, concurrency without cancellation, a 60-minute job timeout, and actions pinned to full SHAs. The SHAs were checked against the corresponding public tags. The commit message is three counts only. Existing `.github/workflows/ajn-ci.yml:5-8` triggers pushes only on `main`; `.github/workflows/ajn-nightly.yml:3-6` is scheduled/manual only. Neither was edited. The data branch is an orphan `captions-archive` branch, not `main`; the app and Google Builder do not read it.

The configured TV offset defaults to `TV_ADDITIONAL_LAG_DAYS=0`, overrideable by the Actions variable `AJN_TV_ADDITIONAL_LAG_DAYS` (0–30). The metadata fields read during this one snapshot showed 0-hour age, but a one-time snapshot cannot establish search-index publication latency; the offset remains unverified.

## P3 — live dry-run

P3 used **20/20** allowed starts: 1 NTD search, 1 radio candidate search, 12 radio metadata requests, and 6 full public radio ASR requests. All 20 were HTTP 200, with 0 redirects and a measured minimum interval of 2,001 ms. The NTD search returned 0 items. Six radio items were exported; six of the 12 scheduled items were skipped by the P3 six-item request-cap setting. The temporary output contained 772 rows, a 453,059-byte daily CSV, and a 453,487-byte folder in that run. `tempOutputRemoved=true`, and an independent filesystem check confirmed the temporary directory was absent.

**P3 is PARTIAL, not a final-format live pass.** That run occurred before the final 13-column CSV and `MANIFEST.csv` corrections; its temporary output used the earlier 12-column schema and JSON manifest and was deleted. Its exact SRT input bytes and wall-clock elapsed time were not emitted by that version. From 20 starts with a measured minimum 2,001 ms gap, the start-to-start lower bound was 38,019 ms; exact elapsed time is not verified. The final CLI now reports elapsed time and input bytes per request type, but no Archive requests remain within this job’s P3 cap to rerun it.

P1 used the existing G1B fixed helper (SHA-256 `399f70b8c8c17b1129ca34d73b271f528f8fc86374148e6d37acdc5ee4eb2e46`). **P3 used the new collector’s `ArchiveClient`, not that pre-existing fixed helper**; the independent network guard counted exactly 20 Archive starts, with the same stop/no-retry behavior and 2,001 ms minimum spacing. This helper-provenance deviation is recorded, not concealed.

## Request ledger, rights risks, and verification status

| Phase | Physical starts (redirect hops included) | Redirects | Statuses | Minimum gap | Result |
|---|---:|---:|---|---:|---|
| P1 | 37 / 40 | 1 | 36 × 200, 1 × 302 | 2,001 ms | PARTIAL: no public TV caption file; 3 TV samples unavailable |
| P3 | 20 / 20 | 0 | 20 × 200 | 2,001 ms | PARTIAL: six radio items; final-format/live timing fields not verified |
| Total | **57 / 60** | **1** | **56 × 200, 1 × 302** | **≥2,001 ms** | Within the whole-job cap; no more Archive requests were made |

No 403, 429, `Retry-After`, or 5xx response occurred. No private caption file was requested. No real caption text was included in reports, logs, screenshots, or fixtures; test fixtures contain invented text only. The P3 temporary CSV was removed. No live Archive request was made after P3.

| Check | Status | Evidence / remaining limitation |
|---|---|---|
| P1 radio sample sizes and cues | VERIFIED | Two public radio ASR SRTs; numeric measurements above |
| P1 TV public caption sample | NOT VERIFIED | 17 metadata records list private `cc5` only; no public TV SRT fetched |
| P1 3/5-network capacity | NOT VERIFIED | Radio-derived proxy only; no eligible TV caption bytes |
| P2 offline tool, CSV schema, manifest, rotation, search, request stops | VERIFIED | 31 tests and three-day synthetic self-test pass |
| P3 live collector request/cleanup path | VERIFIED for 6-item probe | 20 starts; 772 rows; 453,059 CSV bytes in pre-final schema; temporary output absent |
| P3 final-format live output and exact elapsed/input bytes | NOT VERIFIED | No rerun under the 20-start phase cap |
| P3 fixed-helper provenance | NOT VERIFIED | Used the new embedded helper; net guard still measured the starts and spacing |
| GitHub Actions execution and branch-protection behavior | NOT VERIFIED | Local bare-Git simulation only; no GitHub write or workflow run |
| Archive Terms/API guidance and transcript licence | NOT VERIFIED | Endpoint response did not establish applicable terms; owner/legal review required |
| App build, Cloud Run, runtime, and Builder | NOT RUN | App source untouched; this task did not deploy or change runtime files |

The repository is public. The data is placed on an orphan `captions-archive` branch, not `main`; AJN and Google Builder will not consume it. Each successful run replaces the branch with one squashed parentless commit via `--force-with-lease`, but old commit SHAs may remain reachable and forks/clones retain copies. Rotation out of `data/captions/` is not erasure. The 50,000,000-byte cap covers only that folder, including its manifest, not total repository size. Original rights holders retain ownership; public availability and owner approval do not establish a licence. The data README labels broadcast captions separately from machine ASR, disclaims endorsement, and names the owner as takedown contact. Do not activate the workflow until the owner resolves the terms/rights uncertainty and the schedule-versus-playback interpretation.

The required base was the owner export plus the exact all-in-one overlay. No later AudioSlim, RadioCaptions, or G6CT pack was available in this run. The recorded branch name is `feat/captions-daily-csv`; no project/GitHub commit, push, merge, or deployment was made. The protocol test created two temporary commits in a disposable local bare-Git harness, then removed that harness. The known roughly 56 TS2307 errors under `full-files-for-export-baseline/` were not touched; no root typecheck was run because app source was unchanged.

## NEXT BUILD OUTLINE

1. Resolve Archive terms/licence and public-transcript rights before enabling public writes.
2. Confirm whether the nine radio rows mean the first nine scheduled entries or actual playback history.
3. Place the reviewed `tools/captions-daily/` files on `main`.
4. Add only `.github/workflows/ajn-captions-daily.yml` in the activation change.
5. Confirm Actions `contents: write` and the repository’s branch-protection policy.
6. Set the TV lag variable only after indexing delay is measured.
7. Dispatch `dry_run=true` after the job request budget is available again.
8. Verify final 13-column CSV, manifest, input-byte totals, and elapsed-time ledger.
9. Review the whole-item skip counts and seven-day folder rotation.
10. Enable the schedule only after owner review.
11. Keep the archive separate from runtime and Google Builder.
12. **I will NOT re-test: prior G17/G18B, radio strip, audio guide, proxy 206, or TV News behavior.**
