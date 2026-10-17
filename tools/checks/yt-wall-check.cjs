const { chromium } = require('playwright-core');
(async()=>{
 const b=await chromium.launch({args:['--no-sandbox']});
 const p=await b.newPage({viewport:{width:1500,height:1000}});
 const logs=[];p.on('console',m=>{const t=m.text();if(!/vite|DevTools|allowfullscreen|404/.test(t))logs.push(m.type()+': '+t.slice(0,250))});p.on('pageerror',e=>logs.push('PAGEERROR: '+String(e).slice(0,300)));
 await p.route('**/api/youtube/channel-latest*',r=>{const id=new URL(r.request().url()).searchParams.get('channel');const vid=('v'+id.replace(/[^a-z]/g,'')+'AAAAAAAAAAA').slice(0,11);
   r.fulfill({json:{ok:true,channel:{id,name:id},video:{videoId:vid,title:'Test '+id,publishedAt:new Date().toISOString(),views:null},thumbnailUrl:`https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,asOf:new Date().toISOString(),stale:false}})});
 await p.route('https://i.ytimg.com/**',r=>r.fulfill({status:200,contentType:'image/gif',body:Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64')}));
 await p.route('https://www.youtube-nocookie.com/**',r=>r.fulfill({contentType:'text/html',body:'<html><body>embed</body></html>'}));
 await p.route('https://www.youtube.com/iframe_api',r=>r.fulfill({contentType:'application/javascript',body:`
  window.__yt=[];window.YT={Player:function(el,o){this.el=el;this.o=o;window.__yt.push(this);this.calls=[];var s=this;
    this.mute=function(){};this.isMuted=function(){return true};this.destroy=function(){};
    this.loadPlaylist=function(a){s.calls.push(a)};
    setTimeout(function(){o.events.onReady&&o.events.onReady({target:s})},50);}};
  setTimeout(function(){window.onYouTubeIframeAPIReady&&window.onYouTubeIframeAPIReady()},10);`}));
 await p.goto(''+(process.env.BASE||'http://localhost:3000/')+'',{waitUntil:'domcontentloaded'});await p.waitForTimeout(2500);
 await p.getByText('News Walls',{exact:false}).first().click();await p.waitForTimeout(1000);
 await p.getByTestId('tab-youtube').click();await p.waitForTimeout(5000);
 console.log('load buttons',await p.locator('[data-testid^="button-load-youtube-"]').count());
 await p.locator('[data-testid^="button-load-youtube-"]').first().click();await p.waitForTimeout(1500);
 const info=await p.evaluate(()=>{const y=window.__yt[0];const f=document.querySelector('iframe');return {players:window.__yt.length,host:y&&y.o.host,hasState:!!(y&&y.o.events.onStateChange),src:f&&f.src}});
 console.log(JSON.stringify(info));
 const res=await p.evaluate(()=>{const y=window.__yt[0];y.o.events.onStateChange({data:0,target:y});return y.calls});
 console.log('after ENDED loadPlaylist calls',JSON.stringify(res));
 const res2=await p.evaluate(()=>{const y=window.__yt[0];y.calls.length=0;y.o.events.onStateChange({data:1,target:y});return y.calls.length});console.log('after PLAYING calls',res2);
 console.log('root children',await p.$eval('#root',e=>e.children.length));
 console.log(logs.join('\n')||'(no console errors)');
 await b.close();
})();
