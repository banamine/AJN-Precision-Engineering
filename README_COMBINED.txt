AJN combined drop-in 2026-10-30 = F4 archive isolation + Telemetry Audit/fetchState gauge.
Extract over the repo root (paths are repo-relative). Do NOT also apply the two source zips; this replaces both.
src/MinimalPlayer.tsx = F4 version + 2 telemetry edits (networkState in gauge push; fetchNote in bufferLine).
Verify: npx tsc --noEmit ; run the six test-*.ts from the F4 README ; then Appearance > Telemetry Audit.
