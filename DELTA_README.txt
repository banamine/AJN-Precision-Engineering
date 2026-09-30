AJN delta: main 37b8c7f -> 8faa509 (PR #80, real Rumble seed + news-wall ranking)
Unzip over the project root, then FULL rebuild/republish (npm run build + restart).
After republish expect: GET /api/rumble/baseline -> ok:true, version 2, 16 items, 16 channels.
No UI, no playback, no Rumble fetches.
