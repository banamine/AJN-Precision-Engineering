# Listen carousel drop-in (2026-11-26)
Base: your 6:50 PM export (already has fresh-first + captions-art). Copy these files over the same paths. No package.json change needed.

New: src/components/ListenCarousel.tsx, src/utils/listenDayparts.ts (+ .test.ts), test-listen-carousel.{html,tsx,mjs}
Changed: src/components/RadioView.tsx, src/components/ScheduleDeck.tsx, src/components/PodcastStage.tsx, src/radio.css (carousel CSS appended at the end)

What it does
- The Listen page's drawers (Deck, Now playing, Find & alerts, Listen back, Daily briefing, About) are now panels in one stage: arrows in side gutters, dots with labels, swipe, Left/Right keys. Page does not scroll; a panel with a long list scrolls inside itself.
- Mini bar on every panel: art/title button "Return to Player" (goes to panel 1), progress, -15s, play/pause, +30s.
- Keys (ignored while typing): Space play/pause, J -15s, L +30s, M mute.
- Gold ring on the "Find & alerts" dot when the last alert check has a non-library hit.
- Up next list: Today/Tomorrow and Morning/Afternoon/Evening/Late Night dividers (Denver time; Evening starts 18:00, Late Night 23:00, same as On Air).
- Captions on narrow screens (<520px): Auto-sync/Hide/Tap collapse behind one "Options" button.

NOT in this drop (deliberate)
- Cadence tag (Daily/Weekdays/Weekly): needs measured publish dates, not available per show yet.
- Saving the podcast position when tapping a Live Radio tile: needs a look at how Listen back stores positions first.
- Day TABS: the Up next list is a rolling clock from "now", so day labels are dividers instead.

Verify
- npx tsx src/utils/listenDayparts.test.ts  -> "listenDayparts ok"
- node test-listen-carousel.mjs            -> "listen-carousel browser test ok"
- node test-listen-alerts.mjs              -> "listen alerts browser test passed"
