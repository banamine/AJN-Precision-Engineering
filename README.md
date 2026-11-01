# AJN buffer diagnostics drop-in (base: main 4c4c855)

NOT a behavior fix. No playback behavior changes. It adds the data needed to name the cause of the ~2.4 s buffer on some films.

Files (copy over, same paths):
- src/telemetry.ts        +9 lines: networkState / readyState / preload on buffer samples
- src/MinimalPlayer.tsx   +3 lines: passes those three values from the <video> element
- public/buffer-probe.html  NEW static page (served at /buffer-probe.html after build)

Apply: copy the three files into the repo, or `git apply buffer-diagnostics.patch`.
Verified: `npx tsc --noEmit` passes on base + these changes.
Rollback: delete public/buffer-probe.html and revert the two src files (or revert the branch).

After deploy:
1. Open /buffer-probe.html on the live app, paste item lines
   `group | label | /download/<identifier>/<file>`, seconds per arm 45, Run, Copy JSON.
2. Or play a film ~60 s and paste getBufferSamples() (now includes networkState/readyState/preload).

Why not a preload fix: headless Chromium A/B with autoplay showed preload="metadata" vs "auto" makes
no real difference (1588 kbps: 17.8 s vs 16.0 s ahead), so it is not proven to be the cause.
