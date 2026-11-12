# Ledger — archive-music-list2 (List 2 "Music" ingestion)
Branch `feature/archive-music-list2` @ `7d2e204` (base `7530e0e`), isolated worktree; the `copilot-config` working tree was not touched.
Live list 2 = 155 members (the CSV baseline said 154; one item was added on Archive since). Manifest edited only by `tools/build-infobattalion-lists.py --lists 2` — no hand edits.

## Commits
```
7d2e204 data: ingest 21 new @infobattalion List 2 (Music) audio items via build-infobattalion-lists.py --lists 2
0147e40 test: list 2 is now an accepted additive selection (6 stays invalid)
9aae23a tools: allow --lists 2 (Music); additive music run writes archiveAudioChannels.json and reports Music stats
```
## Accounting (155 = 21 + 56 + 78)
| Status | Count |
|---|---|
| ADDED | 21 |
| SKIPPED-ALREADY-IN-APP | 56 |
| REJECTED | 78 |

Rejected breakdown: {'video-only': 27, 'dark/restricted': 44, "FALSE-REJECT: MP3 derivatives exist but length is 'mm:ss'": 5, 'no MP3': 2}
Not applicable in this path: the <30s / <100KB placeholder rule (the music audio path only requires a non-private MP3 with length > 0).

### ADDED
| identifier | manifest id / name |
|---|---|
| assemblage-23-light-lyrics_202609 | music-assemblage-23-light-lyrics-202609 | Random MP3 tunes |
| keedy-chase-the-clouds-1991 | music-keedy-chase-the-clouds-1991 | Keedy - Chase The Clouds (1991) Album |
| Pink-Floyd-The-Wall-1979-LP2 | music-pink-floyd-the-wall-1979-lp2 | Pink Floyd - The Wall (1979) LP2 |
| Pink-Floyd-The-Wall-1979-LP1 | music-pink-floyd-the-wall-1979-lp1 | Pink Floyd - The Wall (1979) LP1 |
| 09-twenty-four-hours | music-09-twenty-four-hours | Steamhammer - Steamhammer (Reflection) (1969) |
| SteveRayVaughan-1987FMBroadcastPA | music-steverayvaughan-1987fmbroadcastpa | Stevie Ray Vaughan SRV 1987 FM Broadcast PA |
| 01-dancing-madly-backwards-on-a-sea-of-air | music-01-dancing-madly-backwards-on-a-sea-of-air | Captain Beyond - Captain Beyond (1972) |
| 1969WoodstockComplete1 | music-1969woodstockcomplete1 | 1969 Woodstock Complete |
| JanisJoplin220508 | music-janisjoplin220508 | Janis Joplin |
| Deep-Purple-Burn-1974-Vinyl-Rip-1st-Press | music-deep-purple-burn-1974-vinyl-rip-1st-press | Deep Purple - Burn (1974) Vinyl Rip (1st Press) |
| scorpions-world-wide-live-1985-lp2-live-vinyl-rip_20200702 | music-scorpions-world-wide-live-1985-lp2-live-vinyl-rip-20200702 | Scorpions - World Wide Live (1985) (LP2) Vinyl Rip |
| Scorpions-World-Wide-Live-1985-LP1-Live-Vinyl-Rip | music-scorpions-world-wide-live-1985-lp1-live-vinyl-rip | Scorpions - World Wide Live (1985) (LP1) Vinyl Rip |
| Kieran-White-Steamhammer-Open-Door-1975 | music-kieran-white-steamhammer-open-door-1975 | Kieran White (Steamhammer) - Open Door (1975) |
| Tami-Neilson-Chickaboom-2020 | music-tami-neilson-chickaboom-2020 | Tami Neilson - Chickaboom (2020) |
| Captain-Beyond-Sufficiently-Breathless-1973 | music-captain-beyond-sufficiently-breathless-1973 | Captain Beyond - Sufficiently Breathless (1973) |
| Lord-Sutch-and-Heavy-Friends-Lord-Sutch-and-Heavy-Friends-1970 | music-lord-sutch-and-heavy-friends-lord-sutch-and-heavy-friends-19 | Lord Sutch and Heavy Friends - Lord Sutch and Heavy Friends |
| John-Lennon-Mind-Games-1973-Vinyl-Rip | music-john-lennon-mind-games-1973-vinyl-rip | John Lennon - Mind Games (1973) Vinyl Rip |
| pavlovs-dog-pampered-menial-1975-vinyl-rip | music-pavlovs-dog-pampered-menial-1975-vinyl-rip | Pavlov's Dog - Pampered Menial (1975) Vinyl Rip |
| JadeWarrior-Released-1972 | music-jadewarrior-released-1972 | Jade Warrior - Released (1972) |
| Andrew-Lloyd-Webber-Jesus-Christ-Superstar-1970-LP2 | music-andrew-lloyd-webber-jesus-christ-superstar-1970-lp2 | Andrew Lloyd Webber - Jesus Christ Superstar (1970) LP2 |
| Andrew-Lloyd-Webber-Jesus-Christ-Superstar-1970-LP1 | music-andrew-lloyd-webber-jesus-christ-superstar-1970-lp1 | Andrew Lloyd Webber - Jesus Christ Superstar (1970) LP1 |

### REJECTED
| identifier | title | reason |
|---|---|---|
| billy-idol-greatest-hits-full-album-best-of-billy-idol |  | video-only (no MP3) |
| olivia-newton-john-twist-of-fate |  | video-only (no MP3) |
| yes-classic-video-hits-1977-1991 |  | video-only (no MP3) |
| Sex_Pistols_The_Great_Rock_and_Roll_Swindle_1978_Film |  | video-only (no MP3) |
| aldo-nova-ball-and-chain-mtv-2 |  | video-only (no MP3) |
| the-johnny-cash-show-part-one.mp-4 |  | dark/restricted |
| hard-rock-heavy-metal-pop-rock-soft-rock-def-leppard-discograp |  | dark/restricted |
| rush-live-albums |  | dark/restricted |
| lady-antebellum-discography-2008-2021 |  | dark/restricted |
| hard-rock-blues-rock-southern-rock-rockn-roll-classic-rock-ted |  | dark/restricted |
| hard-rock-blues-rock-cd-aerosmith-discography-1973-2015-77-100 |  | FALSE-REJECT: MP3 derivatives exist but length is 'mm:ss' (float() parse bug in build-organizer-manifest.py Meta.get) |
| hard-rock-deep-purple-345-517-cd-1968-2017-mp-3-128-320-kbps-r |  | dark/restricted |
| classic-rock-hard-rock-van-halen-discography-1978-2016-20-albu |  | dark/restricted |
| 03.-graveyard-train |  | dark/restricted |
| Yes-Discography |  | dark/restricted |
| hard-rock-classic-rock-deep-purple-discography-196-cd-3-web-19 |  | dark/restricted |
| lp_superstars-of-the-70s_various-alice-cooper-allman-brothers- |  | no MP3 (other audio only) |
| best-of-outlaw-country |  | dark/restricted |
| rock-monsters |  | dark/restricted |
| monsters-of-rock-vol.2 |  | dark/restricted |
| 100-hits-more-80s-2009 |  | dark/restricted |
| k-tel-starburst-vol.2 |  | dark/restricted |
| k-tel-starburst-album-vol.1 |  | dark/restricted |
| the-definitive-collection-cd-rip |  | dark/restricted |
| 10015of10 |  | dark/restricted |
| 1001viofx |  | dark/restricted |
| ultimate-eurovision-party-2008 |  | dark/restricted |
| instrumental-collection.-familiar-melodias-1970-2020 |  | dark/restricted |
| music-love-romantic-sound-mix-2021 |  | dark/restricted |
| dance-90-100-best-hits-2016 |  | dark/restricted |
| disco-classics-2021 |  | dark/restricted |
| youtube-8qxgb-JuyO0 |  | video-only (no MP3) |
| simpy_red-picture_book-vinyl-1985 |  | dark/restricted |
| disco-legends-2014_202205 |  | dark/restricted |
| va-second-chance-hits-a-butterboy-compilation |  | dark/restricted |
| 100-hits-rock-jukebox-2016 |  | dark/restricted |
| acdc-songs-compilation |  | dark/restricted |
| 05-let-there-be-rock-live |  | dark/restricted |
| america-hits-2021 |  | dark/restricted |
| boz-scaggs_20220326_1100 |  | dark/restricted |
| the-short-20th-century-every-number-2-hit-1914-1991-plus-2-bon |  | dark/restricted |
| history-of-rock |  | dark/restricted |
| music-of-the-millennium-1999 |  | dark/restricted |
| kings-of-leon-come-around-sundown-2010_202305 |  | dark/restricted |
| dido-life-for-rent-2003 |  | dark/restricted |
| 13-i-want-your-love_202412 |  | dark/restricted |
| 14-disco-inferno |  | dark/restricted |
| judas-priest-battle-cry-live-dvd-rip |  | video-only (no MP3) |
| iron-maiden-rock-in-rio-2019-full-show-hd |  | video-only (no MP3) |
| 30FatherMotherSon |  | dark/restricted |
| amy-grant-house-of-love |  | dark/restricted |
| italo-disco-hits-101-150 |  | dark/restricted |
| retro-remix-vol.1-2-2022 |  | dark/restricted |
| tina-turner-whats-love-1994 |  | video-only (no MP3) |
| tina-one-last-time-live-2000 |  | video-only (no MP3) |
| sharing-the-night-together |  | video-only (no MP3) |
| power-to-the-people |  | video-only (no MP3) |
| 02-shoot-to-thrill_202303 |  | dark/restricted |
| do-they-know-its-christmas-1984-vhs-1080p-60 |  | video-only (no MP3) |
| music-videos-MTV-00s |  | video-only (no MP3) |
| TheWho-LiveAtTheIsleOfWightFestival-Film-1970 |  | video-only (no MP3) |
| sade-live-concert-1993 |  | video-only (no MP3) |
| the-big-4_202303 |  | video-only (no MP3) |
| acdc-live-at-donington-1991 |  | video-only (no MP3) |
| classic-albums-stevie-wonder-songs-in-the-key-of-life-1976-199 |  | video-only (no MP3) |
| queen-news-of-the-world-tour-1977 |  | video-only (no MP3) |
| rush-chronicles-the-video-collection |  | video-only (no MP3) |
| alan-parsons-live-in-madrid-2004-complete-concert |  | video-only (no MP3) |
| deep-purple-new-live-rare-the-video-collection-1984-2000 |  | video-only (no MP3) |
| UB2008-05-10 |  | FALSE-REJECT: MP3 derivatives exist but length is 'mm:ss' (float() parse bug in build-organizer-manifest.py Meta.get) |
| love-disco-the-collection-vol-1-cd-2 |  | FALSE-REJECT: MP3 derivatives exist but length is 'mm:ss' (float() parse bug in build-organizer-manifest.py Meta.get) |
| just-a-bunch-of-old-tunes |  | video-only (no MP3) |
| MARY_J_BLIGE_Family_Affair_2001 |  | video-only (no MP3) |
| pink-floyd-echoes-ai.-generated-music-video |  | video-only (no MP3) |
| PinkFloydLive |  | video-only (no MP3) |
| PinkFloyd_WelcometotheMachine_NY_2jul77 |  | no MP3 (other audio only) |
| 2-03-echoes |  | FALSE-REJECT: MP3 derivatives exist but length is 'mm:ss' (float() parse bug in build-organizer-manifest.py Meta.get) |
| ncn-dark-side-variations-deluxe-50th-anniversary-special-hq-ve |  | FALSE-REJECT: MP3 derivatives exist but length is 'mm:ss' (float() parse bug in build-organizer-manifest.py Meta.get) |

### SKIPPED-ALREADY-IN-APP (56)
SlowRock_201707, doja-cat-paint-the-town-red-official-video_202411, 06.-tunnel-13, cafe-del-mar-the-best-of-cafe-del-mar, progressive-art-rock-frank-zappa-the-mothers-of-invention-full-discography-1963-, power-play, all-star-country, dancemania-speed-collection-dance-dance-revolution-songs, romantic-collection-best-erotic-songs-2010, ultimate-chillout-dreams-2018_202207, smooth-jazz-chill-groove-o-perfect-vibes-for-any-mood, BobJamesnEarlKlugh1on1sideA, new-york-night-jazz-smooth-saxophone-jazz-music-soft-background-music-for-deep-sleep-relax, best-of-smooth-trumpet-jazz-smooth-jazz-trumpet-jazz, fourplay-2010-sumida-triphony-hall-tokyo-nhk, bruce-cockburn-1980-my-fathers-place-ny-wlir, grateful-dead-june-1976-boston-music-hall-wbcn, america-4th-of-july-1978-universal-amphitheatre-kwst, eagles-the-summit-houston-tx-1976-k101, james-taylor-montreux-jazz-fest-1988-rsr, jan-akkerman-montreux-jazz-festival-1978, moody-blues-1991-wbcn-whisky-a-go-go-l.a., audioslave-montreux-jazz-festival-2005-drs-3, dexter-gordon-1987-round-midnight-band-montreux, santana-mc-laughlin-2016-montreux-jazz-rsi, rockpalast-al-jarreau-david-sanborn-1985, weather-report-1976-montreux-jazz-festival-rts, saxappeal-vol.-1-2-2019-2022, the-dream-dance-2021, spacesynth-slowmegamix-1-4-2022, legends-of-disco-80s-2022, the-most-relaxing-new-age-music-2018, oxigen-music-new-age-ambience-2016, everybody-clap-disco-party-vol.04, 80-90-, 09.-most-beautiful-soft-rock-love-songs-80s-90s-soft-rock-ballads-70s-80s-90s-ol, w-2-d-1-15-22, 18-hold-back, 1a-tallis-scholars-russian-orthodox-music-05-anonymous-medieval-motets-y-vsyu-kr_202504, edm-rave-dance-2019-top-100-hits-psy-goa-trance-house-dubstep-bass-trap-techno, america-sigma-studios-1972-philadelphia-pa-wmmr, steve-miller-band-kbfh-beacon-theater-nyc-75, HGMT2, beautiful-vocal-trance-progressive-2020, martin-in-the-mix-vocal-trance-nation-61-87, lp_hit-movie-themes_enoch-light-and-the-light-brigade, house_music_sets_-_ep_16, chicane-live-at-palladium-22-01-2000, scott-muni-wnew-fm-new-york-city-11.05.70, electric-light-orchestra-winterland-sf-1976-ksan, zztopeliminatorcdrearartwork, tom-jones-hammersmith-odeon-london-1991-bbc, take-it-from-here_202605, billy-idol-1987-shoreline-amphitheatre-mtn-view, pink-floyd-grand-canal-venice-italy-7.15.89-rai, journeys-debut-nye-73-winterland-sf-ksan-fm

## Verification (verbatim)
### git diff --stat src/data/archiveAudioChannels.json
```
 src/data/archiveAudioChannels.json | 189 +++++++++++++++++++++++++++++++++++++
 1 file changed, 189 insertions(+)
```
### git diff --stat 7530e0e HEAD (all committed changes)
```
 src/data/archiveAudioChannels.json  | 189 ++++++++++++++++++++++++++++++++++++
 tests/test_infobattalion_builder.py |   4 +-
 tools/build-infobattalion-lists.py  |  18 +++-
 3 files changed, 205 insertions(+), 6 deletions(-)
```
manifest: 28544 bytes, sha256 0f7820c523ef8ae9e410ef2dec2475eb44329b2ae9dafd6a5746a6f999b93522

### python3 -m unittest tests.test_infobattalion_builder  (exit 0)
```
Ran 35 tests in 4.293s
OK
```
### python3 tools/test_concert_library.py  (exit 0)
```
paris-portland is disabled in config (fail-closed). Run --discover, or set sources.paris-portland.enabled=true.
...............
----------------------------------------------------------------------
Ran 15 tests in 0.009s

OK
```
### npx tsx test-archive-music-title.ts  (exit 0)
```
Archive music title and mode tests passed; 2303 live-radio and 16 podcast IDs excluded.
```
### npm run build  (exit 0)
```
dist/assets/index-DoyEtjOV.js                 3,182.89 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 18.53s

  dist/server.cjs      35.1mb ⚠️
  dist/server.cjs.map  50.4mb

⚡ Done in 2024ms
```
## Known issues (not fixed in this pass)
1. **False rejects (5 items, ~4,600 min)**: `tools/build-organizer-manifest.py` `Meta.get` does `float(length)`; Archive reports MP3 derivatives of FLAC uploads as `mm:ss`, so length becomes 0 and `mp3_ok` fails. Affected: 2-03-echoes, UB2008-05-10, hard-rock-blues-rock-cd-aerosmith-discography-1973-2015-77-1, love-disco-the-collection-vol-1-cd-2, ncn-dark-side-variations-deluxe-50th-anniversary-special-hq-. Shared loader, so any fix needs a check of other builders' outputs.
2. `assemblage-23-light-lyrics_202609` was named "Random MP3 tunes" (Archive's own title).
3. Additive run overwrites tracked `reports/infobattalion-lists.json` with a music-only report; it was reverted and saved in the zip as `run-report-music-list2.json`.
4. 27 video-only items rejected (not routed anywhere, per instructions) — see rejected table; deferred to the Music Videos pass.
