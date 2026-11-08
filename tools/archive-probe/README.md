# Archive index probe (read-only)

Builds a searchable index of what is actually on the Archive accounts and diffs it against what the app uses.
HTTP GET only. Writes nothing to Archive.org and nothing to app data; reports go to `reports/probe/` (workflow artifact).

- `archive_probe.py` discovers `@infobattalion` lists/favorites/uploads and `@sammo770` uploads (JSON APIs), reads
  `/metadata/<id>`, admits only files with a real `length` and no restriction flags; the rest go to `gap_report.json`
  with reasons. Zip/7z members are listed as gaps (`zip_member_duration_unverified`), never admitted.
- `probe_diff.py` compares the index with the app manifests and the skipped/excluded lists and reports the six named shows.
- Workflow `ajn-archive-probe` (manual): optional `only_items` for a targeted run; secret `ARCHIVE_UPLOADER_EMAILS`
  (optional) enables the uploader cross-check. The email is never written to any report or log; a leak-check step enforces it.
- Offline tests: `python -I tools/archive-probe/archive_probe.py --self-test` and `python -I tools/archive-probe/probe_diff.py --self-test`.
- Exit codes: 0 ok, 2 no lists/uploads for @infobattalion, 3 >20% metadata errors, 4 nothing admitted.
