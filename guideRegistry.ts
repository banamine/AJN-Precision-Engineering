import {
  Guide, Channel, ChannelSource, Program, Playlist, ScheduleChannel, MediaType,
} from './src/types';
import { getChannelSchedule } from './channels';

export const GUIDES: Guide[] = [
  { id: 'cable-tv', name: 'Cable TV', type: 'video', enabled: true,
    description: '24-Hour Broadcast Television, Live News, and Classic Cinema Grid' },
  { id: 'audio-podcasts', name: 'Audio & Podcasts', type: 'audio', enabled: true,
    description: 'Live radio streams, historic aerospace vaults, audio dramas, and podcasts' },
];

const channelsMap = new Map<string, Channel>();
const channelSourcesMap = new Map<string, ChannelSource[]>();
const playlistsMap = new Map<string, Playlist>();

const INITIAL_PLAYLISTS: { playlist: Playlist; m3uContent: string }[] = [
  {
    playlist: {
      id: 'playlist-news',
      name: 'Broadcast TV News Networks',
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
/download/OTRR_Mercury_Theater_on_the_Air_Singles/Mercury_381030_WarOfTheWorlds.mp3
#EXTINF:-1 tvg-id="global-news-radio" tvg-name="Global News Radio" group-title="News Radio",Global News Radio
/download/Apollo11AudioHighlights/apollo_11_audio_highlights_64kb.mp3`,
  },
];

export interface ParsedM3uEntry {
  title:string; url:string; tvgId?:string; tvgName?:string; tvgLogo?:string;
  groupTitle?:string; duration?:number;
}

export function parseM3u(text:string):ParsedM3uEntry[] {
  const lines=text.split(/\r?\n/); const out:ParsedM3uEntry[]=[]; let cur:Partial<ParsedM3uEntry>|null=null;
  for (const raw of lines) {
    const line=raw.trim(); if(!line) continue;
    if(line.startsWith('#EXTINF:')) {
      cur={};
      const comma=line.lastIndexOf(',');
      if(comma>=0) cur.title=line.slice(comma+1).trim();
      const m=(name:string)=>line.match(new RegExp(`${name}=["']([^"']+)["']`,'i'))?.[1];
      cur.tvgId=m('tvg-id'); cur.tvgName=m('tvg-name'); cur.tvgLogo=m('tvg-logo'); cur.groupTitle=m('group-title');
      cur.duration=Number(line.match(/^#EXTINF:(-?\d+)/)?.[1] ?? 0);
    } else if(!line.startsWith('#') && cur) {
      cur.url=line;
      if(cur.title) out.push(cur as ParsedM3uEntry);
      cur=null;
    }
  }
  return out;
}

function channelId(value:string):string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
}

export function ingestM3uPlaylist(playlist:Playlist, text:string, targetGuideId?:string) {
  const entries=parseM3u(text); const updated:Channel[]=[];
  const guideId=targetGuideId || (playlist.category.toLowerCase().includes('audio')?'audio-podcasts':'cable-tv');
  const mediaType:MediaType=guideId==='audio-podcasts'?'audio':'video';

  for(const entry of entries) {
    const id=channelId(entry.tvgId || entry.tvgName || entry.title);
    const existing=channelsMap.get(id);
    const ch:Channel=existing ? {...existing, logo:existing.logo||entry.tvgLogo, group:existing.group||entry.groupTitle||playlist.category}
      : {id, guideId, name:entry.tvgName || entry.title, mediaType, logo:entry.tvgLogo,
         group:entry.groupTitle||playlist.category, tvgId:entry.tvgId, tvgName:entry.tvgName, enabled:true};
    channelsMap.set(id,ch); updated.push(ch);
    const sources=channelSourcesMap.get(id)||[];
    if(!sources.some(s=>s.url===entry.url)) {
      sources.push({
        id:`src-${id}-${sources.length+1}`, channelId:id,
        protocol:entry.url.includes('.m3u8')?'hls':'https', url:entry.url,
        priority:sources.length+1, enabled:true,
        metadata:{playlistId:playlist.id, playlistName:playlist.name, category:playlist.category,
          durationSeconds: entry.duration && entry.duration>0 ? entry.duration : undefined},
      });
      channelSourcesMap.set(id,sources);
    }
  }
  playlist.lastSyncedAt=new Date().toISOString(); playlist.syncStatus='synced';
  playlist.itemCount=entries.length; playlist.rawM3u=text; playlistsMap.set(playlist.id,playlist);
  return {ingestedCount:entries.length,channels:updated};
}

export function initializeRegistry() {
  if(playlistsMap.size) return;
  for(const {playlist,m3uContent} of INITIAL_PLAYLISTS) {
    playlistsMap.set(playlist.id,playlist); ingestM3uPlaylist(playlist,m3uContent);
  }
}
initializeRegistry();

export function getAllGuides(){return GUIDES;}
export function getGuideById(id:string){return GUIDES.find(g=>g.id===id);}
export function getChannelsByGuide(id?:string){
  return Array.from(channelsMap.values()).filter(c=>!id||c.guideId===id)
    .map(c=>({...c,sources:channelSourcesMap.get(c.id)||[]}));
}
export function getChannelById(id:string){
  const c=channelsMap.get(id); return c?{...c,sources:channelSourcesMap.get(id)||[]}:undefined;
}
export function getChannelSources(id:string){return channelSourcesMap.get(id)||[];}
export function addChannelSource(channelId:string, source:Partial<ChannelSource>) {
  const existing=channelSourcesMap.get(channelId)||[];
  const created:ChannelSource={id:source.id||`src-${channelId}-${existing.length+1}`,channelId,
    protocol:source.protocol||(source.url?.includes('.m3u8')?'hls':'https'),url:source.url||'',
    priority:source.priority??existing.length+1,enabled:source.enabled??true,metadata:source.metadata};
  existing.push(created); channelSourcesMap.set(channelId,existing); return created;
}
export function getAllPlaylists(){return Array.from(playlistsMap.values());}
export function getPlaylistById(id:string){return playlistsMap.get(id);}
export function syncPlaylist(id:string,customM3u?:string){
  const p=playlistsMap.get(id); if(!p) return {success:false};
  const text=customM3u||p.rawM3u||''; if(!text){p.syncStatus='failed';return {success:false,playlist:p};}
  const r=ingestM3uPlaylist(p,text); return {success:true,playlist:p,count:r.ingestedCount};
}

/**
 * News EPG is sourced directly from the real Archive-backed discovery provider.
 * It intentionally does NOT derive News program titles from playlist metadata.
 */
export async function getScheduleForGuide(guideId='cable-tv'):Promise<ScheduleChannel[]> {
  const guide=getGuideById(guideId); if(!guide) return [];
  if(guideId==='cable-tv') {
    const news=await getChannelSchedule();
    return news.map(ch=>({
      id:ch.id, guideId, name:ch.name, mediaType:'video' as MediaType,
      group:'News', logo:`https://archive.org/services/img/${ch.id}`, 
      programs:ch.programs.map((p:any,index:number)=>({
        id:`${ch.id}-${index+1}`, guideId, channelId:ch.id,
        title:p.title, description:`Archive.org broadcast: ${p.title}`,
        startTime:p.startHour, endTime:p.endHour, startHour:p.startHour, endHour:p.endHour,
        mediaType:'video' as MediaType, mediaUrl:p.archivePath, archivePath:p.archivePath,
      }))
    }));
  }
  return getChannelsByGuide(guideId).map(ch=>({
    id:ch.id, guideId, name:ch.name, mediaType:ch.mediaType, group:ch.group, logo:ch.logo,
    programs:[{
      id:`${ch.id}-1`, guideId, channelId:ch.id, title:ch.name,
      description:`Source: ${ch.name}`, startTime:0,endTime:24,startHour:0,endHour:24,
      mediaType:ch.mediaType,mediaUrl:ch.sources?.[0]?.url||'',archivePath:ch.sources?.[0]?.url||''
    }]
  }));
}

export function addChannel(ch: Channel) {
  channelsMap.set(ch.id, ch);
}

export function setChannelSources(id: string, sources: ChannelSource[]) {
  channelSourcesMap.set(id, sources);
}
