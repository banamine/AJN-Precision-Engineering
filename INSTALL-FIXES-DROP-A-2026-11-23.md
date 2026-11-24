# Drop: library sort + count, Listen Back, leveler, caption overlap (2026-11-23)
Base: Builder export "ajn-precision-engineering-nov-22-2026-4-17-27-pm.zip". Full files; drop over the same paths. Not type-checked against the whole repo (syntax-checked only): run `npm run lint` and `npm run build`.

| File | Change |
|---|---|
| server.ts | /api/library/items now passes `sort` to queryLibrary (it was dropped, so Sort did nothing) |
| server/libraryIndex.ts | /api/library/heatmap adds `allTotal` (grouped count, same unit as the grid) |
| src/components/LibraryView.tsx | All pill uses `allTotal` (falls back to the old sum) |
| src/components/RadioPresetsBar.tsx | Podcast list (Choose from Podcasts): on narrow phones the title is no longer squeezed out by the TODAY badge (title wraps to 2 lines, badge drops below when tight). Listen Back: header reads "Listen Back · hourly archives"; the preset keys are hidden while it is open |
| src/use-audio-normalization.ts | New track starts at its kind's remembered gain (not the previous track's), quick estimate at 0.7 s, refine at 3 s; music target +2 dB over talk. New optional 4th arg `kind`. v2: music starts 6 dB under unity and glides slowly (1.5 s time constant) to its target; nothing jumps up or down |
| src/MinimalPlayer.tsx | Passes kind (music when archive music mode); the in-player caption overlay is not drawn while the podcast stage shows Live captions |
| src/onair/OnAirPage.tsx | Start button reads "Loading…" until the edition is ready (clicking it earlier did nothing) |

## Checks
1. Library: pick Name (A–Z) then Date added; the first rows must differ. `curl "<host>/api/library/items?sort=name&limit=3"` vs `?limit=3` (different order).
2. Library: the All pill number equals the "N items" under it with no filters.
3. Radio > 4 Listen Back: header says Listen Back; no empty preset row.
4. Full player, a podcast with transcript: one caption layer only.
5. Podcast to music: no loud burst then drop; music about 2 dB above talk.
Not changed: Offline pill (reads navigator.onLine only), On Air audio autoplay (browser rule), stray orange border on LIVE RADIO.
6. Phone portrait: Radio > Podcasts > Choose from: every row shows the show name; badge sits beside or below it.

## On Air blend (added v3)
| File | Change |
|---|---|
| src/onair/runOfShow.ts | Blend is 15 s (riseSec 15, podcastFadeOutSec 15); music bed starts 30 s before the end (musicInSec 30, watchdogSec 20). All pass validateParams. |
| src/onair/engine.js | Incoming source eases in (sin squared): slow start, no overshoot; the podcast is still audible while music rises. Outgoing curve unchanged. |
| src/onair/loudness.ts (+test) | New relativeTrim / outputDb; slewTrim takes an optional rate. 7 tests pass (node --test). |
| src/onair/useOnAirPlayout.ts | Music is matched to the level the listener just heard from the podcast (+1.5 dB at most), starts 3 dB under that and only moves 1.5 dB/s, so no loud burst then dip. Podcast levelling unchanged. |
Check: podcast to music on On Air: music rises under the fading podcast over ~15 s, no jump, no dip afterwards. If the first music block after a fresh page load is off, say so: the first podcast has to be measured (5 s) before music can be matched to it; before that it falls back to the old fixed target.

## v4 addition: On Air fills the page width
- src/onair/onair.css: `.screen-shell` width 960px -> 100% (max 2400px). Clean-view rules untouched.
- src/App.tsx: main container uses max-w-none on the On Air page only (other pages keep max-w-7xl).

## v5 change: On Air fits the window at 100% zoom
- src/onair/onair.css: `.screen-shell` width = min(100%, (100vh - 230px) * 16/9), min 640px, so the whole stage fits width and height without 50% zoom. Clean view untouched.
