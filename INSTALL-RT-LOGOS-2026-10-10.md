# Channel icons: RT, RT Documentaries + new KPIX and France 24 (2026-10-10)
Files (same paths). Replaces the earlier RT-only zip: use this one.
- `public/logos/news/kpix.png`, `public/logos/news/france24.png` - your redone icons (replace the old files of the same name).
- `public/logos/news/rt.png`, `public/logos/news/rt-documentaries.png` - your two icons, cropped of white margin and resized to 128 px high.
- `src/data/newsLogos.json` - adds `rt` and `rt-documentaries` (now 13 entries).
- `guideRegistry.ts` - the RT Documentaries channel now carries its logo (also when its feed fails). Full file: it also contains the earlier live-health 3-minute recheck and the news channels, so applying it over the previous drop-ins is safe.
- `test-channel-logo.tsx` - expects 13 logos.
Verify: `curl.exe -s https://<app>/api/schedule?guide=cable-tv` shows `"logo":"/logos/news/rt.png"` on `rt` and `"logo":"/logos/news/rt-documentaries.png"` on `rt-documentaries`; the Guide's Cable TV channel column shows both icons.
