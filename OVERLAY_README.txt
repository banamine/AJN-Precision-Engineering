Owner base overlay for Prompt D (2026-10-18)
Extract over origin/main (68bd8d5) + your AJN_two_rounds.patch, same paths. Do NOT overwrite server.ts or server/archiveFetch.ts (yours are newer).
Contents = drop-in 2 (108 s wait watchdog, slow-source note, podcast freshness, loadSchedule stale fix), drop-in 3 (rosymild series channels), drop-in 4 + 4b (boris1971 channels, ASCII-only manifest), drop-in 5 (radio presets + live-radio resume fix).
This replaces the older 12 s watchdog. Report any file that fails tsc after overlaying.
