# STORAGE_MAP.md

Single source of truth for where things live on the owner's Windows PC.
Copilot: use this file to decide which drive a path belongs on. Update it when a drive changes.

## Rule of thumb
- **Code** = small, in git, safe to edit.
- **Media** = huge, never in git, never edited by Copilot. Only scripts read from it or write to it.

## Drive map

| Drive / path | Holds | In git? | Notes |
|---|---|---|---|
| `B:\AJN Precision Engineering\AJN-Precision-Engineering\repo` | **This repo** (local clone, where PowerShell tests run) | Yes | In-scope app. Quote the path (it has spaces). |
| `B:\AJN-pro-play-` | Separate app, different repo | Yes (other repo) | **Out of scope.** Never mix with this repo. |
| `B:\` (everything else) | Heavy media and working folders | No | Do not add to git. |
| `N:\M3UStripTool\M3UStripTool` | M3UStripTool, reference tool for AJN principles | Separate | Reference only, not a target. |
| `N:\` (everything else) | Media banks, raw video, archive zips | No | Source drive for media scripts. |
| `D:\remux\<name>` | Remux (faststart) outputs, e.g. `D:\remux\stargate-atlantis-s05` | No | Needs about 12 GB free for a 20-episode item. |
| `G:\My Drive\AJN\faststart\<name>` | Google Drive for desktop sync of finished files | No | Staging only. Owner uploads to Archive.org manually. |
| `C:\Users\banamine\...` | Windows profile, tool configs, scratch, other code | Varies | Never reference `C:\Users\...` from app code. |

> Confirm before committing: the repo clone location above (B:) comes from earlier project notes. If the repo now lives under `C:\Users\banamine\...`, change only the first row.

## Script parameters (verified against the scripts)

| Script | Parameters | Example |
|---|---|---|
| `remux-archive-zip-members.ps1` | `-OutDir` (required), `-Identifier`, `-Limit`, `-PauseSeconds` | `powershell -ExecutionPolicy Bypass -File .\remux-archive-zip-members.ps1 -OutDir "D:\remux\stargate-atlantis-s05" -Limit 1` |
| `remux_zip_members.py` | `--out` (required), `--item` (repeatable), `--limit`, `--pause` | `python remux_zip_members.py --out "D:\remux\sa-s05" --limit 1` |

Both need `ffmpeg` and `ffprobe` on PATH (`winget install Gyan.FFmpeg`, then open a **new** terminal). Both write `remux-log.csv` in the output folder and are safe to stop (Ctrl+C) and re-run.

Neither script has a `-SourceDrive` parameter. Add one only if a script declares it. If you add a drive parameter, document it in this table.

## Rules for Copilot
1. Put scripts and app code in the repo. Put media only on N:, B:, D: or G:.
2. Never hardcode a drive letter in TypeScript, React, Express or Python app code. Use config or environment variables.
3. Drive letters belong in docs, command examples and script parameters.
4. Always quote paths with spaces.
5. Before a command writes media, say which drive and how much free space is needed.
6. Never add `.mp4`, `.zip`, raw video banks or remux outputs to git.
7. Never upload to Archive.org from a script.

## Cloud vs local

| Environment | Has access to local drives? | Notes |
|---|---|---|
| Local PC (PowerShell) | Yes | Runs scripts, remux, tests. |
| GitHub Pages | No | Static only, no `/api/*`. |
| Vercel / Replit | No | Cannot see N:, B:, D:. |
| Google Cloud Run | No | Streams media through `/api/archive/proxy`, bounded 206 slices (max 8 MiB, 32 MiB hard limit). |
