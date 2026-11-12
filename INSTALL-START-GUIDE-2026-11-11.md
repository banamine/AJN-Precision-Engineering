START GUIDE - drop-in (2026-11-11)
Base: feature/neural-twin 6f8577a. 7 files. Nothing else changes.

NEW   src/startGuide/startGuideCards.ts   the six goal cards (copy + destinations)
NEW   src/startGuide/startGuideState.ts   remembers "Don't open automatically"
NEW   src/startGuide/StartGuide.tsx       the guide window + the step callout
NEW   src/startGuide/startGuide.test.ts   checks every card goes to a real page
EDIT  src/App.tsx                         3 small additions (opens the guide, mounts it)
EDIT  src/components/Navigation.tsx       "?" button in the top bar (tablet/desktop) + "Start Guide" in the phone More menu

WHAT YOU WILL SEE
- First visit (no #link in the address): the guide opens by itself until you tick "Don't open automatically".
- Six cards. Each has: [Open ...] . Show me how . Explain this feature.
- Show me how: goes to the page and shows a 2-step note on the right. It only tells you what to do; it never clicks for you.
- Explain this feature: shows a short explanation inside the same window, with a "Take me there" button.
- Reopen any time: "?" button in the top bar (wide screens) or More > Start Guide (phones).

HOW TO CHECK IT (about 5 seconds, after the files are in place)
  npx tsx src/startGuide/startGuide.test.ts
Expected last line:  start-guide: ok

NOT CHANGED ON PURPOSE
package.json (your local copy has your own edits, so it is left alone). To add the test to "npm test" later, ask me.
App.tsx and Navigation.tsx are whole-file copies of 6f8577a. If either changed since, tell me before you drop this in.
