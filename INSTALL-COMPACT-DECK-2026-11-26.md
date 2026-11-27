# Compact deck (2026-11-26, 7:51 PM request: "the pink panel wastes space, shorten it all up")
Base: your 7:38 PM export. Copy over the same paths. No package.json change.

## Changed
- src/components/SourcePrism3D.tsx: the big prism (tabs + 340px tall faces) is now ~175px in total on a phone.
  - Tabs: one row of 4 equal short keys (Live / Music / Podcasts / Back); on wider screens the full "1. LIVE RADIO" labels and the ‹ › arrows come back. Phones turn the prism by tapping a tab or swiping.
  - Faces are 128px (112px on large screens). Podcasts / Music / Listen back: badge + hint on one line, headline, one short sentence (the empty space and the footer line are gone). Live radio: header + the five presets in 3 columns on phones, one row of 5 on wider screens.
  - The pink face badge now says PODCASTS (was PODCAST VENDOR HUBS).
- src/components/ScheduleDeck.tsx: the "Spectrum · 24h schedule" title and the three control rows are now ONE wrapping row: pool drop-down + 24h Clock / Shuffle + Tune live. Spectrum strip 112px -> 96px.
- src/components/MiniRotator.tsx, src/components/DeckMiniPanels.tsx: mini box 132px -> 112px tall, tighter rows, Daily Digest shows 2 stories (bigger text) instead of 3.
## New tests
test-prism-compact.{html,tsx,mjs}: checks the prism height and that every face and tab label fits at 340px and 390px widths.

## Still to delete if you have not yet (unused leftovers): src/components/ListenCarousel.tsx, test-listen-carousel.{html,tsx,mjs}

## Verify
node test-prism-compact.mjs -> "prism compact browser test ok"
npx tsx test-listen-back.tsx -> "prism 4 faces ok"
node test-mini-panels.mjs -> "mini panels browser test ok"
