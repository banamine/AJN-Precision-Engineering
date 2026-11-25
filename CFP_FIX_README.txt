CFP fix: Citizen Free Press now advances one polite step per request (Cloud Run only gives CPU while a request is open).
Files: server/cfpNews.ts, server/cfpNews.test.ts (replace whole files).
server.ts: ONE line changes. Find:
  app.get('/api/onair/cfp-news',(_req,res)=>{const st=getCfpNews();
Replace with:
  app.get('/api/onair/cfp-news',async(_req,res)=>{const st=await getCfpNews();
