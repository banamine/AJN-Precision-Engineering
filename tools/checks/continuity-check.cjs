// Browser journey: playback never goes idle. Needs a dev server (BASE) and a ~3 s webm clip (CLIP). Schedules/feeds are stubbed so each tier is exercised on purpose.
const { chromium } = require('playwright-core'); const fs = require('fs');
const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/$/, ''); const CLIP = process.env.CLIP || '/tmp/clip3.webm';
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const clip = fs.readFileSync(CLIP);
const entry = (id, title, extra = {}) => ({ id: `${BASE}/clip-${id}.webm`, src: `${BASE}/clip-${id}.webm`, title, subtitle: 't', mediaType: 'video', archivePath: `${BASE}/clip-${id}.webm`, playedAt: Date.now(), updatedAt: Date.now(), progressSeconds: 0, plays: 1, ...extra });
const prog = (id, title, extra = {}) => ({ id, title, description: 'd', mediaType: 'video', archivePath: `${BASE}/clip-${id}.webm`, mediaUrl: `${BASE}/clip-${id}.webm`, ...extra });
const json = (r, status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function scenario(browser, name, seed, routes, check) {
  console.log('— ' + name);
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } }); const p = await ctx.newPage();
  const log = []; const reqs = []; const errs = [];
  p.on('console', m => { const t = m.text(); if (t.includes('[AJN TELEMETRY]')) log.push(t.split(' ')[2] || t); }); p.on('pageerror', e => errs.push(String(e))); p.on('request', r => reqs.push(r.url()));
  await p.route(/\/(clip-[^/]*\.webm|\d{8}_[A-Za-z]{3}_[^/]*\.mp3)(\?.*)?$/, r => {
    const m = /bytes=(\d+)-(\d*)/.exec(r.request().headers()['range'] || '');
    if (!m) return r.fulfill({ status: 200, contentType: 'video/webm', body: clip, headers: { 'accept-ranges': 'bytes' } });
    const a = +m[1], z = m[2] ? Math.min(+m[2], clip.length - 1) : clip.length - 1;
    r.fulfill({ status: 206, contentType: 'video/webm', body: clip.subarray(a, z + 1), headers: { 'accept-ranges': 'bytes', 'content-range': `bytes ${a}-${z}/${clip.length}` } });
  });
  for (const [pat, fn] of routes) await p.route(pat, fn);
  await p.addInitScript((h) => { if (!localStorage.getItem('seeded')) { localStorage.setItem('ajn.history.v1', JSON.stringify({ version: 1, items: h })); localStorage.setItem('seeded', '1'); } }, seed);
  await p.goto(BASE + '/#history', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2500);
  await p.locator('[data-testid="history-item"] button').first().click();
  await p.waitForTimeout(800);
  const title = async () => (await p.getByTestId('player-title').textContent().catch(() => '')) || '';
  await check({ p, title, log, reqs });
  ok(errs.length === 0, 'no uncaught page errors' + (errs.length ? ': ' + errs.join('|') : ''));
  await ctx.close();
}
const waitTitle = async (title, re, ms = 14000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(await title())) return true; await new Promise(r => setTimeout(r, 300)); } return false; };

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'], executablePath: '/opt/pw-browsers/chromium' });

  // Tier 1: next program on the same channel; asks for ONE channel, not the whole guide; wraps at the end.
  await scenario(b, 'tier 1: next in channel, wraps', [entry('a', 'Show A', { channelId: 'c1', guideId: 'g1', programId: 'pa' })], [
    [/\/api\/schedule\?/, r => json(r, 200, { guideId: 'g1', channels: [{ id: 'c1', programs: [prog('a', 'Show A', { id: 'pa', channelId: 'c1', guideId: 'g1' }), prog('b', 'Show B', { id: 'pb', channelId: 'c1', guideId: 'g1' })] }] })],
  ], async ({ title, reqs, log }) => {
    ok(/Show A/.test(await title()), 'starts on Show A');
    ok(await waitTitle(title, /Show B/), 'Show A ended -> Show B plays');
    ok(reqs.some(u => /\/api\/schedule\?guide=g1&channel=c1/.test(u)), 'schedule requested for this channel only');
    ok(await waitTitle(title, /Show A/), 'Show B ended -> wraps to Show A (loop)');
  });

  // Tier 2: a single item with no list continues with another item from the app's guides.
  await scenario(b, 'tier 2: another item in the app', [entry('x', 'Lone Item')], [
    [/\/api\/schedule\?guide=movies-classics-vault/, r => json(r, 200, { guideId: 'movies-classics-vault', channels: [{ id: 'm1', programs: [prog('m', 'Other Movie', { id: 'pm', channelId: 'm1', guideId: 'movies-classics-vault' })] }] })],
    [/\/api\/schedule\?guide=(?!movies)/, r => json(r, 406, { error: 'too big', channels: [] })],
  ], async ({ title, log }) => {
    ok(await waitTitle(title, /Other Movie/), 'Lone Item ended -> another item plays');
    ok(log.includes('playback.continue_other'), 'logged playback.continue_other');
  });

  // Tier 3 + 4: every schedule fails (the HTTP 406 screenshot) -> AJN Full Shows audio, looped.
  await scenario(b, 'tier 3/4: schedules fail -> Full Shows audio loop', [entry('x', 'Lone Item')], [
    [/\/api\/schedule\?/, r => json(r, 406, { error: 'schedule is 30 MiB', channels: [] })],
    [/\/api\/ajn\/resources\/Alex$/, r => json(r, 200, { items: [{ id: 'alex-full', title: 'Alex Jones 2026-Oct-02 Friday', url: `${BASE}/20261002_Fri_Alex.mp3`, mediaType: 'audio' }] })],
    [/\/api\/ajn\/resources\/WarRoom$/, r => json(r, 500, {})],
  ], async ({ p, title, log }) => {
    ok(await waitTitle(title, /Alex Jones/), 'schedules fail -> Full Shows audio plays');
    ok(log.includes('playback.fallback_full_shows'), 'logged playback.fallback_full_shows');
    const t0 = Date.now(); let looped = false;
    while (Date.now() - t0 < 14000 && !looped) { await new Promise(r => setTimeout(r, 400)); looped = log.includes('playback.fallback_loop'); }
    ok(looped, 'fallback ended -> loops (playback.fallback_loop)');
    await p.waitForTimeout(1500);
    const st = await p.evaluate(() => { const m = document.querySelector('audio,video'); return m ? { paused: m.paused, t: m.currentTime } : null; });
    ok(!!st && !st.paused, 'still playing after the loop: ' + JSON.stringify(st));
  });

  // A file that fails to load (404) is skipped to another item, even with no channel/list behind it.
  await scenario(b, 'error: broken file -> another item', [entry('gone', 'Broken Item')], [
    [/clip-gone\.webm/, r => r.fulfill({ status: 404, body: 'gone' })],
    [/\/api\/schedule\?guide=movies-classics-vault/, r => json(r, 200, { guideId: 'movies-classics-vault', channels: [{ id: 'm1', programs: [prog('m', 'Other Movie', { id: 'pm', channelId: 'm1', guideId: 'movies-classics-vault' })] }] })],
    [/\/api\/schedule\?guide=(?!movies)/, r => json(r, 500, {})],
  ], async ({ title }) => {
    ok(await waitTitle(title, /Other Movie/, 12000), 'broken item skipped -> another item plays');
  });

  // AJN Radio item: next entry of the radio list.
  await scenario(b, 'radio: next entry', [entry('r1', 'Alex Jones 2026-Oct-02 Friday', { mediaType: 'audio', channelId: 'ajn-radio', guideId: 'ajn-radio', programId: 'rid1', src: `${BASE}/20261002_Fri_Alex.mp3`, archivePath: `${BASE}/20261002_Fri_Alex.mp3`, id: `${BASE}/20261002_Fri_Alex.mp3` })], [
    [/\/api\/ajn\/resources$/, r => json(r, 200, { source: 't', resources: [{ id: 'Alex', name: 'Alex', htmlUrl: '', rssUrl: '', mediaType: 'audio' }] })],
    [/\/api\/ajn\/resources\/Alex$/, r => json(r, 200, { items: [
      { id: 'rid1', title: 'Alex Jones 2026-Oct-02 Friday', url: `${BASE}/20261002_Fri_Alex.mp3`, mediaType: 'audio', feedId: 'Alex' },
      { id: 'rid2', title: 'Alex Jones 2026-Oct-01 Thursday', url: `${BASE}/20261001_Thu_Alex.mp3`, mediaType: 'audio', feedId: 'Alex' }] })],
  ], async ({ title }) => {
    ok(await waitTitle(title, /Thu Oct 1/), 'radio item ended -> next radio entry plays');
  });

  // Everything fails: no crash, an explicit "exhausted" event, and the player stays on screen (a slow retry is scheduled).
  await scenario(b, 'all sources fail: explicit, not silent', [entry('x', 'Lone Item')], [
    [/\/api\/schedule\?/, r => json(r, 500, {})], [/\/api\/ajn\/resources/, r => json(r, 500, {})],
  ], async ({ title, log }) => {
    const t0 = Date.now(); while (Date.now() - t0 < 16000 && !log.includes('playback.continuity_exhausted')) await new Promise(r => setTimeout(r, 400));
    ok(log.includes('playback.continuity_exhausted'), 'logged playback.continuity_exhausted (retry in 30 s)');
    ok(/Lone Item/.test(await title()), 'player still shows the item (nothing fabricated)');
  });
  await b.close();
})();
