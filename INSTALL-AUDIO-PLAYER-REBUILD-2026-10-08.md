# Audio player rebuild + car/Bluetooth controls + restore (2026-10-08) — cumulative, supersedes earlier audio zips
Copy over the repo (same paths), rebuild, republish. No new dependencies.

Client: src/MinimalPlayer.tsx, src/components/PlayerChrome.tsx, src/components/PlayerView.tsx, src/components/AudioVisualizerOverlay.tsx,
        src/App.tsx, src/types.ts, src/utils/playableSrc.ts (new), src/utils/useFolderArt.ts (new)
Server: server/folderArt.ts (new), server.ts (import + registerFolderArtRoute(app); proxy untouched)
Tests : test-audio-preload-layout.mjs, test-media-session.mjs (playwright, AJN_TEST_URL=<app>), test-folder-art.ts (npx tsx)

Car test: play a track, turn the car off, turn it on, press Play on the car / steering wheel. Also try Prev/Next/seek on the head unit.
Samsung: keep the browser alive — Settings > Battery > Background usage limits > Never sleeping apps > add Chrome (or Samsung Internet);
         install the site to the home screen (Chrome menu > Add to Home screen) for the most reliable background audio.
