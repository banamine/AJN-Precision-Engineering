# AJN Copper Skin (colour layer) — drop-in, 1 file

Changes ONLY: src/components/ajn-platform-redesign/AppearanceProvider.tsx (4 lines; see AJN_SKIN_COPPER.patch).
Effect: the whole app (every page that uses the --ajn-* variables and the theme.css mapping) gets the new tokens:
base #0F1117, surface #181B24, card #20242F, border #282D3D, copper #E06D3B with DARK text #0F1117 on copper.
Contrast (computed): dark-on-copper 5.77:1, muted text on base 11.63:1, copper-on-base 5.77:1.
The Appearance panel still works; paper/white/slate palettes unchanged; the copper accent choice is now #E06D3B with dark text.

## Apply (on top of Slice A/B c40f8b50)
1. Branch. Copy the file over the repo path above.
2. `git diff --stat` must show exactly 1 file, 4 changed lines. If it shows more, the repo's copy differed from the one this was made from: stop and apply AJN_SKIN_COPPER.patch by hand (the 4 lines) instead.
3. `npx tsc --noEmit` (NODE_OPTIONS=--max-old-space-size=4096) and `npm run build` -> exit 0.
4. Look at: Discover, TV Guide, Library, Radio, Player, News, desktop + phone. Reset test: Appearance panel -> Reset returns to this new default.

## Not included (stated honestly)
Layout rework of pages to match mockups (cards, rails, hero), thumbnail/error states, radio glass deck. Colour/skin layer only.
Not run: the app's own UI tests (some may assert the old #a84e31 / #000 values; update those assertions, not the skin).
