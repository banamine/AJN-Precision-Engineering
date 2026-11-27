# Mini panels in the deck card (2026-11-26, replaces the big carousel)
Install AFTER listen-carousel-dropin.zip (this overwrites its RadioView.tsx, ScheduleDeck.tsx and radio.css).

## Delete these 4 files (leftovers of the big carousel, now unused)
- src/components/ListenCarousel.tsx
- test-listen-carousel.html, test-listen-carousel.tsx, test-listen-carousel.mjs

## Copy over
New: src/components/MiniRotator.tsx, src/components/DeckMiniPanels.tsx, test-mini-panels.{html,tsx,mjs}
Changed: src/components/RadioView.tsx (back to the original drawers page, carousel removed), src/components/ScheduleDeck.tsx, src/radio.css (carousel CSS removed, small slide animation added)
Kept from the last drop: listenDayparts.ts (+test), PodcastStage.tsx Options button.

## What it is
One small box in the deck card, inside the schedule area under the playlist drop-down (where the 8 buttons were). One mini panel at a time; ‹ › buttons, dots, swipe, and Left/Right keys while focus is inside the box (outside it, keys do nothing, so Space and the arrows are never hijacked).
Panels: Now playing (art/initials, title, show, -15s / play-pause / +30s, time) · Up next (next 3 with Today/daypart label, tap to play) · Daily Digest (top 3 headlines, links) · Alerts (new hit count + top 3; dot gets a gold ring when there are new hits).
The old full "Up next" list is hidden (the mini panel shows the same rows and plays them).

## Not included
- Live radio panel (the radio controls are right beside it already) and Listen back panel (needs the recently-played list passed into the deck; the Listen back drawer is still on the page).
- Full captions: they stay in the full player. No caption line in the mini panel yet.
- Cadence tags, live-radio position handoff (still waiting on measured data / Listen back storage check).

## Verify
npx tsx src/utils/listenDayparts.test.ts -> "listenDayparts ok"
node test-mini-panels.mjs -> "mini panels browser test ok"
node test-listen-alerts.mjs -> "listen alerts browser test passed"
