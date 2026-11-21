# Visualizer contract (audio stages)

Written 2026-11-21 after the visualizer was lost repeatedly during music-player changes.

## The three audio stages (all in `src/MinimalPlayer.tsx`, `data-testid="audio-stage"`)
| Stage | Must show |
|---|---|
| Archive Music (`archiveMusicOn`) | Coloured spectrum, album art, big title and artist, large "Up next" card from the real queue |
| Live radio (`radio:` channel) | Coloured spectrum, big station song title/artist from the station's own feed (or "No song info from this station"), "Earlier" list when the feed has one. No "Up next": live streams have no schedule |
| Other audio / podcast | Spectrum; the stage is never an empty box |

## Rules
1. One owner of the audio tap: `useAudioNormalization` creates the analyser. Stage components only READ it (`ArchiveMusicSpectrum`). Never create a second `createMediaElementSource` for an element.
2. Bars come only from `analyser.getByteFrequencyData`. No `Math.random`, no canned animation.
3. If the browser cannot read a stream the stage says so ("Meter unavailable for this stream" / "No signal from this source"). It is never silently blank.
4. Any change to the audio-stage block in `MinimalPlayer.tsx` must keep `node test-stage-visualizer-contract.mjs` green (wired into `npm test`) and be checked on the live site for all three stages (lit canvas pixels while audio plays).

## History of loss
- 2026-11-21: live radio Full player (109 Original) showed an empty stage: the general audio branch drew no spectrum and had no title. Fixed by rendering the spectrum in every non-video stage.
