# News Wall patch 2 (CUMULATIVE: includes patch 1) — 2026-10-06

On top of main f42dbda. Does not touch batch-1b files, package.json, ajn-ci.yml or server.ts. Install this one instead of patch 1 (if patch 1 is already in, install over it).

1. Panel input accepts a normal Rumble video page link (and embed URL / id as before).
2. Panel dropdown = CHANNELS. Picking one pastes that channel's last known link into the input and submits it.
3. `GET /api/news/resolve?url=` (always HTTP 200 with `reason`): guarded oEmbed lookup, 5 s timeout, 10 min success cache, 60/min/IP.
4. NEW: "Update channel list (paste export JSON)" box at the bottom of the News Wall. Paste the JSON from tools/export-rumble.js, press Preview (shows CHANGED / NEW / UNCHANGED / LOOKUP FAILED per channel, with old vs new video and dates), press Apply. Saved in this browser only (localStorage, try/catch); "Use built-in list" resets. Server list and saved list: newest wins.
5. Per-channel "as of" (new optional `seenAt` on items) + amber banner "N of M channels were last read more than a day ago". An import never makes untouched channels look fresher.
6. Provider contract (`src/news/contract.ts`): YouTube later = one provider file + one line in `src/news/registry.ts`.

Files (6 modified, 11 added incl. this README; no deletions):
  M server/rumble/routes.ts, src/components/RumbleNewsWall.tsx, src/rumble/{logic.test,types,wall}.ts
  A server/news/{resolve,routes}.ts, src/news/{contract,client,registry,importer,override,news.test,importer.test}.ts, src/news/providers/rumble.ts, src/components/RumbleImportBox.tsx

Install: extract over the project root, overwrite. Then
  npx tsc --noEmit        -> no output
  npm run test:rumble     -> three PASS lines: [news-importer] [news-resolver] [rumble-engine]
After publish (HOST = your site):
  curl -s "https://HOST/api/news/resolve?url=https%3A%2F%2Frumble.com%2Fv7gdv2i-the-horrifying-truth-about-lethal-injection.html"  -> "ok":true,"embedId":"v7e7i50"
Use: open a channel's /videos page in your own Chrome, run tools/export-rumble.js in the console, paste the copied JSON into the box, Preview, Apply.
Note: tools/export-rumble.js puts the PAGE id in embedId; the importer ignores it and looks up the real embed id.
