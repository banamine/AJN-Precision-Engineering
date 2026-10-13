const { chromium } = require('playwright-core');
const BASE=(process.env.BASE||'http://localhost:3000').replace(/\/$/,'');const GUIDE=process.argv[2]||'classic-tv';
(async()=>{
 const sched=await (await fetch(`${BASE}/api/schedule?guide=${GUIDE}`,{headers:{'accept-encoding':'gzip'}})).json();
 const chs=sched.channels;const pick=chs[Math.floor(chs.length*0.6)];const prog=(pick.programs.find(p=>p.title&&p.title.length>10)||pick.programs[0]);
 console.log('guide',GUIDE,'channels',chs.length,'probe channel',pick.name,'| probe show',prog.title);
 const b=await chromium.launch({args:['--no-sandbox']});
 const p=await b.newPage({viewport:{width:1500,height:1000}});
 const logs=[];p.on('pageerror',e=>logs.push('PAGEERROR '+e));p.on('console',m=>{if(m.type()==='error'&&!/404|Failed to load/.test(m.text()))logs.push(m.text().slice(0,160))});
 const img=[];p.on('request',r=>{if(r.resourceType()==='image')img.push(r.url())});
 await p.goto(BASE+'/',{waitUntil:'domcontentloaded'});await p.waitForTimeout(2500);
 await p.getByRole('button',{name:/^Guide/}).first().click();await p.waitForTimeout(1000);
 await p.locator(`#guide-tab-${GUIDE}`).click();
 await p.waitForSelector('[data-testid="station-number"]',{timeout:90000});await p.waitForTimeout(1500);
 const count=async()=>p.$$eval('[data-testid="station-number"]',e=>e.length);
 console.log('rendered rows',await count(),'| label',await p.getByTestId('epg-result-count').textContent(),'| chips',await p.$$eval('[data-testid="epg-categories"] button',e=>e.length));
 const th=await p.$$eval('[data-testid="lazy-thumb"]',e=>({total:e.length,loaded:e.filter(x=>x.dataset.loaded==='true').length}));console.log('thumbs',JSON.stringify(th),'image requests',img.length);const kinds={};img.forEach(u=>{const k=/services\/img/.test(u)?'archive item image (LazyThumb)':/\/thumbs\//.test(u)?'local backup /thumbs':/archive\/proxy/.test(u)?'proxy thumb':new URL(u).host;kinds[k]=(kinds[k]||0)+1});console.log(JSON.stringify(kinds));
 const t0=Date.now();await p.getByTestId('epg-search').fill(prog.title.split(' ').slice(0,3).join(' '));
 await p.waitForFunction(()=>document.querySelector('[data-testid="epg-result-count"]').textContent.includes(' of '),null,{timeout:10000}).catch(()=>{});
 console.log('search settle ms',Date.now()-t0,'| label',await p.getByTestId('epg-result-count').textContent(),'| matched-show lines',await p.getByTestId('matched-show').count());
 const first=await p.$$eval('[data-testid="station-number"]',els=>els.slice(0,3).map(e=>e.textContent+' '+e.parentElement.querySelector('span[title]:not([data-testid])').textContent));console.log('first results',JSON.stringify(first));
 await p.screenshot({path:'/tmp/p0/epg-'+GUIDE+'.png'});
 await p.getByTestId('epg-search').fill('');await p.waitForTimeout(600);
 const before=img.length;await p.mouse.move(700,600);for(let i=0;i<6;i++){await p.mouse.wheel(0,900);await p.waitForTimeout(500)}
 const th2=await p.$$eval('[data-testid="lazy-thumb"]',e=>({total:e.length,loaded:e.filter(x=>x.dataset.loaded==='true').length}));
 console.log('after scrolling: rows',await count(),'thumbs',JSON.stringify(th2),'new image requests',img.length-before);
 console.log('errors',logs.join('|')||'none');
 await b.close();
})();
