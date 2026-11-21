# Dusk Marquee Stage 5: lean-back mode (cumulative; includes Stages 1-4)
Unzip over the repo root (paths are repo-relative, under src/).
New: src/leanback/leanNav.ts, src/components/LeanBackLayer.tsx
Changed: src/components/ajn-platform-redesign/AppearanceProvider.tsx, skins/duskMarquee.css

Test (Builder):
1. Appearance > Skin: Dusk. A new "Lean-back (TV)" button appears; turn it On. (Off / Current skin = app unchanged.)
2. Text is 1.35x bigger, buttons at least 64px, thick gold focus ring.
3. Arrow keys move focus to the nearest item in that direction; Enter activates; Backspace goes back/closes; Home key goes Home.
4. Press R (or the "Remote (R)" button): 16-button remote with a "Last: ..." readout. Buttons do what the keys do. On the Player page the arrows/Play/Vol/Full are the player's own keys. CH +/- work in the TV Guide.
Not done: top bar (64) and dock (80) not scaled; guide cells keep their fixed sizes; Back goes Home, not browser history.
