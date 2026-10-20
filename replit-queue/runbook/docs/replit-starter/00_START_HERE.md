# START HERE - AJN Precision Engineering (read before any task)

Scope: `banamine/AJN-Precision-Engineering` ONLY. Never AJN-pro-play-, never AJN-Media-Console.
The phase prompt tells you the job. If this file and the prompt disagree, follow the prompt and flag the conflict at the top of your report.

## 1. Truth protocol
- Never write "done", "fixed", "working", "verified" or "running" unless the same message holds the exact command you ran and its pasted output.
- Not run = write `NOT RUN`. Failed = paste the failure. Do not summarise or soften output.
- Label every claim VERIFIED (file:line, or a saved response/ledger line) or UNVERIFIED.
- No fake telemetry (no Math.random(), no hardcoded metrics). No silent fallbacks (no BigBuckBunny, no sample video, no synthetic channels). Failures are explicit, named states.
- Evidence first: investigate and report before you build. Investigation phases change no app code.

## 2. Map (read only these; use `git grep -n` for the rest)
- Live server: root `server.ts`; also root `channels.ts`, `guideRegistry.ts`, `newsFeed.ts`. Routes and sources in `server/` (`server/sources/classicM3u.ts`, `server/sources/liveTv.ts`, `server/proxyRange.ts`, `server/archiveFetch.ts`).
- Frontend: `src/main.tsx` -> `src/App.tsx`; player `src/MinimalPlayer.tsx`; telemetry `src/telemetry.ts`.
- Node 22. Install `npm ci` (never `npm install`). Build `npm run build` -> `dist/server.cjs`.
- IGNORE: the nested duplicate folder `AJN-Precision-Engineering/` inside the repo, `images/`, `m3u_files/`, `json_files/`, `other_files/`, root `*.md` reports, `*.zip`, `*.patch`.
- If two files share a name, the one at repo root or under `src/` / `server/` is live.

## 3. Hard rules
- Protected core, do not rewrite: UnifiedPlaybackEngine, BroadcastTVGuide, PlayerStore, StatusIndicatorBar, ChannelManager, SchedulerEngine, PluginHost, ArchiveProvider, IPTVProvider, DiagnosticsHUD. Minimum wiring only; list every touched line.
- One implementation: reuse existing helpers; no second parser, HTTP helper or proxy.
- Cloud Run: a proxied response never exceeds 32 MiB; media goes through bounded 206 slices <= 8 MiB (`server/proxyRange.ts`). Do not change PROXY_SLICE_BYTES.
- HLS (if ever touched): cleanup order `stopLoad -> detachMedia -> destroy -> nullify`. The repo uses native `<video>` today.
- Archive politeness: read-only, 1.5 s spacing, max 2 concurrent, no media downloads (HEAD or Range bytes=0-0 only). On 403/429 stop that job and record it; never retry in a loop. Tests make 0 Archive requests.
- Never commit, print or log secrets, signed-URL query strings, e-mails or personal data. Do not push, merge or deploy.
- Manifest JSON must be ASCII-only (\uXXXX escapes).

## 4. Report format (REPORT.md, exactly)
1. TL;DR (3 lines).
2. Job/part table: id -> PASS / FAIL / PARTIAL / BLOCKED / NOT DONE -> evidence path.
3. Findings that change an earlier conclusion (each with evidence).
4. VERIFIED / NOT VERIFIED table (NOT VERIFIED must name why).
5. Request counts (Archive and other hosts) and any 429/5xx.
6. Risks and rollback.
7. Questions for the owner (max 8, each with your recommended default).
Then STOP. Do not start the next phase.
