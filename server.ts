import express,{Request,Response} from 'express';
import crypto from 'node:crypto';
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

app.get('/api/search',async(req,res)=>{const query=(req.query.q as string)||'';const network=(req.query.network as string)||'FOXNEWSW';const rows=Math.min(parseInt((req.query.rows as string)||'24',10)||24,50);try{const r=await searchTVNews({network,query:query.trim()||undefined,rows});res.json({query,network,total:r.total,items:r.items,safeEndDate:r.safeEndDate});}catch(e){console.error('[Search API Error]',e);res.status(500).json({error:'Search failed',items:[],total:0});}});
app.post('/api/watchdog/heartbeat',(req,res)=>res.json({acknowledged:true,ts:Date.now()}));

function validateArchivePath(raw:string){
  if(!raw||typeof raw!=='string')return{valid:false,error:'Path is required'};
  if(!raw.startsWith('/'))return{valid:false,error:'Path must begin with a forward slash (/)'};
  if(raw.startsWith('/api/archive/proxy'))return{valid:false,error:'Nested archive proxy paths are forbidden'};
  if(raw.includes('..')||raw.includes('\\'))return{valid:false,error:'Directory traversal sequences are forbidden'};
  if(/^https?:\/\//i.test(raw)||raw.includes('://'))return{valid:false,error:'Embedded schemes/hosts are forbidden'};
  let cleanPath=raw;
  const cdnMatch=raw.match(/^\/\d+\/items\/([^/?#]+)(\/.*)$/);
  if(cdnMatch) cleanPath=`/download/${cdnMatch[1]}${cdnMatch[2]}`;
  else if(!raw.startsWith('/download/'))return{valid:false,error:'Only Archive.org /download paths are permitted'};
  return{valid:true,cleanPath};
}

const ARCHIVE_BASE='https://archive.org';
const MAX_RETRIES=3;
const RETRYABLE=new Set([429,500,502,503,504]);

function mediaTypeAllowed(value:string|null):boolean{
  if(!value)return false;
  return /^(?:video|audio)\//i.test(value.trim());
}

app.get('/api/archive/proxy',async(req,res)=>{
  stats.totalRequests++;
  const proxyRequestId=crypto.randomUUID();
  const started=Date.now();
  res.setHeader('x-proxy-request-id',proxyRequestId);
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Expose-Headers','Content-Range, Content-Length, Accept-Ranges, X-Proxy-Request-Id, ETag, Last-Modified');

  const rawPath=String(req.query.path||'');
  const v=validateArchivePath(rawPath);
  if(!v.valid||!v.cleanPath){stats.failedRequests++;return res.status(400).json({error:'Invalid path parameter',details:v.error,proxyRequestId});}

  const range=typeof req.headers.range==='string'?req.headers.range:undefined;
  if(range&&!/^bytes=\d+-(?:\d*)$/.test(range.trim())){stats.failedRequests++;return res.status(416).json({error:'Unsupported Range header',proxyRequestId});}

  const upstreamUrl=`${ARCHIVE_BASE}${v.cleanPath}`;
  const headers:Record<string,string>={'User-Agent':'AJN-Precision-Engineering/1.0','Accept':'*/*'};
  if(range)headers.Range=range;

  try{
    const upstream=await fetch(upstreamUrl,{method:'GET',redirect:'follow',headers});
    stats.lastUpstreamLatencyMs=Date.now()-started;

    const contentType=upstream.headers.get('content-type');
    if(!upstream.ok||!mediaTypeAllowed(contentType)||!upstream.body){
      const bodyPreview=await upstream.text().catch(()=> '');
      stats.failedRequests++;
      console.warn('[Archive Proxy] non-media/unavailable upstream',{
        proxyRequestId,archivePath:v.cleanPath,archiveUrl:upstreamUrl,finalUrl:upstream.url,
        status:upstream.status,contentType,range,bodyPreview:bodyPreview.slice(0,300)
      });
      return res.status(upstream.status>=400?upstream.status:502).json({
        error:'Archive media unavailable or non-media upstream response',
        upstreamStatus:upstream.status,contentType,proxyRequestId
      });
    }

    for(const name of ['content-type','content-length','content-range','accept-ranges','etag','last-modified']){
      const value=upstream.headers.get(name);if(value)res.setHeader(name,value);
    }
    res.status(upstream.status);
    stats.successfulRequests++;
    stats.activeStreams++;

    const reader=upstream.body.getReader();
    let bytesForwarded=0;
    let clientClosed=false;
    const onClose=()=>{clientClosed=true;void reader.cancel().catch(()=>{});};
    res.once('close',onClose);
    try{
      while(true){
        const {done,value}=await reader.read();
        if(done||clientClosed)break;
        const chunk=Buffer.from(value);
        bytesForwarded+=chunk.length;
        if(!res.write(chunk))await new Promise<void>(resolve=>res.once('drain',resolve));
      }
    }finally{
      res.removeListener('close',onClose);
      try{await reader.cancel();}catch{}
      if(!res.writableEnded&&!res.destroyed)res.end();
      stats.activeStreams=Math.max(0,stats.activeStreams-1);
      console.log('[Archive Proxy Stream Complete]',{
        proxyRequestId,status:upstream.status,range:range||'none',
        declaredLength:upstream.headers.get('content-length')||'unknown',
        contentRange:upstream.headers.get('content-range')||'none',bytesForwarded
      });
    }
  }catch(error:any){
    stats.failedRequests++;
    console.error('[Archive Proxy] transport failure',{proxyRequestId,archivePath:v.cleanPath,archiveUrl:upstreamUrl,error:error?.message||String(error)});
    if(!res.headersSent)return res.status(502).json({error:'Archive proxy transport failure',proxyRequestId});
    if(!res.destroyed)res.destroy();
  }
});

app.get('/api/archive/metadata',async(req,res)=>{
 const v=validateArchivePath((req.query.path as string)||'');if(!v.valid||!v.cleanPath)return res.status(400).json({error:v.error});
 try{
   const r=await fetch(`${ARCHIVE_BASE}${v.cleanPath}`,{method:'HEAD',redirect:'follow',headers:{'User-Agent':'AJN-Precision-Engineering/1.0'}});
   res.json({status:r.status,ok:r.ok,contentType:r.headers.get('content-type'),contentLength:r.headers.get('content-length'),acceptRanges:r.headers.get('accept-ranges'),finalUrl:r.url,proxyUrl:`/api/archive/proxy?path=${encodeURIComponent(v.cleanPath)}`});
 }catch(e:any){res.status(502).json({error:e.message});}
});

async function startServer(){
 if(process.env.NODE_ENV!=='production'){const vite=await createViteServer({server:{middlewareMode:true},appType:'spa'});app.use(vite.middlewares);}
 else{app.use(express.static(path.join(process.cwd(),'dist')));app.get('*',(_req,res)=>res.sendFile(path.join(process.cwd(),'dist','index.html')));}
 app.listen(PORT,'0.0.0.0',()=>{console.log(`[AJN] Integrated Server running at http://0.0.0.0:${PORT}`);
   buildChannelFromSearch('collection:SciFi_Horror','archive-scifi','Sci-Fi Horror Archive')
    .then(c=>console.log(`[AJN] Built Archive channel: ${c.name} with ${c.playlist.length} assets`))
    .catch(e=>console.error('[AJN] Failed to build Archive channel:',e));
 });
}
startServer();