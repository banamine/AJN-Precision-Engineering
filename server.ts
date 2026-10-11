import { buildDiscoveryChannel, DISCOVERY_GUIDE_ID } from './server/discoveryChannels';
import { LIBRARY_CATEGORIES, loadLibrarySnapshot, setGuideRecords, recordsFromGuide, queryLibrary, getLibrarySeries, libraryHeatmap, libraryIndexStats, startLibraryBackground } from './server/libraryIndex';
import { toM3u, toXmltv, type ExportSnapshot } from './server/channelExport';
import { pickOnNow, type HomeNowItem } from './server/homeNow';
import { localHourAt } from './server/scheduleWindow';
import { LIBRARY_SOURCES, libraryFromChannels } from './server/library';
import { liveTvHealthSummary, getAudioLoopRows } from './guideRegistry';
import { isKnownEnclosure, resolveEnclosure } from './server/podcasts';
import { plutoEpgStats } from './server/sources/plutoEpg';
import { safeFetch, readTextCapped, SafeFetchError, PLAYLIST_MAX_BYTES } from './server/safeFetch';
import { proxySliceRange } from './server/proxyRange';
import { getDigestState } from './server/newsDigest';
import { unplayableReason } from './server/sources/archiveLinks';
import { Readable } from 'node:stream';
import { gzip as gzipCb } from 'node:zlib';
import { promisify } from 'node:util';
const gzipAsync=promisify(gzipCb);
import crypto from 'node:crypto';
import fs from 'node:fs';
import { patchServer } from './server-patch.js';
import { getRushIndex, rushEpisodesOn, resolveRushItem, rushStats, nextRushDate } from './server/rush';
import { hlsProxyAllowed, rewritePlaylist } from './server/hlsPlaylistProxy';
import express,{Request,Response} from 'express';
import path from 'path';
import {createServer as createViteServer} from 'vite';
import {searchTVNews} from './channels.js';
import {buildChannelFromSearch} from './archive-discovery';
import {
 getAllGuides,getGuideById,getChannelsByGuide,getChannelById,getChannelSources,refreshMoviesClassicsFromArchive,
 addChannelSource,getAllPlaylists,getPlaylistById,syncPlaylist,getScheduleForGuide,getNewsVersion
} from './guideRegistry';
import watchdogRouter from './server/routes/watchdog.js';
import { fetchArchiveMediaWithRetry } from './server/archiveFetch.js';
import { registerSourceRoutes } from './server/sources/routes.js';
import { registerRumbleRoutes } from './server/rumble/routes.js';
import { registerFolderArtRoute } from './server/folderArt.js';
import { registerSyncPlaceholder } from './server/routes/syncPlaceholder.js';

const app=express(); const PORT=Number(process.env.PORT || 3000); app.use(express.json());
app.use(watchdogRouter);

interface ProxyStats{totalRequests:number;successfulRequests:number;retriedRequests:number;failedRequests:number;cacheHits:number;lastUpstreamLatencyMs:number;activeStreams:number}
const stats:ProxyStats={totalRequests:0,successfulRequests:0,retriedRequests:0,failedRequests:0,cacheHits:0,lastUpstreamLatencyMs:0,activeStreams:0};

app.get('/api/health',(_req,res)=>res.json({status:'ok',service:'ajn-precision-engineering-proxy',uptime:process.uptime(),timestamp:new Date().toISOString(),stats}));
app.post('/api/health',(req,res)=>{console.log('[CLIENT ERROR]',req.body);res.json({received:true});});
registerSyncPlaceholder(app); // placeholder cloud-sync endpoint (stores nothing)
app.get('/api/guides',(_req,res)=>{const guides=getAllGuides();res.json({guides,total:guides.length});});
app.get('/api/guides/:guideId',(req,res)=>{const g=getGuideById(req.params.guideId);if(!g)return res.status(404).json({error:`Guide not found: ${req.params.guideId}`});res.json(g);});
app.get('/api/channels',(req,res)=>{const guideId=req.query.guide as string|undefined;const channels=getChannelsByGuide(guideId);res.json({guideId:guideId||'all',total:channels.length,channels});});
app.get('/api/channels/:channelId',(req,res)=>{const c=getChannelById(req.params.channelId);if(!c)return res.status(404).json({error:`Channel not found: ${req.params.channelId}`});res.json(c);});
app.get('/api/channels/:channelId/sources',(req,res)=>res.json({channelId:req.params.channelId,total:getChannelSources(req.params.channelId).length,sources:getChannelSources(req.params.channelId)}));
app.post('/api/channels/:channelId/sources',(req,res)=>{const {url,protocol,priority,enabled,metadata}=req.body;if(!url||typeof url!=='string')return res.status(400).json({error:'Source URL is required'});res.status(201).json({message:'Channel source added successfully',source:addChannelSource(req.params.channelId,{url,protocol,priority,enabled,metadata})});});
app.get('/api/live/health',(_req,res)=>{res.set('Cache-Control','no-store');res.json({...liveTvHealthSummary(),plutoEpg:plutoEpgStats});});
// One cached snapshot per guide (10 min) feeds the Library and the M3U/XMLTV
// exports, so both files of a channel describe the same lineup.
const EXPORT_TTL_MS=10*60_000;
const exportSnaps=new Map<string,{at:number;p:Promise<ExportSnapshot>}>();
function guideSnapshot(guideId:string):Promise<ExportSnapshot>{
  const hit=exportSnaps.get(guideId);
  if(hit&&Date.now()-hit.at<EXPORT_TTL_MS)return hit.p;
  const p=getScheduleForGuide(guideId).then(channels=>({guideId,generatedAt:new Date().toISOString(),channels}));
  exportSnaps.set(guideId,{at:Date.now(),p});
  p.catch(()=>{if(exportSnaps.get(guideId)?.p===p)exportSnaps.delete(guideId);});
  return p;
}
const EXPORT_GUIDES=['cable-tv','classic-tv','live-tv','audio-podcasts','movies-classics-vault','science-documentaries','old-british-tv'];
// Home carousel: ONE airing program per genre guide, read from the cached guide snapshots (no extra Archive traffic).
// A guide whose snapshot is not ready within 3.5 s is reported in "pending" instead of blocking the page or being faked.
const HOME_NOW_GUIDES=['cable-tv','classic-tv','movies-classics-vault','science-documentaries','audio-podcasts','old-british-tv'];
app.get('/api/home/now',async(_req,res)=>{
  const nowMs=Date.now();
  const names=new Map(getAllGuides().map(g=>[g.id,g.name]));
  const items:HomeNowItem[]=[];const pending:string[]=[];const failed:string[]=[];
  await Promise.all(HOME_NOW_GUIDES.map(async id=>{
    try{
      const snap=await Promise.race([guideSnapshot(id),new Promise<null>(r=>setTimeout(()=>r(null),3500))]);
      if(!snap){pending.push(id);return;}
      const it=pickOnNow(id,names.get(id)||id,snap.channels,nowMs);if(it)items.push(it);
    }catch(e:any){console.warn('[HomeNow]',id,e?.message);failed.push(id);}
  }));
  items.sort((a,b)=>HOME_NOW_GUIDES.indexOf(a.guideId)-HOME_NOW_GUIDES.indexOf(b.guideId));
  const ends=items.map(i=>Date.parse(i.endTimeUtc)).filter(Number.isFinite);
  res.set('Cache-Control','no-store').json({generatedAt:new Date(nowMs).toISOString(),items,pending,failed,nextChangeAt:ends.length?new Date(Math.min(...ends)).toISOString():null});
});
const originOf=(req:any)=>`${(req.headers['x-forwarded-proto']||req.protocol||'https').toString().split(',')[0]}://${req.get('host')}`;
let libraryCache:{at:number;items:any[];generatedAt:string}|null=null;
// Library index: packaged snapshot (search categories) + guide categories, paged.
async function refreshLibraryGuideCategories(){
  for(const c of LIBRARY_CATEGORIES.filter(c=>c.guide)){
    try{setGuideRecords(c.id,recordsFromGuide(c,(await guideSnapshot(c.guide!.guideId)).channels));}catch(e:any){console.warn('[Library index]',c.id,e?.message);}
  }
}
let libraryGuideAt=0;
async function libraryReady(){await loadLibrarySnapshot();if(Date.now()-libraryGuideAt>EXPORT_TTL_MS){libraryGuideAt=Date.now();const p=refreshLibraryGuideCategories();if(libraryIndexStats.guideItems===0)await p;else void p.catch((e:any)=>console.warn('[Library refresh]',e?.message));}}
app.get('/api/library/items',async(req,res)=>{
  try{await libraryReady();const d=req.query.decade;
    res.set('Cache-Control','no-store').json(queryLibrary({ids:req.query.ids?String(req.query.ids).split(',').filter(Boolean).slice(0,500):undefined,category:(req.query.category as string)||undefined,decade:d===undefined||d===''?null:Number(d),q:req.query.q as string,mediaType:req.query.mediaType as string,page:Number(req.query.page)||1,limit:Number(req.query.limit)||24}));
  }catch(e:any){res.status(500).json({error:'library unavailable',detail:e?.message,items:[]});}
});
app.get('/api/library/series/:key',async(req,res)=>{
  try{
    await libraryReady();
    const key=decodeURIComponent(req.params.key);
    const series=getLibrarySeries(key);
    if(!series)return res.status(404).json({error:'series not found'});
    res.set('Cache-Control','no-store').json(series);
  }catch(e:any){res.status(500).json({error:'series unavailable',detail:e?.message});}
});
app.get('/api/library/heatmap',async(_req,res)=>{try{await libraryReady();res.set('Cache-Control','no-store').json({...libraryHeatmap(),stats:libraryIndexStats});}catch(e:any){res.status(500).json({error:'library unavailable',detail:e?.message,categories:[]});}});
app.get('/api/library',async(_req,res)=>{
  try{
    if(!libraryCache||Date.now()-libraryCache.at>EXPORT_TTL_MS){
      const groups=[];
      for(const s of LIBRARY_SOURCES){try{groups.push({...s,channels:(await guideSnapshot(s.guideId)).channels});}catch(e:any){console.warn('[Library]',s.guideId,e?.message);}}
      libraryCache={at:Date.now(),items:libraryFromChannels(groups),generatedAt:new Date().toISOString()};
    }
    res.set('Cache-Control','no-store');
    res.json({generatedAt:libraryCache.generatedAt,count:libraryCache.items.length,items:libraryCache.items});
  }catch(e:any){res.status(500).json({error:'library unavailable',detail:e?.message,items:[]});}
});
app.get('/api/exports',async(req,res)=>{
  const origin=originOf(req);const out:any[]=[];
  for(const g of EXPORT_GUIDES){if(g==='live-tv'){out.push({guideId:g,channel:'(all live channels)',playlist:`${origin}/api/guides/${g}/playlist.m3u`,epg:`${origin}/api/guides/${g}/epg.xml`});continue;}
    try{for(const c of (await guideSnapshot(g)).channels)out.push({guideId:g,id:c.id,name:c.name,playlist:`${origin}/api/channels/${encodeURIComponent(c.id)}/playlist.m3u?guide=${g}`,epg:`${origin}/api/channels/${encodeURIComponent(c.id)}/epg.xml?guide=${g}`});}catch{}}
  res.json({channels:out});
});
async function findChannelGuide(id:string,guide?:string):Promise<ExportSnapshot|null>{
  for(const g of guide?[guide]:EXPORT_GUIDES.filter(x=>x!=='live-tv')){if(!EXPORT_GUIDES.includes(g))continue;const s=await guideSnapshot(g);if(s.channels.some(c=>c.id===id))return s;}
  return null;
}
app.get('/api/channels/:id/playlist.m3u',async(req,res)=>{const s=await findChannelGuide(req.params.id,req.query.guide as string|undefined);if(!s)return res.status(404).json({error:'unknown channel'});res.type('audio/x-mpegurl').set('X-AJN-Generated-At',s.generatedAt).send(toM3u(s,[req.params.id],originOf(req)));});
app.get('/api/channels/:id/epg.xml',async(req,res)=>{const s=await findChannelGuide(req.params.id,req.query.guide as string|undefined);if(!s)return res.status(404).json({error:'unknown channel'});res.type('application/xml').set('X-AJN-Generated-At',s.generatedAt).send(toXmltv(s,[req.params.id]));});
app.get('/api/guides/:guide/playlist.m3u',async(req,res)=>{if(!EXPORT_GUIDES.includes(req.params.guide))return res.status(404).json({error:'unknown guide'});const s=await guideSnapshot(req.params.guide);res.type('audio/x-mpegurl').set('X-AJN-Generated-At',s.generatedAt).send(toM3u(s,null,originOf(req)));});
app.get('/api/guides/:guide/epg.xml',async(req,res)=>{if(!EXPORT_GUIDES.includes(req.params.guide))return res.status(404).json({error:'unknown guide'});const s=await guideSnapshot(req.params.guide);res.type('application/xml').set('X-AJN-Generated-At',s.generatedAt).send(toXmltv(s,null));});
const SCHEDULE_TTL_MS=60_000;
const scheduleCache=new Map<string,{at:number;p:ReturnType<typeof getScheduleForGuide>}>();
function cachedSchedule(guideId:string,movieNow?:Date){
  if(process.env.NODE_ENV==='test'||movieNow)return getScheduleForGuide(guideId,movieNow);
  const hit=scheduleCache.get(guideId);
  if(hit&&Date.now()-hit.at<SCHEDULE_TTL_MS)return hit.p;
  const p=getScheduleForGuide(guideId);
  scheduleCache.set(guideId,{at:Date.now(),p});
  p.catch(()=>{if(scheduleCache.get(guideId)?.p===p)scheduleCache.delete(guideId);});
  return p;
}
app.get('/api/schedule',async(req,res)=>{
 res.set('Cache-Control','no-store');
 const guideId=(req.query.guide as string)||'cable-tv';
 // Date injection is a Movies-only test hook, never a production clock override.
 let movieNow:Date|undefined;
 if(process.env.NODE_ENV==='test'&&(guideId==='movies-classics-vault'||guideId==='old-british-tv')&&req.query.now!==undefined){
  const value=req.query.now;
  if(typeof value!=='string'||! /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value)){
   return res.status(400).json({error:'now must be a UTC ISO date at or after 2026-01-01',channels:[]});
  }
  movieNow=new Date(value);
  if(!Number.isFinite(movieNow.getTime())||movieNow.getTime()<Date.UTC(2026,0,1)){
   return res.status(400).json({error:'now must be a UTC ISO date at or after 2026-01-01',channels:[]});
  }
 }
 try{
  // The Classic guide is ~15 MB of JSON; Cloud Run does not compress, so gzip here (browsers always send Accept-Encoding: gzip).
  // Optional ?channel=<id>: only that channel (the player needs just its own list to pick the next program; the whole guide can be tens of MB).
  const only=typeof req.query.channel==='string'&&req.query.channel?req.query.channel:null;
  let all=await cachedSchedule(guideId,movieNow);
  // Audio guide: ?tz=<Date#getTimezoneOffset()> asks for the looped music channels' rows around the viewer's local hour (full-day loop, bounded).
  // Without it the response is unchanged (first rows only), which is what the budget test, exports and other callers see.
  const lh=guideId==='audio-podcasts'?localHourAt(Date.now(),req.query.tz):null;
  if(lh!==null)all=all.map(c=>{const rows=getAudioLoopRows(c.id,lh);return rows?{...c,programs:rows}:c;});
  const body=JSON.stringify({guideId,channels:only?all.filter(c=>c.id===only):all,generatedAt:new Date().toISOString(),source:'archive.org-live'});
  res.set('Vary','Accept-Encoding').type('application/json');
  if(/\bgzip\b/i.test(String(req.headers['accept-encoding']??'')))return res.set('Content-Encoding','gzip').send(await gzipAsync(body,{level:5}));
  // Cloud Run drops any HTTP/1 response above 32 MiB with an opaque 5xx. Some proxies (e.g. the AI Studio preview) strip Accept-Encoding,
  // and answering those with 406 broke the guide and auto-advance. A large body is therefore always sent gzipped (browsers decode
  // Content-Encoding whether or not they advertised it); the header below says so.
  if(Buffer.byteLength(body)>28*1024*1024)return res.set('Content-Encoding','gzip').set('X-AJN-Forced-Gzip','1').send(await gzipAsync(body,{level:5}));
  return res.send(body);
 }
 catch(e){console.error('[Schedule]',e);res.status(500).json({error:'Failed to generate schedule data',channels:[]});}
});
app.get('/api/rush/index',async(req,res)=>{const all=await getRushIndex();const y=Number(req.query.year);const items=y?all.filter(e=>e.year===y):all;res.set('Cache-Control','public, max-age=3600');res.json({total:items.length,items});});
app.get('/api/rush/next/:date',async(req,res)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date))return res.status(400).json({error:'date must be YYYY-MM-DD'});const nextDate=await nextRushDate(req.params.date);if(!nextDate)return res.json({currentDate:req.params.date,nextDate:null});const eps=await rushEpisodesOn(nextDate);try{const episodes=await Promise.all(eps.map(e=>resolveRushItem(e.id).then(r=>({...e,...r}))));res.json({currentDate:req.params.date,nextDate,episodes});}catch(e:any){res.status(e.status??502).json({currentDate:req.params.date,nextDate,error:e.message});}});
app.get('/api/rush/episode/:date',async(req,res)=>{const eps=await rushEpisodesOn(req.params.date);if(!eps.length)return res.status(404).json({error:`no Rush episode indexed for ${req.params.date}`});try{const episodes=await Promise.all(eps.map(e=>resolveRushItem(e.id).then(r=>({...e,...r}))));res.json({date:req.params.date,episodes,stats:rushStats});}catch(e:any){res.status(e.status??502).json({error:e.message,stats:rushStats});}});
app.get('/api/news/version',async(_req,res)=>{res.set('Cache-Control','no-store');res.json(await getNewsVersion());});
// Daily News Digest (GitHub Pages JSON, in memory). Headlines and links only; never media. 503 only when no digest was ever loaded.
app.get('/api/digest',async(_req,res)=>{const st=await getDigestState();res.set('Cache-Control','no-store');if(!st.digest)return res.status(503).json({status:st.status,error:st.error??'digest not loaded yet'});return res.json(st);});
app.get('/api/playlists',(_req,res)=>{const playlists=getAllPlaylists();res.json({playlists,total:playlists.length});});
app.get('/api/playlists/:playlistId',(req,res)=>{const p=getPlaylistById(req.params.playlistId);if(!p)return res.status(404).json({error:`Playlist not found: ${req.params.playlistId}`});res.json(p);});
app.post('/api/playlists/:playlistId/sync',(req,res)=>{const r=syncPlaylist(req.params.playlistId,req.body?.customM3u);if(!r.success)return res.status(400).json({error:`Failed to sync playlist ${req.params.playlistId}`,playlist:r.playlist});res.json({message:`Playlist ${req.params.playlistId} synchronized successfully`,playlist:r.playlist,ingestedCount:r.count});});

patchServer(app);
registerSourceRoutes(app);
registerRumbleRoutes(app);

// Search -> "Create 24/7 Channel": built from the identifiers the viewer is looking at.
app.post('/api/channels/build-news',async(req,res)=>{
  try{
    const {identifiers,name,network,titles}=req.body??{};
    if(!Array.isArray(identifiers))return res.status(400).json({error:'identifiers[] required'});
    const ch=await buildDiscoveryChannel(identifiers,String(name||network||'Archive Discovery').slice(0,80),network?String(network):undefined,titles&&typeof titles==='object'?titles:{});
    const laid=(await getScheduleForGuide(DISCOVERY_GUIDE_ID)).find(c=>c.id===ch.id);
    res.json({channelId:ch.id,guideId:DISCOVERY_GUIDE_ID,name:ch.name,items:identifiers.length,clips:ch.programs.length,skipped:ch.skipped,programs:(laid?.programs??[]).slice(0,ch.programs.length)});
  }catch(e:any){res.status(e?.status??500).json({error:e?.message??'build failed'});}
});
app.get('/api/search',async(req,res)=>{const query=(req.query.q as string)||'';const network=(req.query.network as string)||'FOXNEWSW';const rows=Math.min(parseInt((req.query.rows as string)||'24',10)||24,50);try{const r=await searchTVNews({network,query:query.trim()||undefined,rows});if(r.status==='upstream_error'){return res.status(502).json({query,network,status:r.status,total:0,items:[],safeEndDate:r.safeEndDate,error:r.error||'Archive search upstream unavailable'});}res.json({query,network,status:r.status,total:r.total,items:r.items,safeEndDate:r.safeEndDate});}catch(e){console.error('[Search API Error]',e);res.status(500).json({query,network,status:'upstream_error',error:'Search failed',items:[],total:0});}});

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


interface CachedProxyImage {
  contentType: string;
  buffer: Buffer;
  etag?: string;
  lastModified?: string;
  expires: number;
}
const proxyImageCache = new Map<string, CachedProxyImage>();
const MAX_IMAGE_CACHE_ENTRIES = 300;
const IMAGE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

registerFolderArtRoute(app);
app.get('/api/podcast/resolve',async(req,res)=>{
 res.set('Cache-Control','no-store');
 const url=String(req.query.url??'');
 if(!isKnownEnclosure(url))return res.status(404).json({error:'Not a known podcast enclosure'});
 try{const r=await resolveEnclosure(url);res.json(r);}
 catch(e:any){console.error('[Podcasts] resolve failed:',e?.message);res.status(502).json({error:String(e?.message??e)});}
});
app.get('/api/archive/proxy', async (req,res)=>{
  stats.totalRequests++;
  const proxyRequestId=crypto.randomUUID();
  res.setHeader('x-proxy-request-id',proxyRequestId);
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Expose-Headers','Content-Range, Content-Length, Accept-Ranges, X-Proxy-Request-Id, ETag, Last-Modified');

  const rawPath=String(req.query.path || '');
  if(unplayableReason(rawPath)){
    return res.status(422).json({error:'Not streamable: file inside a compressed archive',reason:'UNPLAYABLE_ARCHIVE_MEMBER',proxyRequestId});
  }
  const v=validateArchivePath(rawPath);
  if(!v.valid || !v.cleanPath){
    stats.failedRequests++;
    return res.status(400).json({error:'Invalid path parameter',details:v.error,proxyRequestId});
  }

  const isImage = /\.(jpe?g|png|webp|gif|svg|bmp|ico)$/i.test(v.cleanPath) || v.cleanPath.endsWith('/__ia_thumb.jpg');
  if (isImage) {
    const cachedImg = proxyImageCache.get(v.cleanPath);
    if (cachedImg && cachedImg.expires > Date.now()) {
      stats.successfulRequests++;
      stats.cacheHits++;
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', cachedImg.contentType);
      res.setHeader('Content-Length', cachedImg.buffer.length);
      if (cachedImg.etag) res.setHeader('ETag', cachedImg.etag);
      if (cachedImg.lastModified) res.setHeader('Last-Modified', cachedImg.lastModified);
      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
      res.setHeader('X-AJN-Archive-Proxy', 'memory-cached-image');
      return res.status(200).end(cachedImg.buffer);
    }
  }

  try{
    const upstreamUrl=`${ARCHIVE_BASE}${v.cleanPath}`;
    const upstreamHeaders:Record<string,string>={'User-Agent':'AJN-Media-Console/ArchiveProxy','Accept': isImage ? 'image/*,*/*' : '*/*'};
    // Cloud Run rejects any HTTP/1 response larger than 32 MiB with an empty 500.
    // Browsers open media with "Range: bytes=0-" (or no Range), which asked for the
    // whole 500 MB file and died there, reported by the video element as
    // MediaError 4. Serve bounded 206 slices instead; the browser requests the
    // next slice itself as it plays or seeks.
    if (isImage) {
      if (req.headers.range) {
        const slice = proxySliceRange(req.headers.range);
        upstreamHeaders.Range = `bytes=${slice.start}-${slice.end}`;
      }
    } else {
      const slice=proxySliceRange(req.headers.range);
      upstreamHeaders.Range=`bytes=${slice.start}-${slice.end}`;
    }

    const upstreamAbort=new AbortController();
    res.on('close',()=>{ if(!res.writableFinished) upstreamAbort.abort(); });

    const upstreamT0=Date.now();
    const upstream=await fetchArchiveMediaWithRetry(upstreamUrl,{
      headers:upstreamHeaders,
      signal:upstreamAbort.signal,
      requestId:proxyRequestId,
    });
    if(upstream.attempts>1) stats.retriedRequests++;
    // Evidence for stall investigations: how long Archive took to answer this slice and how many attempts it needed.
    res.setHeader('Server-Timing',`upstream;dur=${Date.now()-upstreamT0}, attempts;desc="${upstream.attempts}"`);
    const mediaResponse=upstream.response;

    if(!mediaResponse || upstream.failure){
      if (isImage) {
        try {
          const fallbackPath = path.resolve('public/thumbs/classic-archive.jpg');
          const fallbackData = await fs.promises.readFile(fallbackPath);
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Content-Type', 'image/jpeg');
          res.setHeader('Content-Length', fallbackData.length);
          res.setHeader('Cache-Control', 'public, max-age=3600');
          res.setHeader('X-AJN-Archive-Proxy', 'fallback-image');
          stats.successfulRequests++;
          return res.status(200).end(fallbackData);
        } catch {
          // Continue to error
        }
      }
      await mediaResponse?.body?.cancel().catch(()=>{});
      stats.failedRequests++;
      console.error('[Archive Proxy Upstream Failure]',JSON.stringify({proxyRequestId,upstreamStatus:upstream.status,stage:upstream.failure,attempts:upstream.attempts,path:v.cleanPath}));
      const error=upstream.failure==='resolve'
        ? 'Archive did not return a validated media response'
        : `Archive media returned HTTP ${upstream.status}`;
      return res.status(502).json({error,upstreamStatus:upstream.status,attempts:upstream.attempts,proxyRequestId});
    }

    const contentType=mediaResponse.headers.get('content-type');
    // Archive answers not-yet-published or unavailable media with an HTML page
    // (still 200/206). Passing that on makes the browser report a demuxer error;
    // report it as what it is instead.
    if(!isImage && /text\/html/i.test(contentType||'')){
      await mediaResponse.body?.cancel().catch(()=>{});
      stats.failedRequests++;
      console.error('[Archive Proxy Upstream Failure]',JSON.stringify({proxyRequestId,upstreamStatus:mediaResponse.status,stage:'not_media',contentType,path:v.cleanPath}));
      return res.status(502).json({error:'Archive returned a web page, not media (not yet published or unavailable)',upstreamStatus:mediaResponse.status,proxyRequestId});
    }
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
    if (isImage) {
      res.setHeader('Cache-Control','public, max-age=86400, stale-while-revalidate=604800');
    } else {
      res.setHeader('Cache-Control','no-store');
    }
    res.setHeader('X-AJN-Archive-Proxy','stream-from-validated-storage');
    res.status(mediaResponse.status);

    if(isImage && mediaResponse.body){
      try {
        const chunks: Buffer[] = [];
        const reader = mediaResponse.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) chunks.push(Buffer.from(value));
        }
        const fullBuffer = Buffer.concat(chunks);
        if (proxyImageCache.size >= MAX_IMAGE_CACHE_ENTRIES) {
          const oldestKey = proxyImageCache.keys().next().value;
          if (oldestKey) proxyImageCache.delete(oldestKey);
        }
        proxyImageCache.set(v.cleanPath, {
          contentType: contentType || 'image/jpeg',
          buffer: fullBuffer,
          etag: etag ?? undefined,
          lastModified: lastModified ?? undefined,
          expires: Date.now() + IMAGE_CACHE_TTL_MS,
        });
        return res.end(fullBuffer);
      } catch (streamErr: any) {
        if (!upstreamAbort.signal.aborted) console.error('[Archive Proxy Image Stream Error]', proxyRequestId, streamErr?.message);
        return res.destroy();
      }
    }

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
      // One line per slice in the Cloud Run logs: where the time goes (Archive headers vs first byte vs body speed).
      let firstByteAt=0,sent=0; const headersMs=Date.now()-upstreamT0;
      body.on('data',(c:Buffer)=>{ if(!firstByteAt)firstByteAt=Date.now(); sent+=c.length; });
      body.once('end',()=>{ const t=Date.now(),bodyMs=t-(firstByteAt||t);
        console.log('[archive-proxy-slice]',JSON.stringify({id:proxyRequestId,range:upstreamHeaders.Range,path:v.cleanPath.slice(-70),status:mediaResponse.status,headersMs,firstByteMs:firstByteAt?firstByteAt-upstreamT0:null,bodyMs,bytes:sent,kBps:bodyMs>0?Math.round(sent/1024/(bodyMs/1000)):null})); });
      return body.pipe(res);
    }
    return res.end();
  }catch(err:any){
    if(err?.name==='AbortError'||res.headersSent) return;
    if (isImage) {
      try {
        const fallbackPath = path.resolve('public/thumbs/classic-archive.jpg');
        const fallbackData = await fs.promises.readFile(fallbackPath);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Content-Length', fallbackData.length);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('X-AJN-Archive-Proxy', 'fallback-image');
        stats.successfulRequests++;
        return res.status(200).end(fallbackData);
      } catch {
        // Fall through
      }
    }
    stats.failedRequests++;
    console.error('[Archive Proxy Redirect Failure]',proxyRequestId,err?.message || String(err));
    return res.status(502).json({
      error:'Archive proxy redirect failure',
      detail:err?.message || String(err),
      proxyRequestId
    });
  }
});
// AJN recorded files (archive.alexjoneslive.com) send no CORS headers, so the
// audio bridge/visualizer can't read them directly. Same-origin proxy, fixed
// host allowlist (no open proxy), bounded 8 MiB slices like the Archive proxy.
const AJN_PROXY_HOSTS=new Set(['archive.alexjoneslive.com','www.alexjoneslive.com']);
app.get('/api/ajn/proxy',async(req,res)=>{
  let target:URL;
  try{target=new URL(String(req.query.url||''));}catch{return res.status(400).json({error:'invalid url'});}
  if(target.protocol!=='https:'||target.port||!AJN_PROXY_HOSTS.has(target.hostname))return res.status(403).json({error:'host not allowed'});
  const slice=proxySliceRange(req.headers.range);
  const abort=new AbortController();
  res.on('close',()=>{if(!res.writableFinished)abort.abort();});
  try{
    // Every redirect hop is checked against the allowlist; 60 s bounds one 8 MiB slice.
    const {res:up}=await safeFetch(target,{allow:(h)=>AJN_PROXY_HOSTS.has(h),timeoutMs:60_000,signal:abort.signal,headers:{'User-Agent':'AJN-Media-Console/AjnProxy',Range:`bytes=${slice.start}-${slice.end}`}});
    if(!up.ok){await up.body?.cancel().catch(()=>{});return res.status(502).json({error:`AJN media HTTP ${up.status}`,upstreamStatus:up.status});}
    const ct=up.headers.get('content-type')||'';
    if(/text\/html/i.test(ct)){await up.body?.cancel().catch(()=>{});return res.status(502).json({error:'AJN host returned a web page, not media'});}
    res.setHeader('Access-Control-Allow-Origin','*');
    res.setHeader('Access-Control-Expose-Headers','Content-Range, Content-Length, Accept-Ranges');
    for(const h of ['content-type','content-length','content-range','etag','last-modified']){const v=up.headers.get(h);if(v)res.setHeader(h,v);}
    res.setHeader('Accept-Ranges','bytes');res.setHeader('Cache-Control','no-store');
    res.status(up.status);
    if(!up.body)return res.end();
    const body=Readable.fromWeb(up.body as any);
    body.once('error',()=>res.destroy());
    res.once('close',()=>{if(!body.destroyed)body.destroy();});
    return body.pipe(res);
  }catch(e:any){if(e?.name==='AbortError'||res.headersSent)return;if(e instanceof SafeFetchError&&e.reason==='redirect_blocked')return res.status(502).json({error:'redirected off allowlist',detail:e.message});return res.status(e instanceof SafeFetchError&&e.reason==='timeout'?504:502).json({error:'AJN proxy failure',reason:e?.reason,detail:e?.message});}
});
// Pluto (jmp2.uk → stitcher.pluto.tv) playlists: fetched and rewritten here
// because the stitcher only allows http://pluto.tv to read them. Text only.
app.get('/api/hls/playlist',async(req,res)=>{
  let target:URL;
  try{target=new URL(String(req.query.url||''));}catch{return res.status(400).json({error:'invalid url'});}
  if(target.protocol!=='https:'||!hlsProxyAllowed(target.hostname))return res.status(403).json({error:'host not allowed'});
  try{
    // Each redirect hop re-checked; 10 s and 1 MiB bound the whole exchange.
    const {res:up,finalUrl}=await safeFetch(target,{allow:hlsProxyAllowed,timeoutMs:10_000,headers:{'User-Agent':'Mozilla/5.0 AJN-Precision-Engineering'}});
    if(!up.ok){await up.body?.cancel().catch(()=>{});return res.status(502).json({error:`playlist HTTP ${up.status}`,upstreamStatus:up.status});}
    const text=await readTextCapped(up,PLAYLIST_MAX_BYTES);
    if(!text.startsWith('#EXTM3U'))return res.status(502).json({error:'not an HLS playlist'});
    res.setHeader('Content-Type','application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Access-Control-Allow-Origin','*');
    return res.send(rewritePlaylist(text,finalUrl.toString()));
  }catch(e:any){if(e instanceof SafeFetchError&&e.reason==='redirect_blocked')return res.status(502).json({error:'redirected off allowlist',detail:e.message});return res.status(e instanceof SafeFetchError&&e.reason==='timeout'?504:502).json({error:'playlist proxy failure',reason:e?.reason,detail:e?.message});}
});
app.get('/api/archive/metadata',async(req,res)=>{ const v=validateArchivePath((req.query.path as string)||''); if(!v.valid||!v.cleanPath)return res.status(400).json({error:v.error}); try{const r=await fetch(`${ARCHIVE_BASE}${v.cleanPath}`,{method:'HEAD',headers:{'User-Agent':'AJN-Precision-Engineering-Proxy/1.0'}});res.json({status:r.status,ok:r.ok,contentType:r.headers.get('content-type'),contentLength:r.headers.get('content-length'),acceptRanges:r.headers.get('accept-ranges'),proxyUrl:`/api/archive/proxy?path=${encodeURIComponent(v.cleanPath)}`});}catch(e:any){res.status(502).json({error:e.message});} });

app.use('/api',(req,res)=>res.status(404).json({error:'Not found',path:req.originalUrl}));

async function startServer(){
 if(process.env.NODE_ENV!=='production'){const vite=await createViteServer({server:{middlewareMode:true},appType:'spa'});app.use(vite.middlewares)} else{app.use(express.static(path.join(process.cwd(),'dist')));app.get('*',(_req,res)=>res.sendFile(path.join(process.cwd(),'dist','index.html')))}
 app.listen(PORT,'0.0.0.0',()=>{console.log(`[AJN] Integrated Server running at http://0.0.0.0:${PORT}`); refreshMoviesClassicsFromArchive().then(r=>console.log('[AJN] Movies & Classics resolved from Archive metadata',JSON.stringify({kept:r.kept.length,unverified:r.unverified.length,replaced:r.replaced.length,dropped:r.dropped.map(d=>d.identifier)}))).catch(e=>console.error('[AJN] Movies & Classics metadata refresh failed; using stored manifest:',e?.message)); buildChannelFromSearch('collection:SciFi_Horror','archive-scifi','Sci-Fi Horror Archive').then(c=>console.log(`[AJN] Built Archive channel: ${c.name} with ${c.playlist.length} assets`)).catch(e=>console.error('[AJN] Failed to build Archive channel:',e));
  // Warm the guides one at a time (Archive rate-limits bursts) so the first
  // viewer gets a filled grid instead of waiting on every source.
  if(process.env.NODE_ENV!=='test'&&process.env.LIBRARY_BACKGROUND!=='off'){void loadLibrarySnapshot().then(()=>startLibraryBackground());}
  if(process.env.NODE_ENV!=='test'){void (async()=>{for(const g of ['cable-tv','classic-tv','live-tv','science-documentaries','movies-classics-vault']){try{const t=Date.now();const ch=await getScheduleForGuide(g);console.log(`[AJN] warmed ${g}: ${ch.length} channels in ${Date.now()-t}ms`);}catch(e:any){console.error(`[AJN] warm ${g} failed:`,e?.message);}await new Promise(r=>setTimeout(r,2000));}})();}
 });
}
startServer();
