START GUIDE (complete, with screenshots) - 2026-11-15
Plain zip of finished full files at project-root paths. Based on your current AI Studio export.

SAME AS LIVE (already contain the guide wiring, included so the set is complete)
  src/App.tsx
  src/components/Navigation.tsx
  src/startGuide/startGuideState.ts

CHANGED (adds a screenshot to each "Explain this feature" view)
  src/startGuide/startGuideCards.ts
  src/startGuide/StartGuide.tsx
  src/startGuide/startGuide.test.ts

NEW
  public/start-guide/01-watch.png ... 06-radio-schedule.png

CHECK:  npx tsx src/startGuide/startGuide.test.ts   (last line: start-guide: ok)
If a screenshot is missing or fails to load, the picture just disappears; the view looks as before.
