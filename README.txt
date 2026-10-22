AJN EPG music-row fix (base: banamine/AJN-Precision-Engineering main 68bd8d5)
Apply: from repo root `git apply epg-music-guide.patch`, or copy files/ over the repo (same paths).
Then: npx tsx test-group-programs-for-grid.ts && npx tsx test-music-lane-tag.ts

1. guideRegistry.ts  tagMusicLane(): whole-item Archive channels in group "Music" (48 of 71) get metadata.lane="music"
                      at the registry, so the guide groups them. OTR / talk / airchecks are NOT tagged.
2. groupProgramsForGrid.ts  bucketHoursFor(): block size 1/2/3/4/6 h so each block >= 150 px at the current zoom.
                      Live track always marks the bucket containing "now" (even if it started earlier).
3. BlockCell.tsx      thumbnail via LazyThumb (loads near viewport only), tooltip, tiny blocks show count only.
4. EpgGuide.tsx       audio guide rows 84 px (video stays 68); now-line height and paging follow it.
NOT changed: isMusicChannel, TrackDrawer, row paging, server, data files.
Known: drawer/label "of N" counts the server's ~12 h window of the loop, not the whole day.
Pre-existing: test-archive-item-guide.tsx fails on unmodified main too.
