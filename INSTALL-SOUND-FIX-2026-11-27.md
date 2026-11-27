# Sound fix drop-in (2026-11-27) - superset of listen-polish-dropin

Replace these files (full files). Includes everything from listen-polish-dropin.zip and audio-pass-all-in-one.

New in this zip:
- src/use-audio-normalization.ts: new restoreMaster(): puts the shared master gain back to the listener's level whatever element is connected.
- src/MinimalPlayer.tsx: the click-free play/pause no longer can leave the master gain at 0: restored when play() fails or is aborted, when the pause timer fires, when a new element is created, on unmount, and on every "playing" event. Click-free start/stop and the fade-in are both skipped when localStorage ajn_audio_crossfade = "off" (one switch turns all of my audio additions off).
- src/utils/audioFade.ts: fades run on timers, not requestAnimationFrame (rAF stops in a background/covered tab and froze a fade at silence).
- src/components/MiniRotator.tsx: Now playing panel 148 px so "Open full player" is no longer cut off.
- test-master-gate.mjs / .html / -page.tsx: real Chrome, real audio through the real useAudioNormalization chain: proves the stuck-at-zero silence and that restoreMaster recovers it.

To isolate a sound problem in one second (no rebuild): in the browser console run
  localStorage.setItem('ajn_audio_crossfade','off'); location.reload()
and play again. Sound back = my fade/click-free code; still silent = something else (send me the channel name).
