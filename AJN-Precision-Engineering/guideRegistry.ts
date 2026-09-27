import {
  Guide, Channel, ChannelSource, Program, Playlist, ScheduleChannel, MediaType,
} from './src/types';
import { tryResolveArchiveMediaCandidates } from './channels';
import { archiveNewsContract, NEWS_NETWORKS, type ArchiveNewsInput } from './server/sources/archiveNews';
import { runSources } from './server/sources/runner';
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
export async function refreshMoviesClassicsFromArchive(){
  const {items,report}=await resolveMoviesClassicsManifest(moviesClassicsManifest,tryResolveArchiveMediaCandidates);
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
export function setHighlightsFetchForTests(impl?:typeof fetch){highlightsFetch=impl;highlightsCache=null;}

/** Classic TV shows from archive.org/download/daily-highlights (folders + M3Us). */
async function getDailyHighlightsChannels(guideId:string):Promise<ScheduleChannel[]>{
  if(highlightsCache&&Date.now()<highlightsCache.expiresAt)return highlightsCache.data;
  const [r]=await runSources([{contract:dailyHighlightsContract,input:{guideId,fetchImpl:highlightsFetch}}],{timeoutMs:25_000});
  const data:ScheduleChannel[]=r.programs.length
    ? highlightChannels(r.programs).map(ch=>({id:ch.id,guideId,name:ch.name,mediaType:'video' as MediaType,group:'Classic TV',programs:layoutDailySchedule(ch.programs,30),sourceStatus:r.status,rejected:r.rejected}))
    : [{id:'classic-daily-highlights',guideId,name:'Daily Highlights',mediaType:'video' as MediaType,group:'Classic TV',programs:[],sourceStatus:r.status,rejected:r.rejected,sourceError:r.error}];
  highlightsCache={data,expiresAt:Date.now()+(r.programs.length?60*60_000:60_000)};
  return data;
}

let cableNewsCache:{data:ScheduleChannel[];expiresAt:number}|null=null;
let cableNewsFetch:typeof fetch|undefined;
export function setCableNewsFetchForTests(impl?:typeof fetch){cableNewsFetch=impl;cableNewsCache=null;cableNewsLastGood=new Map();}

let cableNewsLastGood=new Map<string,Program[]>();
let cableNewsRefreshing:Promise<void>|null=null;

/** Cable TV news: last 48h of Archive TV News, laid back-to-back across today so
 *  every network row is always filled and plays 24/7. A network whose refresh
 *  fails or comes back empty keeps its last good clips (marked stale). */
async function refreshCableNews(guideId:string):Promise<ScheduleChannel[]>{
  const jobs=NEWS_NETWORKS.map(([network,channelId,channelName])=>({
    contract:archiveNewsContract,
    input:{network,channelId,channelName,guideId,rows:12,windowDays:2,fetchImpl:cableNewsFetch} as ArchiveNewsInput,
  }));
  const results=await runSources(jobs,{timeoutMs:25_000,parallel:true});
  const data:ScheduleChannel[]=results.map((r,i)=>{
    const [network,channelId,channelName]=NEWS_NETWORKS[i];
    let programs=r.programs.map(p=>upsertCanonicalProgram(p));
    let sourceStatus:string=r.status, sourceError=r.error;
    if(programs.length){cableNewsLastGood.set(channelId,programs);}
    else if(cableNewsLastGood.get(channelId)?.length){
      programs=cableNewsLastGood.get(channelId)!;
      sourceStatus='stale';
      sourceError=`showing last known clips; refresh: ${r.error ?? r.status}`;
    }
    // Oldest first so the day plays in broadcast order, then loops.
    const ordered=[...programs].sort((a,b)=>String(a.startTimeUtc).localeCompare(String(b.startTimeUtc)));
    return {
      id:channelId,guideId,name:channelName,mediaType:'video' as MediaType,group:'News',
      logo:`https://archive.org/services/img/${network}`,
      programs:layoutDailySchedule(ordered,5,new Date(),320),
      sourceStatus,rejected:r.rejected,sourceError,
    };
  });
  const complete=data.every(ch=>ch.programs.length>0&&ch.sourceStatus!=='stale');
  cableNewsCache={data,expiresAt:Date.now()+(complete?15*60_000:60_000)};
  return data;
}

async function getCableNewsChannels(guideId:string):Promise<ScheduleChannel[]>{
  if(cableNewsCache&&Date.now()<cableNewsCache.expiresAt)return cableNewsCache.data;
  // Serve the previous grid immediately while a refresh runs in the background.
  if(cableNewsCache){
    if(!cableNewsRefreshing)cableNewsRefreshing=refreshCableNews(guideId).then(()=>{}).catch(()=>{}).finally(()=>{cableNewsRefreshing=null;});
    return cableNewsCache.data;
  }
  return refreshCableNews(guideId);
}

/** Lay on-demand programs back-to-back across today's UTC day (repeating the
 *  list if it is shorter than 24h) so the grid shows real, non-zero slots. */
export function layoutDailySchedule(programs:Program[],defaultMinutes:number,now=new Date(),maxSlots=150):Program[]{
  if(programs.length===0)return[];
  const day=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate());
  const end=day+24*3600_000;
  const out:Program[]=[];let t=day;let slot=0;
  while(t<end&&slot<maxSlots){
    for(const p of programs){
      if(t>=end||slot>=maxSlots)break;
      const secs=Number((p.metadata as any)?.durationSeconds)>0?Number((p.metadata as any).durationSeconds):defaultMinutes*60;
      const stop=Math.min(t+secs*1000,end);
      const h=(ms:number)=>(ms-day)/3600_000;
      out.push({...p,metadata:{...(p.metadata??{}),airedUtc:(p.metadata as any)?.airedUtc??p.startTimeUtc},id:`${p.id}:d${slot}`,startTimeUtc:new Date(t).toISOString(),endTimeUtc:new Date(stop).toISOString(),startTime:h(t),endTime:h(stop),startHour:h(t),endHour:h(stop)});
      t=stop;slot++;
    }
  }
  return out;
}

export async function getScheduleForGuide(guideId='cable-tv'):Promise<ScheduleChannel[]>{
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
