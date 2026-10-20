# AJN Daily Captions Archive

This is a data-only archive for AJN's daily caption exports. It is a public, orphan `captions-archive` branch, separate from `main`; the AJN app and Google Builder do not read this branch.

Each successful scheduled run creates one squashed orphan commit and replaces the branch using `--force-with-lease`. This limits the visible branch history, but older commit SHAs may remain reachable, and forks or clones can retain copies. A day rotated out of `data/captions/` is not necessarily gone from the Internet.

The 50,000,000-byte cap applies only to `data/captions/`, including its manifest. It is not a repository-wide size limit.

`data/captions/` contains one plain `YYYY-MM-DD.csv` file per retained day and a `MANIFEST.csv` with per-day byte, row, item, skip-reason, and SHA-256 counts.

Source: Internet Archive TV News / radio_asr caption and transcript files. The files are selected only when listed as public in item metadata. Every row records `caption_kind` separately: `aligned`, `broadcast-cc`, or `asr`; machine-generated rows set `machine_generated=yes`. ASR is not broadcaster captioning. The export is not endorsed by Internet Archive or any broadcaster.

Radio selection follows the deterministic `archive-infowars-radio` schedule for the target UTC day and the owner-set nine-item cap. The current app code can return more than nine schedule entries and exposes no durable playback-history record; this export is a schedule selection, not proof that every selected item actually played.

Caption/transcript text may be protected by copyright or other rights. Public availability and the owner's acceptance of public republication do not transfer those rights or establish a licence. Rights holders retain ownership; obtain any needed permissions and honor applicable terms. Takedown contact: the repository owner, `banamine`.

The workflow must be present on `main` at `.github/workflows/ajn-captions-daily.yml`. Owner review should merge only that workflow file; the tool remains under `tools/captions-daily/`. The workflow requires repository Actions permission for `contents: write`; it uses only the automatically provided `GITHUB_TOKEN`.

`dry_run` writes its generated CSVs only to a temporary directory and removes that directory before exit. It never pushes the data branch.
