# Fresh-first podcast order + picker art + fewer buttons — drop-in (2026-11-26)

Unzip over the repo root. Based on your 6:03 PM export. 7 files, all full finished files.

What changes
1. TV guide podcast rows (server/podcasts.ts): each show row now airs its newest episode first, then older ones in date order. No more looping newest/oldest mix.
2. Listen deck "All podcasts" 24h clock (src/utils/scheduleCatalog.ts): today's episodes from every show first, then yesterday's, then older; shows take turns inside a day. Single show pools: newest first.
3. Podcasts bank: the row of 8 quick-tune buttons under the dropdown is gone (src/components/ScheduleDeck.tsx). Music, concerts and FM keep theirs.
4. "Choose from podcasts" list: each row has the show's own feed artwork; a show with no artwork (or art that fails to load) shows its initials. (listenCatalog.ts, useListenDeck.ts, RadioPresetsBar.tsx)

Check after publishing
- TV guide > Podcasts: on a daily show (e.g. The Five) the "ON AIR NOW" block is the newest episode (Nov 26 today), older dates follow to the right.
- Listen deck > Podcasts > "All podcasts" > Tune live: first "Up next" items are today's episodes.
- Choose from podcasts: small squares at left of each row.
Local test: npx tsx src/utils/scheduleCatalog.test.ts  (expect "# pass 5  # fail 0")
