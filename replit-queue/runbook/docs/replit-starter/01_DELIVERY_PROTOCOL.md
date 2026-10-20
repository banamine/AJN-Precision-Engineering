# DELIVERY PROTOCOL - how to hand your results back

You cannot write to the owner's computer. Package everything inside the Replit project; the OWNER downloads one ZIP and saves it to `N:\New Downloads\replit-reports\<JOB>\` where the reviewing assistant reads it. Do not tell the owner a file is "on N:" - it is not.

## Package (one folder, then one ZIP)
Create `deliver/<JOB>/` (JOB = prompt letter and date, e.g. `G_2026-10-18`) containing:
1. `REPORT.md` - format in 00_START_HERE.md section 4.
2. `ledger.ndjson` - one line per outbound network request: `ts, host, path (no query), status, ms, bytes, error`. No line = UNVERIFIED.
3. `commands.txt` - every command you ran with its raw output (tsc, build, each test, `node -v`, request counts).
4. `FILE_SUMMARIES.txt` - one true line per changed file (say only what really changed).
5. `changed-files/` - FINAL versions (not diffs) of every file changed, at repo-relative paths. Preview/test-only files in `changed-files-preview/`.
6. `combined.patch` and `git-apply-check.txt` (output of `git apply --check` on a clean checkout of your base).
7. `screens/` - screenshots named by what they show (e.g. `390px-search-ep4398.png`).
8. `PATCH_SHA256SUMS` - `sha256sum` of every file above.

Then: `cd deliver && zip -r <JOB>.zip <JOB>/` and show the final line `ZIP READY: deliver/<JOB>.zip <size> <sha256>`.

## Rules
- No `node_modules`, no lockfile changes unless the prompt says so, no descriptions or e-mails copied from Archive metadata.
- If a part is unfinished, ship the finished part and mark the rest NOT DONE with the reason.
- If you are blocked (network, missing key), say so at the top of REPORT.md and mark that job BLOCKED; do not guess.
- Keep each file under 25 MB; split the ZIP (`<JOB>-part1.zip`, ...) if larger.

## Owner steps after you finish (for reference)
1. Download `<JOB>.zip` from Replit.
2. Save it to `N:\New Downloads\replit-reports\<JOB>\` and unzip there.
3. Tell the reviewing assistant "check"; it reads REPORT.md and the ledger from that folder.
