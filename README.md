Drop-in 5: restore radio presets + live-radio resume fix
Upload these 2 files at the same paths: src/App.tsx, src/components/RadioDock.tsx
Why: your Builder copies of these two files were the Oct 15 lean-source versions (byte-identical), which dropped the 5 preset buttons (RadioDock) and the live-radio "do not resume a seconds-listened position" fix (App). These are the current GitHub main versions (68bd8d5).
Verify: in the next export, `grep -c RadioPresetsBar src/components/RadioDock.tsx` is 2 and `grep -c isLiveRadioItem src/App.tsx` is 3.
