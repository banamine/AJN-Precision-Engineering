import { Readable } from 'node:stream';
import crypto from 'node:crypto';
import { patchServer } from './server-patch.js';
import express,{Request,Response} from 'express';
import path from 'path';
import {createServer as createViteServer} from 'vite';
import {searchTVNews} from './channels.js';
import {buildChannelFromSearch} from './archive-discovery';
import {
 getAllGuides,getGuideById,getChannelsByGuide,getChannelById,getChannelSources,
 addChannelSource,getAllPlaylists,getPlaylistById,syncPlaylist,getScheduleForGuide
} from './guideRegistry';

const app=express(); const PORT=3000; app.use(express.json());

interface ProxyStats{totalRequests:number;successfulRequests:number;retriedRequests:number;failedRequests:number;cacheHits:number;lastUpstreamLatencyMs:number;activeStreams:number}
const stats:ProxyStats={totalRequests:0,successfulRequests:0,retriedRequests:0,failedRequests:0,cacheHits:0,lastUpstreamLatencyMs:0,activeStreams:0};

app.get('/api/health',(_req,res)=>res.json({status:'ok',service:'ajn-precision-engineering-proxy',uptime:process.uptime(),timestamp:new Date().toISOString(),stats}));
app.post('/api/health',(req,res)=>{console.log('[CLIENT ERROR]',req.body);res.json({received:true});});
app.get('/api/guides',(_req,res)=>{const guides=getAllGuides();res.json({guides,total:guides.length});});
app.get('/api/guides/:guideId',(req,res)=>{const g=getGuideById(req.params.guideId);if(!g)return res.status(404).json({error:`Guide not found: ${req.params.guideId}`});res.json(g);});
app.get('/api/channels',(req,res)=>{const guideId=req.query.guide as string|undefined;const channels=getChannelsByGuide(guideId);res.json({guideId:guideId||'all',total:channels.length,channels});});
app.get('/api/channels/:channelId',(req,res)=>{const c=getChannelById(req.params.channelId);if(!c)return res.status(404).json({error:`Channel not found: ${req.params.channelId}`});res.json(c);});
app.get('/api/channels/:channelId/sources',(req,res)=>res.json({channelId:req.params.channelId,total:getChannelSources(req.params.channelId).length,sources:getChannelSources(req.params.channelId)}));
app.post('/api/channels/:channelId/sources',(req,res)=>{const {url,protocol,priority,enabled,metadata}=req.body;if(!url||typeof url!=='string')return res.status(400).json({error:'Source URL is required'});res.status(201).json({message:'Channel source added successfully',source:addChannelSource(req.params.channelId,{url,protocol,priority,enabled,metadata})});});
app.get('/api/schedule',async(req,res)=>{const guideId=(req.query.guide as string)||'cable-tv';try{res.json({guideId,channels:await getScheduleForGuide(guideId),generatedAt:new Date().toISOString(),source:'archive.org-live'});}catch(e){console.error('[Schedule]',e);res.status(500).json({error:'Failed to generate schedule data',channels:[]});}});
app.get('/api/playlists',(_req,res)=>{const playlists=getAllPlaylists();res.json({playlists,total:playlists.length});});
app.get('/api/playlists/:playlistId',(req,res)=>{const p=getPlaylistById(req.params.playlistId);if(!p)return res.status(404).json({error:`Playlist not found: ${req.params.playlistId}`});res.json(p);});
app.post('/api/playlists/:playlistId/sync',(req,res)=>{const r=syncPlaylist(req.params.playlistId,req.body?.customM3u);if(!r.success)return res.status(400).json({error:`Failed to sync playlist ${req.params.playlistId}`,playlist:r.playlist});res.json({message:`Playlist ${req.params.playlistId} synchronized successfully`,playlist:r.playlist,ingestedCount:r.count});});

patchServer(app);

app.get('/api/search',async(req,res)=>{const query=(req.query.q as string)||'';const network=(req.query.network as string)||'FOXNEWSW';const rows=Math.min(parseInt((req.query.rows as string)||'24',10)||24,50);try{const r=await searchTVNews({network,query:query.trim()||undefined,rows});res.json({query,network,total:r.total,items:r.items,safeEndDate:r.safeEndDate});}catch(e){console.error('[Search API Error]',e);res.status(500).json({error:'Search failed',items:[],total:0});}});
app.post('/api/watchdog/heartbeat',(req,res)=>res.json({acknowledged:true,ts:Date.now()}));

function validateArchivePath(raw:string){if(!raw||typeof raw!=='string')return{valid:false,error:'Path is required'};if(!raw.startsWith('/'))return{valid:false,error:'Path must begin with a forward slash (/)'};if(raw.includes('..')||raw.includes('\\'))return{valid:false,error:'Directory traversal sequences are forbidden'};if(/^https?:\/\//i.test(raw)||raw.includes('://'))return{valid:false,error:'Embedded schemes/hosts are forbidden'};return{valid:true,cleanPath:raw};}

const ARCHIVE_BASE='https://archive.org', MAX_RETRIES=3, BACKOFF=500, RETRY=[503,429,502,504], MAX_CHUNK=2*1024*1024;

function range(h:string|undefined){if(!h)return{start:0,end:MAX_CHUNK-1};const m=/bytes=(\d+)-(\d*)/.exec(h);if(!m)return{start:0,end:MAX_CHUNK-1};const s=parseInt(m[1],10),e=m[2]?parseInt(m[2],10):s+MAX_CHUNK-1;return{start:s,end:Math.min(e,s+MAX_CHUNK-1)};}





app.get('/api/archive/proxy', async (req, res) => {
  stats.totalRequests++;
  const proxyRequestId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString();
  res.setHeader("x-proxy-request-id", proxyRequestId);

  const rawPath = String(req.query.path || "");
  const v = validateArchivePath(rawPath);
  if (!v.valid || !v.cleanPath) {
    stats.failedRequests++;
    return res.status(400).json({ error: 'Invalid path parameter', details: v.error });
  }

  const upstreamUrl = `${ARCHIVE_BASE}${v.cleanPath}`;
  const headers: Record<string, string> = { "User-Agent": "AJN-Precision-Engineering/1.0" };
  if (req.headers.range) headers.Range = req.headers.range as string;
  for (const h of ["if-range", "if-match", "if-none-match", "if-modified-since", "if-unmodified-since"]) {
    if (req.headers[h]) headers[h] = String(req.headers[h]);
  }

  let responseFinished = false;
  res.on("finish", () => {
    responseFinished = true;
  });

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const abortController = new AbortController();
    const onClose = () => {
      if (!responseFinished) abortController.abort();
    };
    req.on("close", onClose);

    try {
      const upstreamTimeout = setTimeout(() => abortController.abort(), 20000);
      let upstream;
      try {
        upstream = await fetch(upstreamUrl, {
          headers,
          signal: abortController.signal,
        });
      } finally {
        clearTimeout(upstreamTimeout);
      }

      if (!upstream.ok && upstream.status !== 206) {
        if (!RETRY.includes(upstream.status) || attempt === MAX_RETRIES) {
          stats.failedRequests++;
          res.status(upstream.status >= 500 ? 503 : upstream.status).json({
            error: "Archive upstream unavailable",
            upstreamStatus: upstream.status,
          });
          return;
        }
      } else {
        res.status(upstream.status);
        const contentType = upstream.headers.get("content-type");
        if (contentType) res.setHeader("Content-Type", contentType);
        res.setHeader("Accept-Ranges", "bytes");
        for (const h of ["content-length", "content-range", "etag", "last-modified", "cache-control"]) {
          const val = upstream.headers.get(h);
          if (val) res.setHeader(h, val);
        }

        if (!upstream.body) {
          stats.failedRequests++;
          res.status(502).json({ error: "Archive upstream returned no body" });
          return;
        }

        stats.successfulRequests++;
        stats.activeStreams++;
        const nodeStream = Readable.fromWeb(upstream.body as any);
        
        nodeStream.on("error", (err: any) => {
          console.error("[Archive Proxy Stream Error]", err);
          if (!res.headersSent) {
            res.status(502).json({ error: "Archive media stream failed" });
          }
          if (!res.destroyed) res.destroy();
        });

        res.on("error", (err: any) => {
          console.error("[Archive Proxy Response Error]", err);
        });

        res.on("close", () => {
           stats.activeStreams = Math.max(0, stats.activeStreams - 1);
        });

        nodeStream.pipe(res);
        return;
      }
    } catch (err: any) {
      if (attempt === MAX_RETRIES) {
        stats.failedRequests++;
        res.status(503).json({ error: err?.message || "Archive upstream unavailable" });
        return;
      }
    } finally {
      req.removeListener("close", onClose);
    }
    await new Promise(r => setTimeout(r, BACKOFF * Math.pow(2, attempt - 1)));
  }
});

app.get('/api/archive/metadata',async(req,res)=>{
 const v=validateArchivePath((req.query.path as string)||'');if(!v.valid||!v.cleanPath)return res.status(400).json({error:v.error});
 try{const r=await fetch(`${ARCHIVE_BASE}${v.cleanPath}`,{method:'HEAD',headers:{'User-Agent':'AJN-Precision-Engineering-Proxy/1.0'}});res.json({status:r.status,ok:r.ok,contentType:r.headers.get('content-type'),contentLength:r.headers.get('content-length'),acceptRanges:r.headers.get('accept-ranges'),proxyUrl:`/api/archive/proxy?path=${encodeURIComponent(v.cleanPath)}`});}catch(e:any){res.status(502).json({error:e.message});}
});

async function startServer(){
 if(process.env.NODE_ENV!=='production'){const vite=await createViteServer({server:{middlewareMode:true},appType:'spa'});app.use(vite.middlewares);}
 else{app.use(express.static(path.join(process.cwd(),'dist')));app.get('*',(_req,res)=>res.sendFile(path.join(process.cwd(),'dist','index.html')));}
 app.listen(PORT,'0.0.0.0',()=>{console.log(`[AJN] Integrated Server running at http://0.0.0.0:${PORT}`);
   buildChannelFromSearch('collection:SciFi_Horror','archive-scifi','Sci-Fi Horror Archive')
    .then(c=>console.log(`[AJN] Built Archive channel: ${c.name} with ${c.playlist.length} assets`))
    .catch(e=>console.error('[AJN] Failed to build Archive channel:',e));
   // IMPORTANT: News schedule is no longer converted back into M3U at startup.
 });
}
startServer();
