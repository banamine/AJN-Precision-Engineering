import { unplayableReason } from './server/sources/archiveLinks';
import {
  Guide, Channel, ChannelSource, Program, Playlist, ScheduleChannel, MediaType,
} from './src/types';
import { tryResolveArchiveMediaCandidates } from './channels';
import { archiveNewsContract, NEWS_NETWORKS, type ArchiveNewsInput } from './server/sources/archiveNews';
import { runSources } from './server/sources/runner';
import { validateNewsSnapshot, toSnapshotProgram, newsFingerprint, type NewsSnapshot } from './server/newsSnapshot';
import newsSnapshotFile from './src/data/newsSnapshot.json';
import classicSnapshotFile from './src/data/classicSnapshot.json';
import { buildHoneymoonersEpg } from './collections/honeymooners-epg';
import { getNovaCanonicalPrograms } from './src/services/producers/novaProducer';
import { buildMoviesClassicsPrograms, resolveMoviesClassicsManifest } from './src/services/producers/moviesClassicsProducer';
import moviesClassicsManifest from './src/data/moviesClassicsManifest.json';
import { normalizeChannelIdentity, normalizeProgramIdentity, normalizeSourceIdentity, normalizeAssetIdentity, sanitizeIdentityUrl } from './src/utils/epgIdentity';

export const GUIDES: Guide[] = [
  { id: 'cable-tv', name: 'Cable TV', type: 'video', enabled: true,
    description: '24-Hour Broadcast Television, Live News, and Classic Cinema Grid' },
  { id: 'classic-tv', name: 'Classic TV', type: 'video', enabled: true,
    description: 'Curated classic television collections resolved from Archive.org metadata' },
  { id: 'audio-podcasts', name: 'Audio & Podcasts', type: 'audio', enabled: true,
    description: 'Live radio streams, historic aerospace vaults, audio dramas, and podcasts' },
  { id: 'science-documentaries', name: 'Science Documentaries', type: 'video', enabled: true,
    description: 'Curated science documentaries resolved from verified Archive.org manifests' },
  { id: 'live-tv', name: 'Live TV', type: 'video', enabled: true,
    description: 'Free public live channels, refreshed from the upstream channel list every few hours' },
  { id: 'movies-classics-vault', name: 'Movies & Cinema Classics', type: 'video', enabled: true,
    description: 'Curated classic cinema resolved from the verified Movies Classics Archive manifest' },
];

const channelsMap = new Map<string, Channel>();
const channelSourcesMap = new Map<string, ChannelSource[]>();
const playlistsMap = new Map<string, Playlist>();
const programsMap = new Map<string, Program>();
const PROGRAM_RETENTION_MS = 24 * 60 * 60 * 1000;

function toUtcMs(value?: string | Date): number {
  if (!value) return Number.NaN;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function evictExpiredPrograms(nowMs = Date.now()): number {
  const cutoff = nowMs - PROGRAM_RETENTION_MS;
  let removed = 0;
  for (const [id, program] of programsMap) {
    const endMs = toUtcMs(program.endTimeUtc);
    if (Number.isFinite(endMs) && endMs < cutoff) {
      programsMap.delete(id);
      removed += 1;
    }
  }
  return removed;
}

export function upsertCanonicalProgram(program: Program): Program {
  const identity = normalizeProgramIdentity({
    externalId: program.metadata?.externalId,
    channelId: program.channelId,
    title: program.title,
    startTime: program.startTimeUtc ?? program.startTime,
  });
  const canonical = identity === program.id ? program : { ...program, id: identity };
  programsMap.set(canonical.id, canonical);
  evictExpiredPrograms();
  return canonical;
}

export function getCanonicalProgram(id: string): Program | undefined {
  evictExpiredPrograms();
  return programsMap.get(id);
}

export function getCanonicalPrograms(): Program[] {
  evictExpiredPrograms();
  return Array.from(programsMap.values());
}

export function sweepCanonicalPrograms(nowMs = Date.now()): number {
  return evictExpiredPrograms(nowMs);
}

const INITIAL_PLAYLISTS: { playlist: Playlist; m3uContent: string }[] = [
  {
    playlist: {
      id: 'playlist-news', name: 'Broadcast TV News Networks',
      sourceUrl: 'https://archive.org/services/m3u/tvnews-networks.m3u',
      category: 'News', enabled: true, lastSyncedAt: new Date().toISOString(),
      syncStatus: 'synced', itemCount: 3,
    },
    m3uContent: `#EXTM3U
#EXTINF:-1 tvg-id="fox-news" tvg-name="Fox News" tvg-logo="https://archive.org/services/img/FOXNEWSW" group-title="News",Fox News
/download/FOXNEWSW_20260903_060000_Hannity/FOXNEWSW_20260903_060000_Hannity.mp4?start=0&end=300
#EXTINF:-1 tvg-id="cnn" tvg-name="CNN" tvg-logo="https://archive.org/services/img/CNNW" group-title="News",CNN
/download/CNNW_20240901_180000_The_Situation_Room/CNNW_20240901_180000_The_Situation_Room.mp4?start=0&end=300
#EXTINF:-1 tvg-id="msnbc" tvg-name="MSNBC" tvg-logo="https://archive.org/services/img/MSNBCW" group-title="News",MSNBC
/download/MSNBCW_20240901_180000_The_Beat_With_Ari_Melber/MSNBCW_20240901_180000_The_Beat_With_Ari_Melber.mp4?start=0&end=300`,
  },
  {
    playlist: { id:'playlist-tvshows', name:'Classic TV Series & Serials',
      sourceUrl:'https://archive.org/services/m3u/classic-tv.m3u', category:'TV Shows',
      enabled:true, lastSyncedAt:new Date().toISOString(), syncStatus:'synced', itemCount:2 },
    m3uContent:`#EXTM3U
#EXTINF:-1 tvg-id="classic-tv-serials" tvg-name="Classic TV Serials" group-title="TV Shows",Classic TV Serials
/download/FlashGordonConquersTheUniverse1940_Chapter1/FlashGordonConquersTheUniverse1940_Chapter1_512kb.mp4
#EXTINF:-1 tvg-id="vintage-broadcasts" tvg-name="Vintage Broadcast Network" group-title="TV Shows",Vintage Broadcast Network
/download/SherlockHolmesTheSecretWeapon1942/Sherlock_Holmes_Secret_Weapon_512kb.mp4`,
  },
  {
    playlist: { id:'playlist-movies', name:'Public Domain Cinema Classics',
      sourceUrl:'https://archive.org/services/m3u/archive-movies.m3u', category:'Movies',
      enabled:true, lastSyncedAt:new Date().toISOString(), syncStatus:'synced', itemCount:2 },
    m3uContent:`#EXTM3U
#EXTINF:-1 tvg-id="cinema-vault" tvg-name="Cinema Classics Vault" group-title="Movies",Cinema Classics Vault
/download/NightOfTheLivingDead/Night_of_the_Living_Dead_512kb.mp4
#EXTINF:-1 tvg-id="prelinger-reels" tvg-name="Prelinger Archive Cinema" group-title="Movies",Prelinger Archive Cinema
/download/HisGirlFriday1940/His_Girl_Friday_512kb.mp4`,
  },
  {
    playlist: { id:'playlist-audio-radio', name:'Radio & Audio Vaults',
      sourceUrl:'https://archive.org/services/m3u/audio-podcasts.m3u', category:'Audio & Podcasts',
      enabled:true, lastSyncedAt:new Date().toISOString(), syncStatus:'synced', itemCount:3 },
    m3uContent:`#EXTM3U
#EXTINF:-1 tvg-id="nasa-audio-vault" tvg-name="NASA Spaceflight Audio" group-title="Aerospace & Science",NASA Spaceflight Audio
/download/Apollo11AudioHighlights/apollo_11_audio_highlights_64kb.mp3
#EXTINF:-1 tvg-id="radio-drama-theatre" tvg-name="Old Time Radio Theatre" group-title="Audio Drama",Old Time Radio Theatre
/download/OTRR_Mercury_Theater_on_the_Air_Singles/Mercury_381030_WarOfTheWorlds.mp3`,
  },
];

export interface ParsedM3uEntry {
  title:string; url:string; tvgId?:string; tvgName?:string; tvgLogo?:string;
  groupTitle?:string; duration?:number;
}

export function parseM3u(text:string):ParsedM3uEntry[] {
  const lines=text.split(/\r?\n/); const out:ParsedM3uEntry[]=[]; let cur:Partial<ParsedM3uEntry>|null=null;
  for(const raw of lines){
    const line=raw.trim(); if(!line) continue;
    if(line.startsWith('#EXTINF:')){
      cur={}; const comma=line.lastIndexOf(','); if(comma>=0) cur.title=line.slice(comma+1).trim();
      const m=(name:string)=>line.match(new RegExp(`${name}=["']([^"']+)["']`,'i'))?.[1];
      cur.tvgId=m('tvg-id'); cur.tvgName=m('tvg-name'); cur.tvgLogo=m('tvg-logo'); cur.groupTitle=m('group-title');
      cur.duration=Number(line.match(/^#EXTINF:(-?\d+)/)?.[1] ?? 0);
    } else if(!line.startsWith('#') && cur){ cur.url=line; if(cur.title) out.push(cur as ParsedM3uEntry); cur=null; }
  }
  return out;
}

export function ingestM3uPlaylist(playlist:Playlist,text:string,targetGuideId?:string){
  const entries=parseM3u(text); const updated:Channel[]=[];
  const guideId=targetGuideId || (playlist.category.toLowerCase().includes('audio')?'audio-podcasts':'cable-tv');
  const mediaType:MediaType=guideId==='audio-podcasts'?'audio':'video';
  const currentSourceIds=new Set<string>();

  for(const entry of entries){
    const sanitizedUrl = sanitizeIdentityUrl(entry.url);
    const id=normalizeChannelIdentity({ externalId: entry.tvgId, name: entry.tvgName || entry.title, guideId });
    const existing=channelsMap.get(id);
    const ch:Channel=existing
      ? {...existing,
          tvgId: entry.tvgId || existing.tvgId,
          tvgName: entry.tvgName || existing.tvgName,
          logo: existing.logo || entry.tvgLogo,
          group: existing.group || entry.groupTitle || playlist.category}
      : {id,guideId,name:entry.tvgName||entry.title,mediaType,logo:entry.tvgLogo,group:entry.groupTitle||playlist.category,tvgId:entry.tvgId,tvgName:entry.tvgName,enabled:true};
    channelsMap.set(id,ch); updated.push(ch);

    const sources=channelSourcesMap.get(id)||[];
    const protocol=entry.url.includes('.m3u8')?'hls':'https';
    const canonicalSourceId=normalizeSourceIdentity({channelId:id,url:sanitizedUrl,protocol});
    currentSourceIds.add(canonicalSourceId);
    const existingSource=sources.find(s=>s.id===canonicalSourceId);
    if(existingSource){
      existingSource.enabled=true;
      existingSource.url=entry.url;
      existingSource.metadata={...existingSource.metadata,playlistId:playlist.id,playlistName:playlist.name,category:playlist.category,retiredAt:undefined,retirementReason:undefined,durationSeconds:entry.duration&&entry.duration>0?entry.duration:undefined};
    } else {
      sources.push({id:canonicalSourceId,channelId:id,protocol,url:entry.url,priority:sources.length+1,enabled:true,metadata:{playlistId:playlist.id,playlistName:playlist.name,category:playlist.category,durationSeconds:entry.duration&&entry.duration>0?entry.duration:undefined}});
    }
    channelSourcesMap.set(id,sources);
  }

  for(const [channelId,sources] of channelSourcesMap){
    for(const source of sources){
      if(source.metadata?.playlistId===playlist.id && !currentSourceIds.has(source.id)){
        source.enabled=false;
        source.metadata={...source.metadata,retiredAt:new Date().toISOString(),retirementReason:'absent-from-latest-playlist-sync'};
      }
    }
    channelSourcesMap.set(channelId,sources);
  }

  playlist.lastSyncedAt=new Date().toISOString(); playlist.syncStatus='synced'; playlist.itemCount=entries.length; playlist.rawM3u=text; playlistsMap.set(playlist.id,playlist);
  return {ingestedCount:entries.length,channels:updated};
}
export function initializeRegistry(){
  if(playlistsMap.size)return;
  for(const {playlist,m3uContent} of INITIAL_PLAYLISTS){playlistsMap.set(playlist.id,playlist);ingestM3uPlaylist(playlist,m3uContent);}
  for(const program of getNovaCanonicalPrograms()) upsertCanonicalProgram(program);
  for(const program of buildMoviesClassicsPrograms(moviesClassicsManifest)) upsertCanonicalProgram(program);
}
initializeRegistry();

/**
 * Replace the Movies & Classics programs with ones whose files were confirmed in
 * Archive's live metadata. Called once after the server starts; until it finishes
 * the guide shows the stored manifest.
 */
let moviesRetry=0;
export async function refreshMoviesClassicsFromArchive(){
  const {items,report}=await resolveMoviesClassicsManifest(moviesClassicsManifest,tryResolveArchiveMediaCandidates);
  // Items whose metadata couldn't be read (timeout/rate limit at boot) stay
  // "unverified". Re-check them a few times so dead items get dropped.
  if(report.unverified.length&&moviesRetry<4&&process.env.NODE_ENV!=='test'){
    moviesRetry++;
    setTimeout(()=>{refreshMoviesClassicsFromArchive().then(r=>console.log('[AJN] Movies re-verify',moviesRetry,JSON.stringify({kept:r.kept.length,unverified:r.unverified.length,dropped:r.dropped.map(d=>d.identifier)}))).catch(()=>{});},180_000).unref?.();
  }
  for(const [id,program] of programsMap){
    if(program.guideId==='movies-classics-vault'&&program.channelId==='classic-cinema')programsMap.delete(id);
  }
  for(const program of buildMoviesClassicsPrograms(items))upsertCanonicalProgram(program);
  return report;
}

export function getAllGuides(){return GUIDES;}
export function getGuideById(id:string){return GUIDES.find(g=>g.id===id);}
export function getChannelsByGuide(id?:string){
  const channels=Array.from(channelsMap.values()).filter(c=>!id||c.guideId===id).map(c=>({...c,sources:channelSourcesMap.get(c.id)||[]}));
  if(id==='classic-tv' && !channels.some(c=>c.id==='honeymooners')){
    channels.push({id:'honeymooners',guideId:'classic-tv',name:'The Honeymooners',mediaType:'video',group:'Classic TV',enabled:true,sources:[]});
  }
  return channels;
}
export function getChannelById(id:string){
  const c=channelsMap.get(id); if(c)return {...c,sources:channelSourcesMap.get(id)||[]};
  if(id==='honeymooners')return {id:'honeymooners',guideId:'classic-tv',name:'The Honeymooners',mediaType:'video' as const,group:'Classic TV',enabled:true,sources:[]};
  return undefined;
}
export function getChannelSources(id:string){return channelSourcesMap.get(id)||[];}
export function addChannelSource(channelId:string,source:Partial<ChannelSource>){
  const url=source.url||''; const protocol=source.protocol||(url.includes('.m3u8')?'hls':'https');
  if(!url) throw new Error('Channel source URL is required');
  const canonicalId=normalizeSourceIdentity({channelId,url,protocol});
  const existing=channelSourcesMap.get(channelId)||[];
  const existingSource=existing.find(s=>s.id===canonicalId);
  if(existingSource) return existingSource;
  const created:ChannelSource={id:source.id||canonicalId,channelId,protocol,url,priority:source.priority??existing.length+1,enabled:source.enabled??true,metadata:source.metadata};
  existing.push(created); channelSourcesMap.set(channelId,existing); return created;
}
export function getAllPlaylists(){return Array.from(playlistsMap.values());}
export function getPlaylistById(id:string){return playlistsMap.get(id);}
export function syncPlaylist(id:string,customM3u?:string){const p=playlistsMap.get(id);if(!p)return{success:false};const text=customM3u||p.rawM3u||'';if(!text){p.syncStatus='failed';return{success:false,playlist:p};}const r=ingestM3uPlaylist(p,text);return{success:true,playlist:p,count:r.ingestedCount};}

// Cable TV news comes from the Archive News source contract (layer 3): real air
// times, restricted items reported per channel. Complete results are cached for
// 15 minutes; if any network came back empty or failed, only for 60 seconds.
import { dailyHighlightsContract, toChannels as highlightChannels } from './server/sources/dailyHighlights';
import { getDocumentaryChannels } from './src/services/producers/documentariesProducer';

import { liveTvContract, LIVE_REFRESH_MS } from './server/sources/liveTv';

// Live TV: stale-while-revalidate. The last good list is served while a refresh
// runs in the background; a failed refresh keeps the last good list (marked).
let liveCache:{data:ScheduleChannel[];fetchedAt:number;refreshing?:Promise<void>}|null=null;
let liveFetch:typeof fetch|undefined;
export function setLiveTvFetchForTests(impl?:typeof fetch){liveFetch=impl;liveCache=null;}

async function refreshLiveTv(guideId:string):Promise<void>{
  const [r]=await runSources([{contract:liveTvContract,input:{guideId,fetchImpl:liveFetch}}],{timeoutMs:30_000});
  if(r.programs.length===0&&liveCache?.data.length){
    liveCache={data:liveCache.data.map(ch=>({...ch,sourceStatus:'upstream_error',sourceError:`refresh failed, showing list from ${new Date(liveCache!.fetchedAt).toISOString()}: ${r.error}`})),fetchedAt:liveCache.fetchedAt};
    return;
  }
  const data:ScheduleChannel[]=r.programs.map(p=>{
    const m=(p.metadata??{}) as any;
    return {id:p.channelId,guideId,name:p.title,mediaType:'video' as MediaType,group:m.group,logo:m.logo,programs:[p],sourceStatus:r.status};
  }).sort((a,b)=>String(a.group).localeCompare(String(b.group))||a.name.localeCompare(b.name));
  if(data.length===0)data.push({id:'live-tv-status',guideId,name:'Live TV',mediaType:'video',group:'Live',programs:[],sourceStatus:r.status,sourceError:r.error,rejected:r.rejected.slice(0,50)});
  liveCache={data,fetchedAt:Date.now()};
}

async function getLiveTvChannels(guideId:string):Promise<ScheduleChannel[]>{
  if(!liveCache){await refreshLiveTv(guideId);return liveCache!.data;}
  const stale=Date.now()-liveCache.fetchedAt>LIVE_REFRESH_MS||liveCache.data[0]?.id==='live-tv-status';
  if(stale&&!liveCache.refreshing){
    const cache=liveCache;
    cache.refreshing=refreshLiveTv(guideId).catch(()=>{}).finally(()=>{cache.refreshing=undefined;});
  }
  return liveCache.data;
}

let highlightsCache:{data:ScheduleChannel[];expiresAt:number}|null=null;
let highlightsFetch:typeof fetch|undefined;
export function setHighlightsFetchForTests(impl?:typeof fetch){highlightsFetch=impl;highlightsCache=null;highlightsLastGood=null;}

/** Classic TV shows from archive.org/download/daily-highlights (folders + M3Us). */
let highlightsLastGood:ScheduleChannel[]|null=null;
let highlightsRaw:{fetchedAt:string;programs:Program[]}|null=null;
/** Raw Classic TV programs for the snapshot generator. */
export async function exportClassicSnapshot(){
  await refreshDailyHighlights('classic-tv');
  return highlightsRaw?{schema:1,fetchedAt:highlightsRaw.fetchedAt,programs:highlightsRaw.programs}:null;
}
let highlightsRefreshing:Promise<ScheduleChannel[]>|null=null;
async function refreshDailyHighlights(guideId:string):Promise<ScheduleChannel[]>{
  // 40 playlists behind the shared Archive limiter can take over a minute on a
  // cold start; 25s cut it off and Classic TV showed only The Honeymooners.
  const [r]=await runSources([{contract:dailyHighlightsContract,input:{guideId,fetchImpl:highlightsFetch}}],{timeoutMs:150_000});
  let data:ScheduleChannel[];
  if(r.programs.length){
    highlightsRaw={fetchedAt:new Date().toISOString(),programs:r.programs};
    data=highlightChannels(r.programs).map(ch=>({id:ch.id,guideId,name:ch.name,mediaType:'video' as MediaType,group:'Classic TV',programs:layoutDailySchedule(ch.programs,30),sourceStatus:r.status,rejected:r.rejected}));
    highlightsLastGood=data;
  }else if(highlightsLastGood){
    data=highlightsLastGood.map(ch=>({...ch,sourceStatus:'stale',sourceError:`showing last known list; refresh: ${r.error??r.status}`}));
  }else{
    data=[{id:'classic-daily-highlights',guideId,name:'Daily Highlights',mediaType:'video' as MediaType,group:'Classic TV',programs:[],sourceStatus:r.status,rejected:r.rejected,sourceError:r.error}];
  }
  highlightsCache={data,expiresAt:Date.now()+(r.programs.length?60*60_000:2*60_000)};
  return data;
}

/** Classic TV shows from archive.org/download/daily-highlights (folders + M3Us).
 *  Stale-while-revalidate: never blocks on a refresh once a list exists. */
async function getDailyHighlightsChannels(guideId:string):Promise<ScheduleChannel[]>{
  // Cold start: open from the packaged snapshot instantly; refresh behind it.
  if(!highlightsCache&&!highlightsFetch){
    const snap=classicSnapshotFile as {schema?:number;fetchedAt?:string;programs?:Program[]};
    if(snap?.schema===1&&Array.isArray(snap.programs)&&snap.programs.length){
      const data=highlightChannels(snap.programs).map(ch=>({id:ch.id,guideId,name:ch.name,mediaType:'video' as MediaType,group:'Classic TV',programs:layoutDailySchedule(ch.programs,30),sourceStatus:'snapshot',sourceError:`packaged list from ${snap.fetchedAt}; refreshing`}));
      highlightsLastGood=data;
      highlightsCache={data,expiresAt:0};
    }
  }
  if(highlightsCache&&Date.now()<highlightsCache.expiresAt)return highlightsCache.data;
  if(!highlightsRefreshing)highlightsRefreshing=refreshDailyHighlights(guideId).finally(()=>{highlightsRefreshing=null;});
  if(highlightsCache)return highlightsCache.data;
  // Cold start: wait briefly, then answer with a loading row instead of holding
  // the whole Classic TV guide for a minute.
  const loading:ScheduleChannel[]=[{id:'classic-daily-highlights',guideId,name:'Daily Highlights',mediaType:'video' as MediaType,group:'Classic TV',programs:[],sourceStatus:'loading',sourceError:'loading shows from Archive — refresh in a minute'}];
  return Promise.race([highlightsRefreshing,new Promise<ScheduleChannel[]>(r=>setTimeout(()=>r(loading),8000))]);
}

/* ---------------- Cable TV news: snapshot first, quiet refresh ----------------
 * The guide opens from the packaged snapshot (src/data/newsSnapshot.json) with
 * no Archive search. A background refresh runs every 6h, one network at a time
 * behind the Archive limiter; when it produces different shows the version
 * bumps and the UI offers "Latest news ready". Layout is computed per request
 * from real air times so the grid is always today's. */
const NEWS_REFRESH_MS=6*3600_000;
type NewsChannelState={programs:Program[];status:string;error?:string;rejected?:any[]};
let newsState:{version:number;fetchedAt:string;fingerprint:string;channels:Map<string,NewsChannelState>;newShows:Array<{channelId:string;channelName:string;title:string;programId:string}>}|null=null;
let cableNewsFetch:typeof fetch|undefined;
let cableNewsRefreshing:Promise<void>|null=null;
let newsTimer:ReturnType<typeof setInterval>|null=null;
export function setCableNewsFetchForTests(impl?:typeof fetch){cableNewsFetch=impl;newsState=null;}

function seedFromSnapshot(){
  if(newsState)return;
  const snap=validateNewsSnapshot(newsSnapshotFile);
  if(!snap||cableNewsFetch)return;
  newsState={version:snap.version,fetchedAt:snap.fetchedAt,fingerprint:newsFingerprint(snap.channels),newShows:[],
    channels:new Map(snap.channels.map(c=>[c.id,{programs:c.programs,status:'snapshot',error:`packaged news from ${snap.fetchedAt}`}]))};
}

/** Fetch every network (sequentially, quietly) and swap the result in atomically. */
export async function refreshCableNews(guideId='cable-tv'):Promise<void>{
  const next=new Map<string,NewsChannelState>();
  for(const [network,channelId,channelName] of NEWS_NETWORKS){
    const [r]=await runSources([{contract:archiveNewsContract,input:{network,channelId,channelName,guideId,rows:12,windowDays:2,fetchImpl:cableNewsFetch} as ArchiveNewsInput}],{timeoutMs:90_000});
    const grouped=groupClipPrograms([...r.programs].sort((x,y)=>String(x.startTimeUtc).localeCompare(String(y.startTimeUtc)))).map(toSnapshotProgram);
    const prev=newsState?.channels.get(channelId);
    if(grouped.length)next.set(channelId,{programs:grouped,status:r.status,rejected:r.rejected});
    else if(prev?.programs.length)next.set(channelId,{...prev,status:'stale',error:`showing last known shows; refresh: ${r.error??r.status}`});
    else next.set(channelId,{programs:[],status:r.status,error:r.error,rejected:r.rejected});
  }
  const list=[...next.values()];
  const fingerprint=newsFingerprint(list);
  const prevState=newsState;
  if(prevState&&prevState.fingerprint===fingerprint){prevState.channels=next;return;}
  const old=new Set(prevState?[...prevState.channels.values()].flatMap(c=>c.programs.map(p=>p.archivePath)):[]);
  const newShows=NEWS_NETWORKS.flatMap(([,channelId,channelName])=>(next.get(channelId)?.programs??[])
    .filter(p=>!old.has(p.archivePath)).map(p=>({channelId,channelName,title:p.title,programId:p.id})));
  newsState={version:(prevState?.version??0)+1,fetchedAt:new Date().toISOString(),fingerprint,channels:next,newShows:prevState?newShows.slice(0,50):[]};
}

function kickNewsRefresh(guideId:string){
  if(!cableNewsRefreshing)cableNewsRefreshing=refreshCableNews(guideId).catch(e=>console.error('[News refresh]',e)).finally(()=>{cableNewsRefreshing=null;});
  return cableNewsRefreshing;
}

function startNewsTimer(guideId:string){
  if(newsTimer||cableNewsFetch)return;
  newsTimer=setInterval(()=>void kickNewsRefresh(guideId),NEWS_REFRESH_MS);
  (newsTimer as any).unref?.();
  // A packaged snapshot older than one refresh period: refresh soon, off the startup path.
  if(newsState&&Date.now()-Date.parse(newsState.fetchedAt)>NEWS_REFRESH_MS)setTimeout(()=>void kickNewsRefresh(guideId),30_000).unref?.();
}

export function getNewsVersion(){
  seedFromSnapshot();
  return newsState?{version:newsState.version,fetchedAt:newsState.fetchedAt,refreshing:!!cableNewsRefreshing,newShows:newsState.newShows}
    :{version:0,fetchedAt:null,refreshing:!!cableNewsRefreshing,newShows:[]};
}

/** Grouped shows for the snapshot generator. */
export function exportNewsSnapshot():NewsSnapshot|null{
  if(!newsState)return null;
  return {schema:1,version:newsState.version,fetchedAt:newsState.fetchedAt,
    channels:NEWS_NETWORKS.map(([network,id,name])=>({id,network,name,programs:newsState!.channels.get(id)?.programs??[]}))};
}

async function getCableNewsChannels(guideId:string):Promise<ScheduleChannel[]>{
  seedFromSnapshot();
  startNewsTimer(guideId);
  if(!newsState)await kickNewsRefresh(guideId); // no snapshot at all: first fetch must wait
  const now=new Date();
  return NEWS_NETWORKS.map(([network,channelId,channelName])=>{
    const c=newsState?.channels.get(channelId);
    return {
      id:channelId,guideId,name:channelName,mediaType:'video' as MediaType,group:'News',
      logo:`https://archive.org/services/img/${network.split('|').pop()}`,
      programs:layoutDailySchedule((c?.programs??[]).map(p=>upsertCanonicalProgram(p)),5,now,320),
      sourceStatus:c?.status??'loading',rejected:c?.rejected,sourceError:c?.error,
    };
  });
}

/** TV News arrives as 282s clips (13 per hour). Merge the clips of one Archive
 *  item into a single full-length show block; the clips ride along in
 *  metadata.segments and the player walks them in order. */
export function groupClipPrograms(programs:Program[]):Program[]{
  const out:Program[]=[];const byItem=new Map<string,Program>();
  for(const p of programs){
    const m:any=p.metadata??{};
    const clip=m.clip;const ext=String(m.externalId??'');
    if(!clip||!/_c\d+$/.test(ext)){out.push(p);continue;}
    const item=ext.replace(/_c\d+$/,'');
    const seg={index:clip.index,start:clip.start,end:clip.end,archivePath:p.archivePath,mediaUrl:p.mediaUrl};
    const g=byItem.get(item);
    if(!g){
      const show=String(m.show??p.title).trim();
      const merged:Program={...p,id:`${p.id}:show`,title:String(p.title).replace(/\s+\d{2}:\d{2}$/,'')||show,
        description:`${p.description??''}`.replace(/\s*\(clip \d+\)$/,''),
        metadata:{...m,externalId:item,durationSource:'clips',durationSeconds:clip.end-clip.start,segments:[seg]}};
      byItem.set(item,merged);out.push(merged);continue;
    }
    const gm:any=g.metadata;gm.segments.push(seg);gm.durationSeconds+=clip.end-clip.start;
    if(p.endTimeUtc&&String(p.endTimeUtc)>String(g.endTimeUtc))Object.assign(g,{endTimeUtc:p.endTimeUtc,endTime:p.endTime,endHour:p.endHour});
  }
  for(const g of byItem.values()){const gm:any=g.metadata;gm.segments.sort((a:any,b:any)=>a.start-b.start);
    g.archivePath=gm.segments[0].archivePath;g.mediaUrl=gm.segments[0].mediaUrl;}
  return out;
}

/** Lay on-demand programs back-to-back across today's UTC day (repeating the
 *  list if it is shorter than 24h) so the grid shows real, non-zero slots. */
export function layoutDailySchedule(programs:Program[],defaultMinutes:number,now=new Date(),maxSlots=60):Program[]{
  if(programs.length===0)return[];
  const day=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate());
  const end=day+24*3600_000;
  const out:Program[]=[];let t=day;let slot=0;
  // Every program appears at least once (a long list may run past midnight);
  // a short list repeats until the day is full.
  while((slot<programs.length||t<end)&&slot<maxSlots){
    for(const p of programs){
      if((slot>=programs.length&&t>=end)||slot>=maxSlots)break;
      const secs=Number((p.metadata as any)?.durationSeconds)>0?Number((p.metadata as any).durationSeconds):defaultMinutes*60;
      const stop=slot<programs.length?t+secs*1000:Math.min(t+secs*1000,end);
      const h=(ms:number)=>(ms-day)/3600_000;
      out.push({...p,metadata:{...(p.metadata??{}),airedUtc:(p.metadata as any)?.airedUtc??p.startTimeUtc},id:`${p.id}:d${slot}`,startTimeUtc:new Date(t).toISOString(),endTimeUtc:new Date(stop).toISOString(),startTime:h(t),endTime:h(stop),startHour:h(t),endHour:h(stop)});
      t=stop;slot++;
    }
  }
  return out;
}

function toProxy(u?:string){return u&&u.startsWith('/download/')?`/api/archive/proxy?path=${encodeURIComponent(u)}`:u;}
/** Every program leaves the server with a playable URL: raw Archive paths go
 *  through the proxy (archivePath keeps the exact path for tracing). */
function normalizeChannels(chs:ScheduleChannel[]):ScheduleChannel[]{
  return chs.map(ch=>{
    const rejected=[...(ch.rejected??[])];
    const programs:Program[]=[];
    for(const p of ch.programs){
      // Eligibility gate: never publish a source the browser cannot stream.
      const bad=unplayableReason(p.archivePath??p.mediaUrl);
      if(bad){rejected.push({id:p.archivePath??p.mediaUrl??p.id,reason:bad});continue;}
      const segs=(p.metadata as any)?.segments;
      const q=Array.isArray(segs)?{...p,metadata:{...(p.metadata as any),segments:segs.map((sg:any)=>({...sg,archivePath:sg.archivePath??sg.mediaUrl,mediaUrl:toProxy(sg.mediaUrl??sg.archivePath)}))}}:p;
      programs.push(q.mediaUrl?.startsWith('/download/')?{...q,archivePath:q.archivePath??q.mediaUrl,mediaUrl:toProxy(q.mediaUrl)!}:q);
    }
    return {...ch,programs,rejected:rejected.length?rejected.slice(0,100):ch.rejected};
  });
}
export async function getScheduleForGuide(guideId='cable-tv'):Promise<ScheduleChannel[]>{
  return normalizeChannels(await getScheduleForGuideRaw(guideId));
}
async function getScheduleForGuideRaw(guideId='cable-tv'):Promise<ScheduleChannel[]>{
  const guide=getGuideById(guideId);if(!guide)return[];
  if(guideId==='cable-tv') return getCableNewsChannels(guideId);
  if(guideId==='live-tv') return getLiveTvChannels(guideId);
  if(guideId==='classic-tv'){
    const honeymooners=await buildHoneymoonersEpg();
    const highlights=await getDailyHighlightsChannels(guideId);
    return [{id:honeymooners.id,guideId,name:honeymooners.name,mediaType:'video',group:'Classic TV',programs:honeymooners.programs.map((program) => upsertCanonicalProgram(program))},...highlights];
  }
  if(guideId==='movies-classics-vault'){
    const programs=getCanonicalPrograms().filter((program)=>program.guideId===guideId && program.channelId==='classic-cinema');
    return [{
      id:'classic-cinema',
      guideId,
      name:'Cinema Classics Vault',
      mediaType:'video',
      group:'Movies',
      programs:layoutDailySchedule(programs,100),
    }];
  }
  if(guideId==='science-documentaries'){
    const programs=getCanonicalPrograms().filter((program)=>program.guideId===guideId && program.channelId==='nova-wonders');
    return [{id:'nova-wonders',guideId,name:'NOVA Science',mediaType:'video',group:'Documentaries',programs:layoutDailySchedule(programs,55)},
      ...getDocumentaryChannels().map(ch=>({id:ch.id,guideId,name:ch.name,mediaType:'video' as MediaType,group:'Documentaries',logo:ch.logo,programs:layoutDailySchedule(ch.programs,50)}))];
  }
  // Whole-day block anchored to 00:00 UTC. Using "now" here gave each request a new
  // program identity, so the program store grew on every /api/schedule call.
  const now=new Date();
  const dayStartUtc=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));
  return getChannelsByGuide(guideId).map(ch=>{
    const sourceUrl = ch.sources?.[0]?.url || '';
    const programId = normalizeProgramIdentity({ channelId:ch.id, title:ch.name, startTime:0 });
    const assetId = normalizeAssetIdentity({ programId, mediaUrl:sourceUrl });
    return {id:ch.id,guideId,name:ch.name,mediaType:ch.mediaType,group:ch.group,logo:ch.logo,programs:[upsertCanonicalProgram({id:programId,guideId,channelId:ch.id,title:ch.name,description:`Source: ${ch.name}`,startTime:0,endTime:24,startTimeUtc:dayStartUtc.toISOString(),endTimeUtc:new Date(dayStartUtc.getTime()+24*60*60*1000).toISOString(),startHour:0,endHour:24,mediaType:ch.mediaType,mediaUrl:sourceUrl,archivePath:sourceUrl,assetId,sourceClass:'m3u_live' as const,isArchivedSource:false,sourceId: ch.sources?.[0]?.id, metadata:{groupTitle:ch.group,tvgId:ch.tvgId}})]};
  });
}

export function addChannel(ch:Channel){channelsMap.set(ch.id,ch);}
export function setChannelSources(id:string,sources:ChannelSource[]){channelSourcesMap.set(id,sources);}
