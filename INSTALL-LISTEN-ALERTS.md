# Listen Alerts + caption skip bar — drop-in

Unzip over the repo root (same folder as package.json). Overwrites 4 existing files, adds the rest.

Changed files: package.json, server/podcasts.ts, server/folderArt.ts, src/components/PodcastStage.tsx, src/components/RadioView.tsx
New files: server/alertsIndex.ts(+test), src/utils/alert{Match,Rules,Skip,HitsStore}.ts(+tests), src/components/{ListenAlertsPanel,AlertSkipBar}.tsx, test-listen-alerts.{html,tsx,mjs}

## Check locally (about 1 minute)
    npm run test:alerts
Expect: four lines ending "tests passed".

## After publishing
1. Listen deck > Find & save > open "Listen alerts" (first open starts the index build).
2. Wait 2-5 minutes, then open  /api/alerts/status  — copy the `stats` block back to me (fetch times, 429/5xx counts, memory).
3. Add a rule (e.g. a topic), confirm hits appear and "Play from here" starts ~8 s before the line.
4. Play a show with a transcript: captions auto-on, "Next line", nudges and alert prev/next work; "Captions: On" hides per show.

Not included: playlist/category scope, chapter skip, On Air queue. Times are publisher "clean-show time" (ads not counted).
