# Batch 4 (2026-11-15) - apply after Batch 3
- server/sources/liveTv.ts (one line, 76): a live-channel group like "Crime &amp; Docs" was cut at the ";" so the chip read "Crime &". The "&amp;" is now turned into "&" before the group list is split. Takes effect after redeploy and the next live-list refresh (every 6 h).
- src/buildInfo.ts: "batch 4".
