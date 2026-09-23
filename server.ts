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
import watchdogRouter from './server/routes/watchdog.js';
import newsV1Router from './server/routes/newsV1.js';
import { fetchArchiveMediaWithRetry } from './server/archiveFetch.js';

const app=express(); const PORT=Number(process.env.PORT || 3000); app.use(express.json());
app.use(watchdogRouter);
app.use(newsV1Router);

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

function validateArchivePath(raw:string){
  if(!raw||typeof raw!=='string')return{valid:false,error:'Path is required'};
  if(!raw.startsWith('/'))return{valid:false,error:'Path must begin with a forward slash (/)' };
  if(raw.startsWith('/api/archive/proxy'))return{valid:false,error:'Nested archive proxy paths are forbidden'};
  // Reject only real dot segments (/../, /./, also percent-encoded). Archive
  // filenames may legitimately contain "..", e.g. "Vol...1.mp4".
  const segments=raw.split('?')[0].split('/');
  const isDotSegment=(seg:string)=>/^(\.|%2e){1,2}$/i.test(seg);
  if(segments.some(isDotSegment)||raw.includes('\\'))return{valid:false,error:'Directory traversal sequences are forbidden'};
  if(/^https?:\/\//i.test(raw)||raw.includes('://'))return{valid:false,error:'Embedded schemes/hosts are forbidden'};

  let cleanPath = raw;
  const cdnMatch = raw.match(/^\/\d+\/items\/([^/?#]+)(\/.*)$/);
  if (cdnMatch) {
    cleanPath = `/download/${cdnMatch[1]}${cdnMatch[2]}`;
  } else if (!raw.startsWith('/download/')) {
    return{valid:false,error:'Only Archive.org /download paths are permitted'};
  }
  return{valid:true,cleanPath};
}

const ARCHIVE_BASE='https://archive.org';
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


app.get('/api/archive/proxy', async (req,res)=>{
  stats.totalRequests++;
  const proxyRequestId=crypto.randomUUID();
  res.setHeader('x-proxy-request-id',proxyRequestId);
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Expose-Headers','Content-Range, Content-Length, Accept-Ranges, X-Proxy-Request-Id, ETag, Last-Modified');

  const rawPath=String(req.query.path || '');
  const v=validateArchivePath(rawPath);
  if(!v.valid || !v.cleanPath){
    stats.failedRequests++;
    return res.status(400).json({error:'Invalid path parameter',details:v.error,proxyRequestId});
  }

  try{
    const upstreamUrl=`${ARCHIVE_BASE}${v.cleanPath}`;
    const upstreamHeaders:Record<string,string>={'User-Agent':'AJN-Media-Console/ArchiveProxy','Accept':'*/*'};
    const range=String(req.headers.range || '');
    if(range) upstreamHeaders.Range=range;

    const upstreamAbort=new AbortController();
    res.on('close',()=>{ if(!res.writableFinished) upstreamAbort.abort(); });

    const upstream=await fetchArchiveMediaWithRetry(upstreamUrl,{
      headers:upstreamHeaders,
      signal:upstreamAbort.signal,
      requestId:proxyRequestId,
    });
    if(upstream.attempts>1) stats.retriedRequests++;
    const mediaResponse=upstream.response;

    if(!mediaResponse || upstream.failure){
      await mediaResponse?.body?.cancel().catch(()=>{});
      stats.failedRequests++;
      console.error('[Archive Proxy Upstream Failure]',JSON.stringify({proxyRequestId,upstreamStatus:upstream.status,stage:upstream.failure,attempts:upstream.attempts,path:v.cleanPath}));
      const error=upstream.failure==='resolve'
        ? 'Archive did not return a validated media response'
        : `Archive media returned HTTP ${upstream.status}`;
      return res.status(502).json({error,upstreamStatus:upstream.status,attempts:upstream.attempts,proxyRequestId});
    }

    const contentType=mediaResponse.headers.get('content-type');
    const contentLength=mediaResponse.headers.get('content-length');
    const contentRange=mediaResponse.headers.get('content-range');
    const acceptRanges=mediaResponse.headers.get('accept-ranges');
    if(contentType) res.setHeader('Content-Type',contentType);
    if(contentLength) res.setHeader('Content-Length',contentLength);
    if(contentRange) res.setHeader('Content-Range',contentRange);
    res.setHeader('Accept-Ranges',acceptRanges || 'bytes');
    const etag=mediaResponse.headers.get('etag');
    if(etag) res.setHeader('ETag',etag);
    const lastModified=mediaResponse.headers.get('last-modified');
    if(lastModified) res.setHeader('Last-Modified',lastModified);

    stats.successfulRequests++;
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-AJN-Archive-Proxy','stream-from-validated-storage');
    res.status(mediaResponse.status);
    if(mediaResponse.body){
      stats.activeStreams++;
      const body=Readable.fromWeb(mediaResponse.body as any);
      const done=()=>{ stats.activeStreams=Math.max(0,stats.activeStreams-1); };
      body.once('end',done);
      body.once('error',(streamErr)=>{
        done();
        if(!upstreamAbort.signal.aborted) console.error('[Archive Proxy Stream Error]',proxyRequestId,streamErr?.message);
        res.destroy();
      });
      res.once('close',()=>{ if(!body.destroyed){ body.destroy(); } });
      return body.pipe(res);
    }
    return res.end();
  }catch(err:any){
    if(err?.name==='AbortError'||res.headersSent) return;
    stats.failedRequests++;
    console.error('[Archive Proxy Redirect Failure]',proxyRequestId,err?.message || String(err));
    return res.status(502).json({
      error:'Archive proxy redirect failure',
      detail:err?.message || String(err),
      proxyRequestId
    });
  }
});
app.get('/api/archive/metadata',async(req,res)=>{ const v=validateArchivePath((req.query.path as string)||''); if(!v.valid||!v.cleanPath)return res.status(400).json({error:v.error}); try{const r=await fetch(`${ARCHIVE_BASE}${v.cleanPath}`,{method:'HEAD',headers:{'User-Agent':'AJN-Precision-Engineering-Proxy/1.0'}});res.json({status:r.status,ok:r.ok,contentType:r.headers.get('content-type'),contentLength:r.headers.get('content-length'),acceptRanges:r.headers.get('accept-ranges'),proxyUrl:`/api/archive/proxy?path=${encodeURIComponent(v.cleanPath)}`});}catch(e:any){res.status(502).json({error:e.message});} });

app.use('/api',(req,res)=>res.status(404).json({error:'Not found',path:req.originalUrl}));

async function startServer(){
 if(process.env.NODE_ENV!=='production'){const vite=await createViteServer({server:{middlewareMode:true},appType:'spa'});app.use(vite.middlewares)} else{app.use(express.static(path.join(process.cwd(),'dist')));app.get('*',(_req,res)=>res.sendFile(path.join(process.cwd(),'dist','index.html')))}
 app.listen(PORT,'0.0.0.0',()=>{console.log(`[AJN] Integrated Server running at http://0.0.0.0:${PORT}`); buildChannelFromSearch('collection:SciFi_Horror','archive-scifi','Sci-Fi Horror Archive').then(c=>console.log(`[AJN] Built Archive channel: ${c.name} with ${c.playlist.length} assets`)).catch(e=>console.error('[AJN] Failed to build Archive channel:',e)); });
}
startServer();
