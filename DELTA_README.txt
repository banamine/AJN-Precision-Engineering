AJN delta (copy over the project, same paths, then publish).
Supersedes ajn-home-wiring_5files.zip: includes those 5 files plus the new work.

What it does
1. Home overhaul wiring (server.ts, App.tsx, AjnResourcePanel.tsx, HomeView.tsx, TvGuideView.tsx).
2. Audio guide: looped music channels now fill all 24 grid hours (guideRegistry.ts, server.ts, server/scheduleWindow.ts, src/EpgGuide.tsx sends ?tz=).
3. Genre pictures for music channels with no usable cover (public/genre-art/*.jpg, src/utils/musicGenre.ts, thumbnail.ts, Thumb.tsx, src/data/musicNoArt.json).
Tests: test-schedule-window.ts, test-music-genre.ts, test-thumbnail.ts (npx tsx <file>).

After publishing, check:
  GET /api/schedule?guide=audio-podcasts&tz=420  -> every channel has a program covering your local hour
  GET /api/home/now -> JSON with "items"
  Guide > Audio & Podcasts: no empty music rows at 1 PM; Tallis shows the classical picture.
