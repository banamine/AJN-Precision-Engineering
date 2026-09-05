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

const ARCHIVE_BASE='https://archive.org';
const MAX_RETRIES=3;
const BACKOFF=500;
const RETRY=[503,429,502,504];
const MAX_CHUNK=2*1024*1024;

interface ByteRange { start:number; end:number|null; }

function parseRangeHeader(header:string|undefined):ByteRange|null {
  if(!header) return null;
  const m=/^bytes=(\d+)-(\d*)$/.exec(header.trim());
  if(!m) return null;
  const start=Number(m[1]);
  if(!Number.isSafeInteger(start)||start<0) return null;
  const requestedEnd=m[2] ? Number(m[2]) : null;
  if(requestedEnd!==null && (!Number.isSafeInteger(requestedEnd)||requestedEnd<start)) return null;
  return {start,end:requestedEnd};
}

function buildUpstreamRange(range:ByteRange):string {
  const end=range.end===null ? range.start+MAX_CHUNK-1 : Math.min(range.end,range.start+MAX_CHUNK-1);
  return `bytes=${range.start}-${end}`;
}

app.get('/api/archive/proxy', async (req, res) => {
  stats.totalRequests++;
  const proxyRequestId = crypto.randomUUID();
  res.setHeader('x-proxy-request-id', proxyRequestId);

  const rawPath = String(req.query.path || '');
  const v = validateArchivePath(rawPath);
  if (!v.valid || !v.cleanPath) {
    stats.failedRequests++;
    return res.status(400).json({ error: 'Invalid path parameter', details: v.error, proxyRequestId });
  }

  const incomingRange = parseRangeHeader(typeof req.headers.range === 'string' ? req.headers.range : undefined);
  if (req.headers.range && !incomingRange) {
    stats.failedRequests++;
    return res.status(416).json({ error: 'Unsupported Range header', proxyRequestId });
  }

  const upstreamUrl = `${ARCHIVE_BASE}${v.cleanPath}`;
  const headers:Record<string,string>={
    'User-Agent':'AJN-Precision-Engineering/1.0',
    'Accept':'*/*',
    'Connection':'close',
  };
  if(incomingRange) headers.Range=buildUpstreamRange(incomingRange);

  let responseFinished=false;
  res.once('finish',()=>{responseFinished=true;});

  for(let attempt=1;attempt<=MAX_RETRIES;attempt++){
    const abortController=new AbortController();
    const onClose=()=>{ if(!responseFinished) abortController.abort(); };
    req.once('close',onClose);
    let streamCounted=false;

    try{
      const upstreamTimeout=setTimeout(()=>abortController.abort(),20000);
      let upstream:globalThis.Response;
      try{
        upstream=await fetch(upstreamUrl,{headers:headers as HeadersInit,signal:abortController.signal,redirect:'follow'});
      }finally{clearTimeout(upstreamTimeout);}

      if(RETRY.includes(upstream.status)){
        if(attempt<MAX_RETRIES){
          stats.retriedRequests++;
          await new Promise(r=>setTimeout(r,BACKOFF*Math.pow(2,attempt-1)));
          continue;
        }
        stats.failedRequests++;
        return res.status(503).json({error:'Archive upstream unavailable',upstreamStatus:upstream.status,proxyRequestId});
      }

      if(!upstream.ok && upstream.status!==206){
        stats.failedRequests++;
        return res.status(upstream.status>=500?503:upstream.status).json({error:'Archive upstream unavailable',upstreamStatus:upstream.status,proxyRequestId});
      }

      if(incomingRange && upstream.status!==206){
        stats.failedRequests++;
        return res.status(502).json({error:'Archive upstream ignored requested byte range',upstreamStatus:upstream.status,proxyRequestId});
      }

      if(!upstream.body){
        stats.failedRequests++;
        return res.status(502).json({error:'Archive upstream returned no body',proxyRequestId});
      }

      const contentType=upstream.headers.get('content-type');
      const contentLength=upstream.headers.get('content-length');
      const contentRange=upstream.headers.get('content-range');

      // A bounded range is deliberate: Archive.org can terminate open-ended
      // ranges early. Never advertise a larger body than the upstream actually
      // supplied for the bounded request.
      if (incomingRange && contentRange && contentLength) {
        const m=/^bytes=(\d+)-(\d+)\/(\d+|\*)$/i.exec(contentRange);
        const declaredLength=Number(contentLength);
        if (m && Number.isSafeInteger(declaredLength)) {
          const rangeLength=Number(m[2])-Number(m[1])+1;
          if (rangeLength !== declaredLength) {
            stats.failedRequests++;
            return res.status(502).json({error:'Archive upstream returned inconsistent range length',contentRange,contentLength,proxyRequestId});
          }
        }
      }

      res.status(upstream.status);
      res.setHeader('Access-Control-Allow-Origin','*');
      res.setHeader('Cache-Control','no-store');
      res.setHeader('Access-Control-Expose-Headers','Content-Range, Content-Length, Accept-Ranges, X-Proxy-Request-Id');
      res.setHeader('Accept-Ranges',upstream.headers.get('accept-ranges')||'bytes');
      if(contentType) res.setHeader('Content-Type',contentType);
      if(contentLength) res.setHeader('Content-Length',contentLength);
      if(contentRange) res.setHeader('Content-Range',contentRange);

      stats.successfulRequests++;
      stats.activeStreams++;
      streamCounted=true;

      const reader=upstream.body.getReader();
      let clientClosed=false;
      const onResponseClose=()=>{ if(!responseFinished){clientClosed=true;void reader.cancel();} };
      res.once('close',onResponseClose);

      try{
        while(true){
          const {done,value}=await reader.read();
          if(done||clientClosed) break;
          if(!res.write(Buffer.from(value))){
            await new Promise<void>(resolve=>res.once('drain',resolve));
          }
        }
      }finally{
        res.removeListener('close',onResponseClose);
        try{await reader.cancel();}catch{}
        if(!res.writableEnded && !res.destroyed) res.end();
        stats.activeStreams=Math.max(0,stats.activeStreams-1);
        streamCounted=false;
      }
      return;
    }catch(err:any){
      if(streamCounted) stats.activeStreams=Math.max(0,stats.activeStreams-1);
      if(abortController.signal.aborted && req.destroyed) return;
      if(attempt===MAX_RETRIES){
        stats.failedRequests++;
        if(!res.headersSent) return res.status(503).json({error:'Archive upstream unavailable',proxyRequestId});
        if(!res.destroyed) res.destroy();
        return;
      }
      stats.retriedRequests++;
      await new Promise(r=>setTimeout(r,BACKOFF*Math.pow(2,attempt-1)));
    }finally{
      req.removeListener('close',onClose);
    }
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
