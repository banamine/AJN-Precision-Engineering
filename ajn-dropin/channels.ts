/**
 * channels.ts — real Archive.org-backed News discovery.
 * News EPG titles come from the Archive identifier/program metadata.
 * No playlist name is used as a News program title.
 */

export interface NetworkChannelConfig { id:string; displayName:string; network:string; }
export const NETWORK_CHANNELS:NetworkChannelConfig[]=[
  {id:"fox-news",displayName:"Fox News",network:"FOXNEWSW"},
  {id:"cnn",displayName:"CNN",network:"CNNW"},
  {id:"msnbc",displayName:"MSNBC",network:"MSNBCW"},
  {id:"bbc",displayName:"BBC News",network:"BBCNEWS"},
  {id:"ntd",displayName:"NTD News",network:"NTD"},
];

export interface TVNewsItem {
 identifier:string; title:string; network:string; program:string; date:string; time:string;
 durationMins:number; thumbnailUrl:string; publicdate:string;
 airDateSource:"identifier"|"publicdate"; description?:string;
}
export const TV_ID_RE=/^([A-Z0-9]+)_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_(.+)$/;
export function getCollectionCandidates(network:string){const n=network.trim().replace(/^TV-/i,"");return[n,`TV-${n}`];}

async function probe(collection:string,opts:any){
 const today=new Date().toISOString().slice(0,10);
 const end=(opts.endDate||today).slice(0,10);
 const parts=[`collection:${collection}`];
 if(opts.query?.trim()) parts.push(`title:(${opts.query.trim()})`);
 parts.push(`date:[${opts.startDate?.includes('T')?opts.startDate:'*'} TO ${end}T23:59:59Z]`);
 const q=parts.join(' AND ');
 const url='https://archive.org/advancedsearch.php?'+new URLSearchParams({
   q,fl:'identifier,title,addeddate,publicdate,description,subject',
   rows:String(Math.min(opts.rows??50,50)),start:String(opts.start??0),sort:'addeddate desc',output:'json'
 }).toString();
 console.log(`[ARCHIVE NEWS] collection:${collection} query=${q}`);
 try {
   const r=await fetch(url,{headers:{'User-Agent':'AJN-Precision-Engineering/1.0'}});
   const body=await r.text(); let data:any;
   try{data=JSON.parse(body)}catch{return {ok:false,total:0,docs:[]};}
   const total=Number(data.response?.numFound??0), docs=Array.isArray(data.response?.docs)?data.response.docs:[];
   console.log(`[ARCHIVE NEWS] collection:${collection} HTTP ${r.status} results=${total}`);
   return {ok:r.ok&&!data.error,total,docs};
 } catch(e){console.error(`[ARCHIVE NEWS] collection:${collection} error`,e);return{ok:false,total:0,docs:[]};}
}

export async function searchTVNews(opts:{network:string;query?:string;startDate?:string;endDate?:string;rows?:number;start?:number}) {
 for(const collection of getCollectionCandidates(opts.network)){
   const result=await probe(collection,opts);
   if(result.ok&&result.total>0){
     const today=new Date().toISOString().slice(0,10);
     const items:TVNewsItem[]=result.docs.map((doc:any)=>{
       const id=String(doc.identifier??''), m=id.match(TV_ID_RE);
       const raw=doc.description??doc.subject;
       const description=raw?(Array.isArray(raw)?String(raw[0]):String(raw)).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim()||undefined:undefined;
       return {
         identifier:id,title:String(doc.title??id),network:m?m[1]:(id.split('_')[0]??''),
         date:m?`${m[2]}-${m[3]}-${m[4]}`:String(doc.publicdate??doc.addeddate??'').slice(0,10),
         time:m?`${m[5]}:${m[6]}`:'Unknown',
         program:m?m[8].replace(/_/g,' '):String(doc.title??id),
         durationMins:60,thumbnailUrl:`https://archive.org/services/img/${id}`,
         publicdate:String(doc.publicdate??doc.addeddate??'').slice(0,10),
         airDateSource:m?'identifier':'publicdate',...(description?{description}:{})
       };
     });
     return {items,total:result.total,safeEndDate:today};
   }
 }
 console.warn(`[channels] no verified Archive collection for ${opts.network}`);
 return {items:[],total:0,safeEndDate:new Date().toISOString().slice(0,10)};
}

export function getSafeArchiveUrl(rawUrl:string){
 try{
   const u=new URL(rawUrl.replace(/^http:\/\//i,'https://').replace('/embed/','/download/'));
   u.searchParams.delete('ignore');
   const parts=u.pathname.replace(/\/$/,'').split('/');
   const last=parts[parts.length-1];
   if(!last.includes('.')) u.pathname+=`/${last}.mp4`;
   if(TV_ID_RE.test(parts[parts.length-2]||'')||TV_ID_RE.test(last.replace(/\.[^.]+$/,''))){
     if(!u.searchParams.has('start')&&!u.searchParams.has('end')){u.searchParams.set('start','0');u.searchParams.set('end','300');}
   }
   return u.toString();
 }catch{return rawUrl;}
}

function toProxyPath(fullUrl:string){try{const u=new URL(fullUrl);return u.pathname+u.search}catch{return fullUrl;}}

const METADATA_TIMEOUT_MS = 12000;

async function fetchArchiveMetadata(identifier:string){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),METADATA_TIMEOUT_MS);
 try{
   const r=await fetch(`https://archive.org/metadata/${encodeURIComponent(identifier)}`,{
     headers:{"User-Agent":"AJN-Precision-Engineering/1.0","Accept":"application/json"},
     signal:controller.signal,
   });
   if(!r.ok)return null;
   return await r.json();
 }catch(error){
   console.warn(`[channels] metadata failed for ${identifier}`,error);
   return null;
 }finally{
   clearTimeout(timer);
 }
}

function choosePlayableMp4(meta:any):{name:string;durationMins:number}|null{
 const files=Array.isArray(meta?.files)?meta.files:[];
 const candidates=files
   .map((file:any)=>({file,name:String(file?.name??"")}))
   .filter(({name})=>/\.(mp4|m4v)$/i.test(name))
   .filter(({file})=>String(file?.private??"0")!=="1")
   .sort((a,b)=>Number(b.file?.size??0)-Number(a.file?.size??0));
 if(!candidates.length)return null;
 const selected=candidates[0];
 const rawDuration=Number(selected.file?.length??selected.file?.duration??0);
 const durationMins=Number.isFinite(rawDuration)&&rawDuration>0
   ? Math.max(1,Math.min(180,rawDuration/60))
   : 60;
 return {name:selected.name,durationMins};
}

async function resolveNewsFile(identifier:string){
 const meta=await fetchArchiveMetadata(identifier);
 const playable=choosePlayableMp4(meta);
 if(!playable)return null;
 // Use the real filename reported by Archive metadata. Never manufacture
 // `{identifier}.mp4` and never bake TV-News slice parameters into discovery.
 return {
   path:`/download/${identifier}/${encodeURIComponent(playable.name).replace(/%2F/g,"/")}`,
   durationMins:playable.durationMins,
 };
}

export interface ScheduleProgram { title:string; startHour:number; endHour:number; archivePath:string; }
export interface ScheduleChannel { id:string; name:string; programs:ScheduleProgram[]; }

const CACHE_TTL_MS=15*60*1000;
let cache:{data:ScheduleChannel[];expiresAt:number}|null=null;

/**
 * Deterministic placement of distinct discovered broadcasts.
 * We preserve one program per discovered Archive item and its actual duration.
 * We do not duplicate a single result to fill the day.
 */
async function itemsToProgramBlocks(items:TVNewsItem[]):Promise<ScheduleProgram[]>{
 const distinct=[...new Map(items.map(i=>[i.identifier,i])).values()];
 const resolved=await Promise.all(distinct.map(async item=>({item,resolution:await resolveNewsFile(item.identifier)})));
 let cursor=0;
 return resolved.filter(({resolution})=>resolution!==null).map(({item,resolution})=>{
   const durationMins=resolution!.durationMins||item.durationMins||60;
   const duration=Math.max(1,Math.min(24,cursor+durationMins/60)-cursor);
   const start=cursor, end=Math.min(24,cursor+duration);
   cursor=end;
   return {title:item.program||item.title||item.identifier,startHour:start,endHour:end,archivePath:resolution!.path};
 }).filter(p=>p.endHour>p.startHour);
}

export async function getChannelSchedule():Promise<ScheduleChannel[]>{
 if(cache&&Date.now()<cache.expiresAt)return cache.data;

 // Archive.org is intentionally queried serially here. The schedule endpoint
 // is user-facing, but it is not a license to create a five-channel request
 // burst. Each channel is allowed to complete before the next begins.
 const results:ScheduleChannel[]=[];
 for(const c of NETWORK_CHANNELS){
   try{
     const r=await searchTVNews({network:c.network,rows:12});
     const programs=await itemsToProgramBlocks(r.items);
     results.push({id:c.id,name:c.displayName,programs});
   }catch(error){
     console.error(`[channels] ${c.displayName} discovery failed`,error);
     results.push({id:c.id,name:c.displayName,programs:[]});
   }
 }
 cache={data:results,expiresAt:Date.now()+CACHE_TTL_MS}; return results;
}
