import {
  Guide, Channel, ChannelSource, Program, Playlist, ScheduleChannel, MediaType,
} from './src/types';
import { getChannelSchedule } from './channels';
import { buildHoneymoonersEpg } from './collections/honeymooners-epg';
import { buildEpgIdentity, EpgIdentityResolutionError } from './src/utils/epgIdentity';
import { fetchAjnAudioIndex, fetchAjnFeed, type AjnFeedId } from './ajnResourceService';

export const GUIDES: Guide[] = [
  { id: 'cable-tv', name: 'Cable TV', type: 'video', enabled: true,
    description: '24-Hour Broadcast Television, Live News, and Classic Cinema Grid' },
  { id: 'classic-tv', name: 'Classic TV', type: 'video', enabled: true,
    description: 'Curated classic television collections resolved from Archive.org metadata' },
  { id: 'audio-podcasts', name: 'Audio & Podcasts', type: 'audio', enabled: true,
    description: 'Live radio streams, historic aerospace vaults, audio dramas, and podcasts' },
];

const channelsMap = new Map<string, Channel>();
const channelSourcesMap = new Map<string, ChannelSource[]>();
const playlistsMap = new Map<string, Playlist>();
const programsMap = new Map<string, Program>();
const programIdIndex = new Map<string, string[]>();
const MAX_PROGRAM_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function programRegistryKey(sourceId:string, programId:string):string {
  return `${sourceId}:${programId}`;
}

function logEpgIdentity(outcome:'AUTHORITATIVE_MATCH'|'DETERMINISTIC_FALLBACK'|'SANITY_REJECTED', detail:Record<string,unknown>){
  console.debug('[EpgIdentityLog]', { outcome, ...detail });
}

function pruneExpiredPrograms(maxLookbackMs = MAX_PROGRAM_RETENTION_MS): void {
  const cutoff = Date.now() - maxLookbackMs;
  for (const [key, program] of programsMap.entries()) {
    const endMs = Number.isFinite(program.endTime) && program.endTime > 1e11
      ? program.endTime
      : null;
    if (endMs !== null && endMs < cutoff) {
      programsMap.delete(key);
      const [, programId] = key.split(':', 2);
      const indexed = programIdIndex.get(programId);
      if (indexed) {
        const next = indexed.filter((candidateKey) => candidateKey !== key);
        if (next.length) programIdIndex.set(programId, next); else programIdIndex.delete(programId);
      }
    }
  }
}


function upsertCanonicalProgram(candidate:{
  guideId:string; channelId:string; title:string; mediaUrl:string; mediaType:MediaType;
  sourceId?:string; programId?:string; assetId?:string; archiveIdentifier?:string; publishedAt?:string;
  startTime?:number; endTime?:number; startTimeUtc?:number; endTimeUtc?:number;
  description?:string; metadata?:Record<string,unknown>;
  sourceClass?: 'archive_org' | 'ajn_archive' | 'ajn_rss' | 'm3u_live';
  isArchivedSource?: boolean;
}): Program | null {
  try {
    const identity = buildEpgIdentity(candidate);
    const key = programRegistryKey(identity.sourceId, identity.programId);
    const existing = programsMap.get(key);
    const program:Program = {
      ...(existing || {}),
      id: identity.programId,
      guideId: candidate.guideId,
      channelId: candidate.channelId,
      title: candidate.title,
      description: candidate.description,
      startTime: candidate.startTime ?? existing?.startTime ?? 0,
      endTime: candidate.endTime ?? existing?.endTime ?? 24,
      mediaType: candidate.mediaType,
      mediaUrl: candidate.mediaUrl,
      archivePath: candidate.mediaUrl,
      sourceId: identity.sourceId,
      assetId: identity.assetId,
      publishedAt: candidate.publishedAt,
      archiveIdentifier: candidate.archiveIdentifier,
      metadata: { ...(existing?.metadata || {}), ...(candidate.metadata || {}) },
      sourceClass: existing?.sourceClass ?? candidate.sourceClass,
      isArchivedSource: existing?.isArchivedSource ?? candidate.isArchivedSource,
    };
    programsMap.set(key, program);
    const indexedKeys = programIdIndex.get(identity.programId) || [];
    if (!indexedKeys.includes(key)) indexedKeys.push(key);
    programIdIndex.set(identity.programId, indexedKeys);
    pruneExpiredPrograms();
    logEpgIdentity(candidate.programId ? 'AUTHORITATIVE_MATCH' : 'DETERMINISTIC_FALLBACK', {
      guideId: candidate.guideId, channelId: candidate.channelId, sourceId: identity.sourceId,
      programId: identity.programId, assetId: identity.assetId,
    });
    return program;
  } catch (error) {
    logEpgIdentity('SANITY_REJECTED', {
      guideId: candidate.guideId, channelId: candidate.channelId,
      reason: error instanceof EpgIdentityResolutionError ? error.message : String(error),
    });
    return null;
  }
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

function channelId(value:string):string { return value.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }

export function ingestM3uPlaylist(playlist:Playlist,text:string,targetGuideId?:string){
  const entries=parseM3u(text); const updated:Channel[]=[];
  const guideId=targetGuideId || (playlist.category.toLowerCase().includes('audio')?'audio-podcasts':'cable-tv');
  const mediaType:MediaType=guideId==='audio-podcasts'?'audio':'video';
  for(const entry of entries){
    const id=channelId(entry.tvgId || entry.tvgName || entry.title); const existing=channelsMap.get(id);
    const sourceId = `src-${channelId(guideId)}-${id}`;
    const ch:Channel=existing?{...existing,logo:existing.logo||entry.tvgLogo,group:existing.group||entry.groupTitle||playlist.category}
      :{id,guideId,name:entry.tvgName||entry.title,mediaType,logo:entry.tvgLogo,group:entry.groupTitle||playlist.category,tvgId:entry.tvgId,tvgName:entry.tvgName,enabled:true};
    channelsMap.set(id,ch); updated.push(ch); const sources=channelSourcesMap.get(id)||[];
    upsertCanonicalProgram({
      guideId, channelId:id, sourceId, title:entry.title, mediaUrl:entry.url,
      mediaType, startTime:0, endTime:24,
      sourceClass:'m3u_live', isArchivedSource:false,
      metadata:{ playlistId:playlist.id, playlistName:playlist.name, tvgId:entry.tvgId, tvgName:entry.tvgName, tvgLogo:entry.tvgLogo, groupTitle:entry.groupTitle },
    });
    if(!sources.some(s=>s.url===entry.url)){
      sources.push({id:`src-${id}-${sources.length+1}`,channelId:id,protocol:entry.url.includes('.m3u8')?'hls':'https',url:entry.url,priority:sources.length+1,enabled:true,metadata:{playlistId:playlist.id,playlistName:playlist.name,category:playlist.category,durationSeconds:entry.duration&&entry.duration>0?entry.duration:undefined}});
      channelSourcesMap.set(id,sources);
    }
  }
  playlist.lastSyncedAt=new Date().toISOString(); playlist.syncStatus='synced'; playlist.itemCount=entries.length; playlist.rawM3u=text; playlistsMap.set(playlist.id,playlist);
  return {ingestedCount:entries.length,channels:updated};
}

export function initializeRegistry(){ if(playlistsMap.size)return; for(const {playlist,m3uContent} of INITIAL_PLAYLISTS){playlistsMap.set(playlist.id,playlist);ingestM3uPlaylist(playlist,m3uContent);} }
initializeRegistry();

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
  const existing=channelSourcesMap.get(channelId)||[]; const created:ChannelSource={id:source.id||`src-${channelId}-${existing.length+1}`,channelId,protocol:source.protocol||(source.url?.includes('.m3u8')?'hls':'https'),url:source.url||'',priority:source.priority??existing.length+1,enabled:source.enabled??true,metadata:source.metadata};
  existing.push(created); channelSourcesMap.set(channelId,existing); return created;
}
export function getAllPlaylists(){return Array.from(playlistsMap.values());}
export function getPlaylistById(id:string){return playlistsMap.get(id);}
export function syncPlaylist(id:string,customM3u?:string){const p=playlistsMap.get(id);if(!p)return{success:false};const text=customM3u||p.rawM3u||'';if(!text){p.syncStatus='failed';return{success:false,playlist:p};}const r=ingestM3uPlaylist(p,text);return{success:true,playlist:p,count:r.ingestedCount};}

export function ingestAjnFeedItems(items: Array<{
  feedId: AjnFeedId;
  title: string;
  url: string;
  mediaType: MediaType;
  publishedAt?: string;
  description?: string;
  metadata: Record<string, string>;
  sourceId: string;
  programId: string;
  assetId: string;
}>): Promise<Program[]> {
  return items
    .map((item) => upsertCanonicalProgram({
      guideId:'ajn-archive-special-feeds', channelId:`ajn-${item.feedId}`,
      sourceId:item.sourceId, programId:item.programId, assetId:item.assetId,
      title:item.title, mediaUrl:item.url, mediaType:item.mediaType,
      startTime:0, endTime:24, publishedAt:item.publishedAt, description:item.description,
      sourceClass:'ajn_rss', isArchivedSource:false,
      metadata:{ ...item.metadata, feedId:item.feedId },
    }))
    .filter((program): program is Program => Boolean(program));
}

export async function getAjnScheduleForFeed(feedId?: AjnFeedId): Promise<ScheduleChannel[]> {
  const feedIds: AjnFeedId[] = feedId ? [feedId] : ['Alex','WarRoom','SundayLive','AJNHourlyVideo','AJNHourlyAudio'];
  const rssResults = await Promise.all(feedIds.map((id) => fetchAjnFeed(id)));
  const audioResults = feedId && feedId !== 'AJNHourlyAudio' ? [] : await Promise.all([fetchAjnAudioIndex('hourly'), fetchAjnAudioIndex('segment')]);
  const programs = await ingestAjnFeedItems([...rssResults.flatMap((result) => result.items), ...audioResults.flatMap((result) => result.items)]);
  const byChannel = new Map<string, Program[]>();
  for (const program of programs) {
    const list = byChannel.get(program.channelId) || [];
    list.push(program);
    byChannel.set(program.channelId, list);
  }
  return [...byChannel.entries()].map(([channelId, channelPrograms]) => ({
    id:channelId, guideId:'ajn-archive-special-feeds', name:channelId.replace(/^ajn-/, ''),
    mediaType:channelPrograms[0]?.mediaType || 'audio', group:'AJN RSS',
    programs:channelPrograms.map((program) => ({ ...program, startHour:program.startTime, endHour:program.endTime })),
  }));
}

export async function getScheduleForGuide(guideId='cable-tv'):Promise<ScheduleChannel[]>{
  if(guideId==='ajn-archive-special-feeds') return getAjnScheduleForFeed();
  const guide=getGuideById(guideId);if(!guide)return[];
  if(guideId==='cable-tv'){
    const news=await getChannelSchedule();
    return news.map(ch=>({
      id:ch.id,guideId,name:ch.name,mediaType:'video' as MediaType,group:'News',logo:`https://archive.org/services/img/${ch.id}`,
      programs:ch.programs.map((p:any,index:number)=>{
        const program = upsertCanonicalProgram({
          guideId, channelId:ch.id, sourceId:`src-${guideId}-${ch.id}`, title:p.title, mediaUrl:p.archivePath,
          mediaType:'video', startTime:p.startHour, endTime:p.endHour,
          startTimeUtc:p.startTimeUtc, endTimeUtc:p.endTimeUtc,
          archiveIdentifier:p.archivePath.split('?')[0],
          sourceClass:'archive_org', isArchivedSource:true,
          metadata:{ provider:'archive', scheduleIndex:index },
        });
        return program ? {...program,startHour:p.startHour,endHour:p.endHour} : null;
      }).filter(Boolean) as Program[],
    }));
  }
  if(guideId==='classic-tv'){
    const honeymooners=await buildHoneymoonersEpg();
    const programs = honeymooners.programs.map((program) => upsertCanonicalProgram({
      guideId,
      channelId: honeymooners.id,
      sourceId: program.sourceId,
      programId: program.id,
      assetId: program.assetId,
      title: program.title,
      mediaUrl: program.mediaUrl,
      mediaType: program.mediaType,
      startTime: program.startTime,
      endTime: program.endTime,
      archiveIdentifier: program.archiveIdentifier,
      description: program.description,
      sourceClass:'archive_org', isArchivedSource:true,
      metadata: program.metadata,
    })).filter(Boolean).map((program) => ({
      ...program!,
      startHour: program!.startTime,
      endHour: program!.endTime,
    })) as Program[];
    return [{id:honeymooners.id,guideId,name:honeymooners.name,mediaType:'video',group:'Classic TV',programs}];
  }
  return getChannelsByGuide(guideId).map(ch=>{
    const mediaUrl = ch.sources?.[0]?.url || '';
    const program = mediaUrl ? upsertCanonicalProgram({
      guideId, channelId:ch.id, sourceId:`src-${guideId}-${ch.id}`, title:ch.name, mediaUrl,
      mediaType:ch.mediaType, startTime:0, endTime:24,
      sourceClass:'m3u_live', isArchivedSource:false,
    }) : null;
    return {id:ch.id,guideId,name:ch.name,mediaType:ch.mediaType,group:ch.group,logo:ch.logo,programs:program ? [{...program,startHour:0,endHour:24}] : []};
  });
}

export function addChannel(ch:Channel){channelsMap.set(ch.id,ch);}
export function setChannelSources(id:string,sources:ChannelSource[]){channelSourcesMap.set(id,sources);}
export function getCanonicalEpgPrograms(): Program[]{ return Array.from(programsMap.values()); }
export function getCanonicalEpgProgram(sourceId:string, programId:string): Program | undefined { return programsMap.get(programRegistryKey(sourceId, programId)); }
export function getCanonicalEpgProgramById(programId:string): Program | undefined {
  const keys = programIdIndex.get(programId);
  if (!keys || keys.length !== 1) return undefined;
  return programsMap.get(keys[0]);
}
