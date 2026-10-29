import { clearAppData } from './src/components/DevModeView';
// clearAppData removes only this app's keys (prefix "ajn", case-insensitive) and leaves other keys on the same origin alone.
const data = new Map<string,string>([['ajn.recentlyPlayed.v1','[]'],['ajn.recentSearches.v1','[]'],['ajn-playback-position:x','5'],['AJN.upper','x'],['other-app-key','keep']]);
const fake = { get length(){ return data.size; }, key(i:number){ return [...data.keys()][i] ?? null; }, removeItem(k:string){ data.delete(k); } };
let fail = 0; const ok=(c:boolean,m:string)=>{ if(!c){fail++;console.error('FAIL',m);} else console.log('ok',m); };
ok(clearAppData(fake)===4,'returns count of ajn* keys removed'); ok(data.size===1 && data.has('other-app-key'),'non-ajn keys are kept');
ok(clearAppData(null)===null,'null storage -> null');
ok(clearAppData({length:1,key(){throw new Error('x');},removeItem(){}})===null,'throwing storage -> null');
process.exit(fail?1:0);
