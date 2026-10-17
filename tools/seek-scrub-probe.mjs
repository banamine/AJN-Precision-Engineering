// Real-browser probe: drag/click the seek bar on the Chicane MP3 and count /api/archive/proxy requests. Usage: node tools/seek-scrub-probe.mjs http://localhost:PORT drag|click
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const URL_ = process.argv[2], MODE = process.argv[3] || 'drag';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox','--autoplay-policy=no-user-gesture-required'] });
const page = await (await b.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
const t0 = Date.now(), ts = () => ((Date.now() - t0) / 1000).toFixed(1);
const reqs = [];
page.on('request', r => { if (r.url().includes('/api/archive/proxy') && r.url().includes('mp3')) reqs.push({ t: ts(), range: r.headers()['range'], state: 'sent' }); });
page.on('requestfailed', r => { if (r.url().includes('/api/archive/proxy') && r.url().includes('mp3')) { const q = reqs.find(x => x.range === r.headers()['range'] && x.state === 'sent'); if (q) { q.state = 'aborted'; q.end = ts(); } } });
page.on('requestfinished', r => { if (r.url().includes('/api/archive/proxy') && r.url().includes('mp3')) { const q = reqs.find(x => x.range === r.headers()['range'] && x.state === 'sent'); if (q) { q.state = 'done'; q.end = ts(); } } });
await page.goto(URL_ + '/#tv-guide'); await page.waitForTimeout(2500);
await page.locator('#guide-tab-audio-podcasts').click({ timeout: 10000 }); await page.waitForTimeout(3000);
await page.locator('[data-testid=epg-search]').fill('chicane'); await page.waitForTimeout(1500);
await page.locator('[data-play-live="music-chicane-live-at-palladium-22-01-2000"]').click({ timeout: 20000 });
const st = () => page.evaluate(() => { const v = document.querySelector('audio,video'); return v ? { ct: +v.currentTime.toFixed(1), d: v.duration, rs: v.readyState, paused: v.paused, status: document.body.innerText.match(/Network stalled|Buffering…|Playing|Seeking/)?.[0] } : null; });
for (let i = 0; i < 60; i++) { const s = await st(); if (s && s.rs >= 3 && s.ct > 1) break; await page.waitForTimeout(1000); }
console.log('started', ts(), JSON.stringify(await st()));
const n0 = reqs.length;
const box = await page.locator('input[aria-label=Seek]').boundingBox();
const y = box.y + box.height / 2, x0 = box.x + box.width * 0.1, x1 = box.x + box.width * 0.9;
const tScrub = Date.now();
if (MODE === 'drag') {
  await page.mouse.move(x0, y); await page.mouse.down();
  for (let i = 1; i <= 30; i++) { await page.mouse.move(x0 + (x1 - x0) * i / 30, y); await page.waitForTimeout(60); }
  await page.mouse.up();
} else { await page.mouse.click(x1, y); }
console.log('scrub done after', ((Date.now() - tScrub) / 1000).toFixed(1), 's; proxy requests during scrub:', reqs.length - n0);
let resumed = null;
for (let i = 0; i < 120; i++) { const s = await st(); if (i % 5 === 0) console.log(ts(), JSON.stringify(s)); if (s && !s.paused && s.rs >= 3 && s.ct > 0) { const a = s.ct; await page.waitForTimeout(2000); const s2 = await st(); if (s2.ct > a + 1) { resumed = ((Date.now() - tScrub) / 1000).toFixed(1); break; } } await page.waitForTimeout(1000); }
console.log('resumed playing', resumed, 's after scrub start');
console.log(reqs.slice(n0).map(r => `${r.t}-${r.end ?? '?'} ${r.range} ${r.state}`).join('\n'));
await b.close();
