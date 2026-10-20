# Captions Daily CSV tool

This folder contains a Node.js 22 ESM collector, CSV/search helpers, tests, and the matching workflow copy. It reuses the app's `parseSrt`, `pickCaptionFile`, `NEWS_NETWORKS`, and `archive-infowars-radio` deterministic scheduler; it adds no package or lockfile dependency.

## Run

```sh
npm ci --no-audit --no-fund
node --import tsx --test tools/captions-daily/test/*.test.mjs
node --import tsx tools/captions-daily/cli.mjs --selftest
node --import tsx tools/captions-daily/cli.mjs --dry-run --out "$RUNNER_TEMP/captions-output"
```

The default run targets the previous complete UTC day. `TV_ADDITIONAL_LAG_DAYS` defaults to `0` and accepts an integer from `0` to `30`; set the GitHub Actions variable `AJN_TV_ADDITIONAL_LAG_DAYS` only after a measured publication delay. Optional CLI arguments are `--day YYYY-MM-DD`, repeatable `--network CHANNEL`, `--radio-limit N`, `--request-cap N`, `--existing-dir PATH`, `--out PATH`, and `--dry-run`. Production runs use the shared bounded request helper, a 2-second physical-start interval, no retry, and immediate stop on 403, 429, `Retry-After`, two consecutive 5xx responses, or request-cap breach.

The default radio limit is nine scheduled entries. The current app's daily schedule has returned twelve entries, and the app has no durable playback ledger; these are deterministic schedule selections, not verified playback events. The owner-defined source priority is radio, CNN, FOXNEWSW, MSNOW, BBCNEWS, then NTD. NTD is owner-approved for this export but is not admitted by the app's `NEWS_NETWORKS` registry.

Public caption source selection is `align` > `cc5` > `asr`; item-level private, dark, or access-restricted records are skipped, as are private caption files. Each CSV row preserves `caption_kind` (`aligned`, `broadcast-cc`, or `asr`) and `machine_generated`; ASR is never presented as broadcaster captions. Radio uses public `.asr.srt` only. The CSV is BOM-prefixed and RFC4180-quoted; cues are grouped into at-most-30-second windows without truncating a cue.

The CSV columns, in order, are `day_utc,start_utc,start_s,end_s,source_kind,channel,program,item_id,item_url,caption_kind,machine_generated,genre,text`. `start_utc` is blank only when an item's UTC start cannot be parsed; it is never guessed. Rows are emitted in stable `source_kind,channel,start_utc,item_id,start_s` order.

The output folder contains `YYYY-MM-DD.csv` files plus `MANIFEST.csv`, whose columns are `day,bytes,rows,items_ok,items_skipped,reason_counts,sha256`. The daily CSV budget is 7,142,857 bytes; retention is seven whole UTC-day files; the folder cap is 50,000,000 bytes including the manifest. If an item would exceed the day budget, that item and remaining candidates are skipped as whole items with `day_budget`; no partial rows are retained. If even one day plus manifest exceeds the folder cap, the run fails.

The CLI prints numeric/boolean metadata only. It does not print caption text, item identifiers, or URLs. Dry-run CSVs are written to the supplied temporary output directory and removed before success. The local search helper reads CSV text in memory and prints matching row metadata without the text:

```sh
node tools/captions-daily/search.mjs --directory data/captions --query "words to find" --day 2026-10-19
```

## Rights and publication

The generated CSV is intended only for the separately reviewed `captions-archive` orphan branch. Public availability and owner authorization do not establish a licence; see `data-branch-readme.md` for the rights, retention, branch-history, and takedown warnings. The scheduled workflow is a separate file at `.github/workflows/ajn-captions-daily.yml`; it must not be activated until the owner has reviewed the rights/terms risk and confirmed required repository permissions.

## Owner activation checklist

1. Add the `tools/captions-daily/` files to the app repository without changing runtime or Builder files. The workflow must also be on `main`; once the tools are present, the activation change is the single `.github/workflows/ajn-captions-daily.yml` file.
2. In GitHub, open **Settings → Actions → General → Workflow permissions** and allow **Read and write permissions** (`contents: write` is the workflow's only permission). Do not add a separate credential; the workflow uses the default `GITHUB_TOKEN`.
3. Open **Actions → AJN Daily Captions Archive → Run workflow**. Supply an optional UTC `day`; use `dry_run=true` to verify a temporary export without pushing. A normal run replaces the `captions-archive` branch with one parentless squashed commit.
4. Inspect `data/captions/MANIFEST.csv` on `captions-archive` for per-day bytes, rows, successful/ skipped item counts, skip reasons, and SHA-256. The app and Google Builder do not read this branch. Rotation removes whole oldest day files; GitHub may retain old commit SHAs and forks/clones retain their copies, so rotation is not erasure.
