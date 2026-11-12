# TV caption story ledger (Face 6) - drop-in, 2026-11-12

Copy every file here to the same repo-relative path (all are NEW except src/news-cube/NewsCubePage.tsx, which is the full patched file;
the exact change is in NewsCubePage.tsx.patch). Then make these two small edits.

## 1. server.ts  (2 lines)
Next to the other route imports add:
    import { registerTvStoriesRoute } from './server/tvStoriesRoute.js';
Next to where registerTvHeadlinesRoute(app) is called add (before any catch-all / static handler):
    registerTvStoriesRoute(app);

## 2. package.json  (scripts)
    "test:tv-stories": "tsx test-tv-stories.ts"

## Not touched
server/tvHeadlines.ts, src/news-cube/TvChannelStrip.tsx, useTvHeadlines.ts (left in place; the strip is simply no longer rendered).

## Verify (you run these)
    npm run test:tv-stories          -> "10 tests passed"
    npm run dev, then:  curl -s http://localhost:3000/api/tv-stories | head -c 600
       first call: networks[] present, stories [] and window.building true
       after ~10-20 min: stories[] fill; network statuses show ok / no-text / cooldown per network
    Open the News Cube -> Face 6 shows caption excerpts labelled "Caption excerpt, not a headline."
