# Drop-in 2026-10-10: Home page redo (mockup look, real data)
Replace src/components/HomeView.tsx. Hero, full-show buttons and AJN Programs row are unchanged.
New below them (2 columns on desktop, stacked on phone):
- "On Now": 4 channel cards from the real schedule (logo on dark card, VIDEO/AUDIO pill, "ON NOW" tag, current program). No "LIVE" claim.
- "Featured Highlights": image-backed cards (Archive cover via /api/archive/proxy), dark scrim for text.
- Right column: Recently Played (compact list, resume), Audio & Video Resources (links to Guide / Library / Radio / News).
Images: Archive covers for the audio items are tiny waveform thumbnails (3-6 KB) and look soft. To improve, add your own art in public/ and point MediaCard `image` at it.
Verified: tsc clean, build OK, desktop + phone screenshots rendered from the built app. test-runtime-loop-guards.mjs fails on App.tsx wording (not touched by this change).
