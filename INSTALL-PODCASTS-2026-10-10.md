# Podcasts in Audio & Podcasts + "Must listen" highlight (2026-10-10)

## What you get
- 9 podcast rows in the Audio & Podcasts guide (after Rush / Old-Time Radio / NASA, before the music rows): **The Quash (highlighted)**, Tucker Carlson, Fox News Rundown, Bannon's War Room (podcast), Kyle Seraphin, Coast to Coast, Charlie Kirk, Ben Ferguson, Clay Travis & Buck Sexton.
- The Quash row: fuchsia gradient row, a "★ MUST LISTEN" badge and fuchsia cells (everything else stays amber).
- Audio plays DIRECT from each podcast host. Nothing is proxied. The server only reads the feed list (newest 20 episodes per show), it never streams audio.
- Feeds are read as a stream and cancelled after the newest items (Clay & Buck's feed is 85 MB; it costs about 0.2 MB of reading).
- Failures are explicit: wrong feed (title check), no playable episodes, feed HTTP error. The last good list is kept (row shows partial). A show whose newest episode is older than 14 days says "last episode <date>" under its name (The Quash: Jun 28).

## Install: replace files at the same paths (best after the Today / Full-show zips)
NEW: `server/podcasts.ts`, `src/data/podcastSources.json`, `test-podcasts.ts`
CHANGED: `guideRegistry.ts`, `src/types.ts`, `server/library.ts`, `src/EpgGuide.tsx`

### If you would rather edit by hand (your files may differ from mine)
1. `src/types.ts`: Program.sourceClass add `| 'podcast_rss'` (line ~55) and the LibraryItem `sourceClass` union add `| 'podcast_rss'` (~148); in `ScheduleChannel` add `highlight?: 'must-listen';` after `logo?`.
2. `server/library.ts` (~line 42): `p.sourceClass === 'ajn_archive' || p.sourceClass === 'ajn_rss' || p.sourceClass === 'podcast_rss' ? p.sourceClass : 'archive_org'`.
3. `guideRegistry.ts`: after `import { buildRushChannel, buildOtrChannel } from './server/audioChannels';` add `import { getPodcastChannels } from './server/podcasts';`. In the `audio-podcasts` branch replace the first line with
   `const [existing,catalog,podcasts]=await Promise.all([getAudioChannels(guideId),getArchiveItemCatalog(),getPodcastChannels(guideId,layoutDailySchedule).catch(e=>{console.error('[Podcasts]',e?.message);return [] as ScheduleChannel[];})]);`
   and in the `return [...existing,...genericChannels(guideId),` add `...podcasts,` right after `...genericChannels(guideId),`.
4. `src/EpgGuide.tsx`: see the changed file (row wrapper gets `data-highlight` + fuchsia classes, a `must-listen-badge` span before the group span, group span gets `title=`, cell className gets a `channel.highlight === 'must-listen'` branch).

## Add / change a show later
Edit `src/data/podcastSources.json` only: `enabled: true` turns on the 4 verified spares (Kuhner Report, Pat Gray, Red Eye Radio, Jeff Fisher, last episode Aug 31). Another show = a new entry with its feed URL and `expectTitle` (a word from the real show title: a feed with a different title is rejected, so a wrong link can never show up as a podcast). `highlight: "must-listen"` on any entry gives it the Quash look. `episodesPerShow` sets how many recent episodes appear.

## Verify
- `npx tsx test-podcasts.ts` -> `podcasts: all passed`
- `curl -s localhost:3000/api/schedule?guide=audio-podcasts` -> channels `pod-quash` ... each `sourceStatus` "ok"; `pod-quash` has `"highlight":"must-listen"`; every program `mediaUrl` is the podcast host's own https link (no `/api/` in it).
- In the app: Guide -> Audio & Podcasts: Quash row highlighted; click a cell and it plays; the first start can take a few seconds while the browser follows the host's redirects.

## Known limits (stated, not hidden)
- No spectrum display on podcast audio (browsers only allow it when every redirect hop sends CORS headers; untested in a browser, so it stays off). Sound plays normally.
- Buffering is the browser's own: it requests the audio in ranges itself; there is no custom chunk size. The player already preloads the next item's metadata. Seeking depends on the host answering range requests (all 9 verified: 206).
- The guide fills the day by repeating the newest episodes (same as Rush); The Quash has only 10 episodes on its feed, so they repeat through the day.
- A podcast's "on air now" cell is a scheduling slot, not a live broadcast; these are recordings.
- Podcast Index page 558053 could not be opened from here; The Quash's feed was matched through a directory listing and the feed itself (title "The Quash", author The Quash Productions, LLC). Confirm it is the show you meant.
