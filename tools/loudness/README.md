# Loudness batch (offline, ffmpeg)

Measures every audio file, applies the gentlest change that hits the target, re-measures, and logs everything. **Originals are never modified** (`--out` must be a different folder).

Default target (a starting point, not a Google spec): **-16 LUFS integrated, -1.5 dBTP max true peak**. Change with `--lufs` / `--tp` if your distributor's delivery spec says otherwise.

```
node tools/loudness/normalize-batch.mjs --in "B:\audio\in" --out "B:\audio\out" --dry-run   # measure + plan only
node tools/loudness/normalize-batch.mjs --in "B:\audio\in" --out "B:\audio\out"             # do it
```
Options: `--lufs -16 --tp -1.5 --lra 11 --tolerance 0.5 --max-gain 12 --force`

How it decides, per file:
1. Measure (ffmpeg `loudnorm` analysis, EBU R128).
2. Constant gain (`volume`) when the peak still fits under the true-peak limit. Otherwise two-pass `loudnorm` in **linear** mode. If loudnorm falls back to dynamic mode the file is flagged `review`.
3. Re-measure the output. PASS = within `--tolerance` LU of target and true peak <= limit (+0.1). Lossy re-encoding can shift loudness slightly, so one automatic correction is tried (re-encoded from the original).
4. `review` (needs a human, nothing silently processed): near-silent input, gain larger than +-12 dB, output off target and cannot be fixed without limiting. `fail`: ffmpeg error / unmeasurable output.
5. Flags: LRA > 15 (loudness alone will not even out quiet/loud sections), outlier vs the rest of the batch, dynamic-mode fallback.

Outputs in `--out`: normalized files (same relative paths, same codec/bitrate/sample rate; embedded cover art is not copied), `normalize-log.jsonl` (append-only audit trail), `normalize-log.csv` (latest row per file). Log fields include SHA-256 of the original, ffmpeg version, target, input and output LUFS / true peak / LRA, gain, method, status, reasons, time. Re-running skips files whose SHA-256 and settings are unchanged (`--force` to redo).

This is separate from `src/use-audio-normalization.ts`, which is the live in-browser level matching and is unchanged.
Needs ffmpeg on PATH (free): Windows `winget install Gyan.FFmpeg`, then open a NEW PowerShell window.
