import { clearAppData } from './src/components/DevModeView';
const data = new Map<string,string>([['ajn.recentlyPlayed.v1','[]'],['ajn.recentSearches.v1','[]'],['ajn-playback-position:x','5']]);
const fake = { get length(){ return data.size; }, clear(){ data.clear(); } };
let fail = 0; const ok=(c:boolean,m:string)=>{ if(!c){fail++;console.error('FAIL',m);} else console.log('ok',m); };
ok(clearAppData(fake)===3,'returns count removed'); ok(data.size===0,'storage emptied');
ok(clearAppData(null)===null,'null storage -> null');
ok(clearAppData({length:1,clear(){throw new Error('x');}})===null,'throwing storage -> null');
process.exit(fail?1:0);
