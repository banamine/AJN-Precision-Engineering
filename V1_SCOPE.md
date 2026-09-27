# AJN Precision Engineering V1 Scope

This package is a clean drop-in candidate for Builder/dev testing. It preserves the existing Google Cloud playback/player architecture and adds a small persisted My News Chain over verified Archive TV News search results.

## Protected
- Native player and AudioBridge
- Existing TV Guide / EPG architecture
- Archive proxy transport implementation
- Existing five primary destinations

## V1 behavior
- Search returns Archive TV News records.
- Play Instant resolves the actual MP4 derivative from Archive metadata; it never manufactures `{identifier}.mp4`.
- Add to Chain resolves first, then stores up to six playable entries in localStorage.
- TV Guide shows `My News Chain` as a virtual channel when saved entries exist.
- Chain playback advances sequentially and loops.
