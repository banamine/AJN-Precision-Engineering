# AJN Zip Workbench v2

Fixes Archive.org "zip member" episodes (index at the end, no Range support) so they can seek:
downloads one episode at a time to local temp storage, rewrites it with `ffmpeg -c copy -movflags +faststart`
(no re-encode), verifies it (H.264 + AAC, duration within 2 s, index first), then publishes it.
It never uploads anywhere.

* Desktop window: double-click `AJN_Zip_Workbench_v2.pyw` (Windows, Python 3.9+, ffmpeg on PATH).
* No window (used by GitHub Actions): `python AJN_Zip_Workbench_v2.pyw --headless --item <archive-id> --out <folder> --limit 1`
  Exit codes: 0 completed, 1 completed with failures, 2 cancelled, 3 failed.
* Output: `<out>/<item>/<zip>/<episode>.mp4` and `<out>/runs/<timestamp>/{summary.txt,run-log.csv,playlist.csv,workbench.log}`.
* Tests (need ffmpeg): `python test_workbench_v2.py && python test_workbench_v2_extra.py`

GitHub: Actions -> `ajn-zipmember-stage` -> Run workflow. Reports are kept as a private-to-viewers artifact.
**This repository is public**: the episodes themselves are only kept as an artifact when you tick `keep_media`
(anyone signed in to GitHub could then download them). Default is reports only.
