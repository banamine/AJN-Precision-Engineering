# AJN Comedy: new 24/7 compiled network (classic-comedy), same method as classic-westerns
Apply order: (1) Shows + Westerns drop-in (v2) first, (2) this zip. It reuses the Westerns wiring and `src/data/showEpisodes/*.json`.

1. Copy `src/`, `tools/` over the repo (new files only: classicComedyCatalog.json, classicComedyPublication.json, build-comedy-catalog.py, comedy-network.json, comedy-sources/edith377-green-acres.json).
2. From the repo root: `python apply-edits.py` (8 anchored edits + adds the `classic-comedy` network to config/classic-networks.json; idempotent).
3. Verify: `node tools/check-classic-network-publication.mjs --network classic-comedy` -> state "ok", coveredUntil 2027-01-04.
Shows in the Classic TV guide as "AJN Comedy". Not a library item: the library already has these episodes via the Shows drawers and the extra-library drop-in.

## What is in it
3,585 airings over 60 days, 15 shows, 959 episodes / 384.8 h of real Archive durations. Compiled with the repo compiler; the 168-hour no-repeat gate passed.
Lineup (station time, Los Angeles): 00-03 Green Acres | 03-05 Super Dave Osborne | 05-07 Day by Day / Jeff Foxworthy (alternate weeks) | 07-09 Home Improvement | 09-11 Still Standing | 11-13 Parker Lewis | 13-15 All in the Family | 15-17 F Troop | 17-19 Less Than Perfect | 19-21 Veronica's Closet | 21-23 For Your Love / Ned and Stacey | 23-24 Archie Bunker's Place / Malcolm in the Middle.
Lane rule from the compiler: no boundary between 01:00 and 02:59; a lane needs a show with more than lane-hours x 7 hours.

## Not included (and why)
- Love Boat, Fantasy Island, Here's Lucy, She's the Sheriff: 1-2 episodes each; they cannot fill a lane without breaking the 168 h gate. They stay library-only.
- The two 30-second @edith377 clips (pop-ins): the compiler has no interstitial support. Needs a separate feature.
- Green Acres is seasons 4-6 only (78 episodes).
- Super Dave Osborne is a stunt/variety show; swap it out if you do not want it as a comedy lane.
- Excluded for lack of usable durations: Beavis and Butt-Head, Trailer Park Boys. The Jeffersons stays on AJN Classic TV.

Publication covers 60 days: recompile before 2027-01-04: `npx tsx tools/compile-classic-network.mts --network classic-comedy --previous src/data/classicComedyPublication.json`.
Size: the publication is 4.7 MB; check Builder publish size.
Not run in a browser or full Vite build; tested with tsx on a scratch copy.
