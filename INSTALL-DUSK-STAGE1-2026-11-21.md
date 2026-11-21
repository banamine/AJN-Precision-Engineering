# Dusk Marquee — Stages 1 + 2 + 3 + 4 drop-in (cumulative; replaces the earlier zips)
Base: export ajn-precision-engineering.zip saved 2026-11-21 04:53 Denver (128,489,593 bytes); it already contains Stages 1-3, so only the Stage 4 files are new or changed vs that export.

NEW   src/components/ajn-platform-redesign/skins/sky.ts
NEW   src/components/ajn-platform-redesign/skins/duskMarquee.css   (skin tokens, sky glow, wall styles, ticket-stub guide cells)
NEW   src/home/onAirWall.ts                                          (pure logic: pick 4, progress, next)
NEW   src/components/HomeOnAirWall.tsx                               (the "Tonight on AJN" wall)
EDIT  src/components/ajn-platform-redesign/AppearanceProvider.tsx   (skin + sky settings; useAjnSkin())
EDIT  src/components/HomeBroadcastHub.tsx                            (+1 import, +1 line: wall above the Live strip)
NEW   src/shows/showDetail.ts                                       (pure logic: seasons, filter, "Why it plays" chips)
NEW   src/components/ShowDetailPanel.tsx                             (detail panel inside an open Shows drawer)
EDIT  src/components/ShowDrawersView.tsx                             (Dusk: open drawer shows the detail panel; Current: original list, unchanged)
NEW   src/home/daypartShelves.ts                                     (Stage 4, pure: four shelves, edges)
NEW   src/components/HomeDaypartShelves.tsx                          (Stage 4: Morning / Afternoon / Primetime / Late Night rows)
NEW   src/shows/genreTiles.ts, src/components/GenreTiles.tsx         (Stage 4: genre tiles)
EDIT  src/components/WaitingNotes.tsx                                (Stage 4: Dusk gets an "Intermission" label + restyle; text, timer, status, Retry unchanged)
EDIT  src/EpgGuide.tsx                                               (+2 attributes on EpgProgramBlock: data-epg-block, data-on-air; no logic change)

Default stays Current: with Current skin the wall renders nothing and the guide looks as before.

Test (you), Appearance > Skin > Dusk Marquee:
1. Home: "Tonight on AJN" appears above Browse Live. Up to 4 video channels on air now, each with ON AIR chip, title, progress bar and "Next <time> · <title>". Nothing autoplays. Click a card: it plays from the live position, same as the Live strip's Play.
2. Audio channels never appear in the wall. If the schedule fails you get "Could not load what is on air" + Try again; if nothing is on air, "Nothing is on air right now."
3. TV Guide: cells get ticket-stub notches, the on-air cell is gold-outlined. Tab to a cell: focus ring visible.
4. Switch to Current: wall gone, guide as before.
5. Shows > open any show (e.g. Hamish Macbeth, Ch 102 British): chip row ("Range-checked <date>", episodes, hours, seasons, average length, "In the 24/7 schedule" only if true), season tabs (All / Season N, only when the show has real season numbers), episode list with S01E01 codes. Arrow keys / Home / End move between season tabs. Hover a chip to see which data field it came from. A show that failed its range check shows a rose "Not range-checked" chip instead of hiding it.
6. Current skin: Shows looks exactly as before.
7. Home, under the wall: "Around the clock" with four shelves, the one matching your clock first and tagged NOW. Cards say "On air", "Aired 9:00 AM" or the start time. On-air cards join live; others play from the start. Arrows disable at the ends. A window with nothing scheduled says so. Audio and library-only channels never appear.
8. Shows: the genre pills become gradient tiles with the real show count; clicking one filters exactly like the pill did.
9. Intermission: play something slow or throttle the network. The waiting card gets a gold border and "INTERMISSION" label; the real status line, seconds counter and Retry are the same as before. Current skin: unchanged.
Not yet built (needs real data): "Doors open" countdowns on guide cells.
Revert: restore the 3 edited files from the export; delete the 4 new files.
