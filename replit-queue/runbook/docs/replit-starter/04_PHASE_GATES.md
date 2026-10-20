# PHASE GATES - build slowly, ship a ZIP at every gate

Applies to every job. The owner audits each phase, uploads it to Google Builder, tests it, and only then says GO for the next phase.

1. One phase at a time. When a phase is finished and its tests pass, STOP. Do not start the next phase until the owner replies "GO PHASE <n>" (or "GO PART <n>").
2. At every gate deliver a ZIP of that phase only, per 01_DELIVERY_PROTOCOL.md: `deliver/<JOB>_phase<n>/` + `<JOB>_phase<n>.zip`, with `REPORT.md`, `commands.txt`, `FILE_SUMMARIES.txt`, final changed files at repo-relative paths, `combined.patch` and the `git apply --check` output against the previous gate's final commit. End with `ZIP READY: <path> <size> <sha256>`.
3. Split the files into two lists in FILE_SUMMARIES.txt: RUNTIME files (what Google Builder needs to run the app) and TEST/DOC/PREVIEW files (not needed to run). Say which runtime files are large (> 1 MB) and why.
4. Run the real mechanics, not stand-ins: start the production build (`npm run build`, then `PORT=3000 NODE_ENV=production node dist/server.cjs`), call the real routes with curl, and paste status, headers and sizes. Where a stub or fake player is used, label it SYNTHETIC. What cannot be checked in Replit (real H.264 playback, audio sync, real phone, Cloud Run, Google Builder) goes in NOT VERIFIED with the reason.
5. Wiring first: before editing, print where the new code is called from (file:line of the mount, the import, the route registration, the UI mount). After editing, print the same lines again. A feature that is not reachable from a running route or screen is not done.
6. Network guard: wrap every test and script that could reach archive.org in a guard that counts and blocks outbound attempts, and print the count. Never run a test unguarded to "see what happens".
7. If something fails or is slower than expected, report the measured numbers and the cause you found. Do not weaken an existing test or limit to make it pass; propose the change and wait.
8. Never claim an owner decision that was not given. If a rule in the prompt conflicts with an existing test or limit, say so at the top of the gate report and follow the prompt unless it would break a protected rule.
