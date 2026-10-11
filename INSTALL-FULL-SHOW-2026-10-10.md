# Full Show = the day's real parts, played in order (2026-10-10)
Same-path replacement. Install AFTER (or with) the Today/Replay zip: PlayerView.tsx here includes those changes too.
NEW: src/utils/ajnShowGroups.ts, src/utils/showQueue.ts, src/components/FullShowStatus.tsx, test-full-show.ts
CHANGED: src/components/RadioView.tsx, src/components/PlayerView.tsx

Evidence (live feeds, 2026-10-10): weekdays = Alex Hr1-4 + War Room Hr1-3, video exists only as per-hour .m4v, plus ONE whole-show mp3 (no video of the whole show). Sunday = Alex Hr1-2 + Sunday Night Live Hr1-2 (regular line-up). Saturday = one "Alex-Special" mp3+m4v (special broadcast). The old FULL SHOW button just played the single file/hour clicked; nothing chained parts.

What changes
1. Radio: new "FULL SHOWS BY DAY" cards (newest 12 show-days) with FULL SHOW - AUDIO and FULL SHOW - VIDEO. Counts come from the files (Alex 4, War Room 3, Sunday 2...), never hard-coded. Chips: SPECIAL BROADCAST (Saturday), SUNDAY REGULAR LINE-UP, REGULAR SHOW.
2. Video Full Show plays hour 1..N in sequence (auto-advance, Next/Previous work). Audio uses the whole-show mp3 when it exists, otherwise chains the hour mp3s.
3. Honest gaps: a missing hour is named on the card and in the Player ("Not published as video: hour 2. This is not the complete show."); a part that fails to load is reported and the show moves on.
4. Player + Radio Now Playing show "Full show - <show> - recorded video - part 2 of 4".
5. The FULL SHOW button on each hour card now plays that day's full show (audio) instead of just that hour.
Not included: one continuous seek bar across parts (each part has its own).
Verify: npx tsx test-full-show.ts
Check by hand: Radio > FULL SHOWS BY DAY > FULL SHOW - VIDEO on an Alex weekday: part 1 of 4, then 2... Saturday shows SPECIAL BROADCAST, single file.
