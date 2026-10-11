# Drop-in 2026-10-10: signal meter + ON AIR badge, Trish Regan, Savage Nation, Long John Nebel, WNBC 1975

Unzip over the repo root (same paths). Files:
- server/audioChannels.ts  (+ buildArchiveItemChannel)
- guideRegistry.ts  (reads src/data/archiveAudioChannels.json; adds those channels + loading rows)
- server/podcasts.ts  (PodcastSource.corsVerified)
- src/data/podcastSources.json  (+ Trish Regan, Savage Nation; corsVerified on 6 shows)
- src/data/archiveAudioChannels.json  (NEW: Long John Nebel, WNBC 1975)
- src/utils/mediaRoute.ts, src/MinimalPlayer.tsx, src/components/PlayerView.tsx  (meter opt-in, one-time native fallback, ON AIR badge)
- test-podcast-meter.ts (NEW)

Verify: `npx tsc --noEmit`; `npx tsx test-podcast-meter.ts`; `npx tsx test-podcasts.ts`; `npx tsx test-audio-channels.ts`.

Behaviour
- Live meter ONLY for podcasts flagged corsVerified (Tucker, Fox, Kyle, Coast to Coast, Charlie Kirk, Trish Regan) and all Archive audio (proxy is same-origin).
- If a CORS-mode load fails (code 4) the same file is retried ONCE natively; the badge then reads "no signal meter for this source". No fake bars.
- Not meter-capable (stay native): The Quash, Bannon War Room, Ben Ferguson, Clay & Buck, Savage Nation.
- ON AIR badge shows while audio plays; second label is the real analyser state (live level / silence / no meter).
- Not changed: Tucker's reported failure (not reproducible here; see claude/ doc).
