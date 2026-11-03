# Listen deck drop-in (2026-11-03)
Unzip over the project root (same paths). Replaces 2 files, adds 4. No other file changes, no new dependencies.
- src/components/RadioPresetsBar.tsx (replace)
- src/components/RadioView.tsx (replace)
- src/components/ListenBrowser.tsx (new)
- src/utils/audioPresets.ts (new)
- src/utils/listenCatalog.ts (new)
- test-audio-presets.ts (new, optional: `npx tsx test-audio-presets.ts` -> "[audio-presets+listen-catalog] PASS")
Needs the earlier AJN_REDESIGN_ALL drop-in already applied (it provides radio.css / Navigation changes).
Check on #radio: Archive Music tab > Live concerts, search "coltrane", Save to key 2, tap key 2 plays.
