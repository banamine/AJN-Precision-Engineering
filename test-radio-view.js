// Browser regression for the Radio view (deterministic: AJN feeds, the AJN media proxy and the digest are served by request interception).
// Proves: Listen keeps you on Radio and plays through the ONE persistent player, the Now Playing panel follows it (title, time, pause, seek,
// previous/next), playback survives leaving the page, filters/sort/search work, the Daily Briefing shows honest freshness, and Radio adds no <audio>.
import puppeteer from 'puppeteer';

const baseUrl = process.env.AJN_TEST_URL || 'http://localhost:3000';
const A = 'https://archive.alexjoneslive.com/hourly-mp3/';
const V = 'https://archive.alexjoneslive.com/hourly-m4v/';
const item = (id, file, type, title) => ({ id, title, url: `${type === 'audio' ? A : V}${file}`, mediaType: type, feedId: type === 'audio' ? 'AJNHourlyAudio' : 'AJNHourlyVideo', publishedAt: '2026-10-02T12:00:00Z' });
const audioItems = [
  item('a2', '20261002_Fri_Alex-Hr2.mp3', 'audio', 'Alex Jones Hour 2'),
  item('a1', '20261002_Fri_Alex-Hr1.mp3', 'audio', 'Alex Jones Hour 1'),
  item('w1', '20261001_Thu_WarRoom-Hr1.mp3', 'audio', 'War Room Hour 1'),
  item('s1', '20260927_Sun_SundayLive.mp3', 'audio', 'Sunday Night Live'),
  item('x1', '20261003_Sat_Alex-Special.mp3', 'audio', 'Alex Special'),
];
const videoItems = [item('v1', '20261002_Fri_Alex-Hr1.m4v', 'video', 'Alex Jones Hour 1 video')];
const catalog = { source: 'test', resources: [
  { id: 'AJNHourlyAudio', name: 'AJN Hourly Audio', htmlUrl: 'https://x.test/a', rssUrl: 'https://x.test/a.xml', mediaType: 'audio' },
  { id: 'AJNHourlyVideo', name: 'AJN Hourly Video', htmlUrl: 'https://x.test/v', rssUrl: 'https://x.test/v.xml', mediaType: 'video' },
] };
const story = (id, headline, source) => ({ id, title: headline, url: `https://news.example/${id}`, source, excerpt: `Excerpt for ${headline}`, publishedAt: '2026-10-04T11:00:00.000Z', imageUrl: null });
const digestBody = () => ({
  digest: {
    date: '2026-10-04', updatedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
    top: [story('n1', 'First headline', 'BBC World News'), story('n2', 'Second headline', 'Reuters Top News')],
    bySource: [{ source: 'BBC World News', items: [story('n1', 'First headline', 'BBC World News')] }, { source: 'Reuters Top News', items: [story('n2', 'Second headline', 'Reuters Top News')] }],
    briefing: [{ headline: 'First headline', source: 'BBC World News', summary: 'A short summary.', theme: 'World' }, { headline: 'Second headline', source: 'Reuters Top News', summary: null, theme: null }],
  }, fetchedAt: new Date().toISOString(), status: 'ok', error: null,
});

// 8 kHz mono 16-bit PCM WAV, 90 s of quiet tone: real audio the browser decodes, no network.
function wav(seconds = 90, rate = 8000) {
  const samples = seconds * rate; const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(Math.sin(i / 8) * 3000), i * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVEfmt ', 8); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}
const WAV = wav();

const failures = [];
const check = (condition, message) => { if (!condition) { failures.push(message); console.error(`[radio-view] FAIL: ${message}`); } else console.log(`[radio-view] ok: ${message}`); };
const SHOTS = process.env.AJN_RADIO_SHOTS || ''; // set to a folder to also save PR screenshots
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const errors = [];
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('console', (msg) => {
  if (msg.type() !== 'error') return;
  const text = msg.text();
  if (/Failed to load resource|Manifest: Line: 1|net::ERR_/.test(text)) return;
  errors.push(`console: ${text}`);
});
await page.setRequestInterception(true);
const json = (request, body, status = 200) => request.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
page.on('request', (request) => {
  const url = new URL(request.url());
  if (url.origin !== new URL(baseUrl).origin) return void request.abort(); // fonts, thumbnails, the real internet: not part of this test
  if (url.pathname === '/api/ajn/resources') return json(request, catalog);
  if (url.pathname === '/api/ajn/resources/AJNHourlyAudio') return json(request, { items: audioItems });
  if (url.pathname === '/api/ajn/resources/AJNHourlyVideo') return json(request, { items: videoItems });
  if (url.pathname === '/api/digest') return json(request, digestBody());
  if (url.pathname === '/api/ajn/proxy') {
    const range = /bytes=(\d*)-(\d*)/.exec(request.headers().range || '');
    const start = range && range[1] ? Number(range[1]) : 0; const end = Math.min(range && range[2] ? Number(range[2]) : WAV.length - 1, WAV.length - 1, start + 8 * 1024 * 1024 - 1);
    const body = WAV.subarray(start, end + 1);
    return request.respond({ status: range ? 206 : 200, headers: { 'content-type': 'audio/wav', 'accept-ranges': 'bytes', 'content-length': String(body.length), ...(range ? { 'content-range': `bytes ${start}-${end}/${WAV.length}` } : {}), 'access-control-allow-origin': '*' }, body });
  }
  return void request.continue();
});

const text = (selector) => page.$eval(selector, (el) => el.textContent?.trim() ?? '').catch(() => null);
const media = () => page.evaluate(() => { const el = document.querySelector('#persistent-player audio, #persistent-player video'); return el ? { tag: el.tagName, paused: el.paused, t: el.currentTime, d: el.duration, src: el.currentSrc } : null; });
const waitFor = async (fn, ms = 10000) => { const stop = Date.now() + ms; while (Date.now() < stop) { const v = await fn(); if (v) return v; await sleep(150); } return null; };
const clickText = (selector, label) => page.evaluate((s, l) => { const el = [...document.querySelectorAll(s)].find((e) => e.textContent.trim().startsWith(l)); if (el) el.click(); return Boolean(el); }, selector, label);
// DOM clicks: the fixed mini dock (bottom right) can sit on top of a control after scrolling, which is a test-geometry matter, not what is being proved here.
const domClick = (selector) => page.$eval(selector, (el) => el.click());
const titles = () => page.$$eval('[data-testid="radio-entry"] strong', (els) => els.map((e) => e.textContent.trim()));

try {
  await page.goto(`${baseUrl}/#radio`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="radio-entry"]', { timeout: 20000 });

  await sleep(800);
  await shot('radio-desktop-empty');
  // --- layout, not a flat list
  check((await text('.ajr-hero h1'))?.includes('frequency'), 'hero is shown');
  check((await text('[data-testid="radio-now-title"]')) === 'Nothing playing', 'panel says "Nothing playing" before anything plays');
  check(await page.$('.ajr-tabs') !== null && await page.$('.ajr-chips') !== null && await page.$('.ajr-search input') !== null && await page.$('.ajr-select select') !== null, 'tabs, chips, search and sort are present');
  check(await page.$eval('#ajn-radio-view', (el) => el.querySelectorAll('audio, video').length) === 0, 'Radio view creates no <audio>/<video> element of its own');
  const all = await titles();
  check(all.length === 4, `AJN Radio tab lists 4 episodes (got ${all.length}); the Special is on the Exclusive tab`);
  check(all[0].includes('Hour 2'), `newest first (first is "${all[0]}")`);

  // --- filters / sort / search
  check(await clickText('.ajr-chip', 'War Room'), 'War Room chip exists');
  check((await titles()).length === 1, 'show chip narrows the list');
  await clickText('.ajr-chip', 'All shows');
  await page.select('.ajr-select select', 'oldest');
  const oldest = await titles();
  check(oldest[0].includes('Sunday Night Live') && oldest[oldest.length - 1].includes('Hour 2'), 'oldest first reverses the order');
  await page.select('.ajr-select select', 'newest');
  await page.type('.ajr-search input', 'hour 1');
  check((await titles()).length === 2, 'title search narrows the list');
  await domClick('.ajr-search button');
  check((await titles()).length === 4, 'clearing the search restores the list');
  await clickText('.ajr-tab', 'AJN Exclusive');
  check((await titles()).length === 1, 'AJN Exclusive tab shows the Special');
  await clickText('.ajr-tab', 'AJN Radio');

  // --- Listen: stays on Radio, plays through the persistent player, panel follows
  await domClick('[data-testid="radio-entry"] .ajr-card-open');
  check(await waitFor(async () => (await text('[data-testid="radio-now-title"]'))?.includes('Hour 2')), 'panel shows the episode that was started');
  check(await page.evaluate(() => location.hash) === '#radio', 'Listen keeps you on the Radio page');
  const playing = await waitFor(async () => { const m = await media(); return m && !m.paused && m.t > 0.5 ? m : null; }, 15000);
  check(Boolean(playing), 'the persistent player is actually playing (currentTime advancing)');
  check(await page.$eval('#ajn-radio-view', (el) => el.querySelectorAll('audio, video').length) === 0, 'still no media element inside the Radio view');
  check(await page.$$eval('audio, video', (els) => els.length) === 1, 'exactly one media element in the whole page');
  check(await waitFor(async () => (await text('[data-testid="radio-elapsed"]')) !== '0:00', 8000), 'panel time moves');
  check(await page.$eval('.ajr-card.playing', (el) => el.textContent.includes('PLAYING')).catch(() => false), 'playing card is highlighted');
  check(await page.$('.ajr-pill.rec') !== null && (await text('.ajr-pill')).includes('HOUR'), 'status pill reads RECORDED · HOURS');

  await shot('radio-desktop-playing');
  await page.setViewport({ width: 390, height: 844 });
  await sleep(400);
  await shot('radio-phone-playing');
  await page.setViewport({ width: 1280, height: 900 });
  // --- pause / play / seek
  await domClick('[data-testid="radio-play-toggle"]');
  check(await waitFor(async () => (await media())?.paused === true), 'pause button pauses the persistent player');
  await domClick('[data-testid="radio-play-toggle"]');
  check(await waitFor(async () => (await media())?.paused === false), 'play button resumes it');
  await page.$eval('.ajr-seek', (el) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, '40'); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  check(await waitFor(async () => (await media())?.t >= 39), 'seek bar moves the playhead');

  // --- previous / next broadcast
  await domClick('[aria-label="Previous broadcast"]');
  check(await waitFor(async () => (await text('[data-testid="radio-now-title"]'))?.includes('Hour 1') && !(await text('[data-testid="radio-now-title"]')).includes('Hour 2')), 'previous broadcast plays the earlier episode');
  check(await page.evaluate(() => location.hash) === '#radio', 'still on Radio after skipping');

  // --- survives leaving the page
  await waitFor(async () => { const m = await media(); return m && !m.paused && m.t > 0.5; }, 15000);
  const before = await media();
  await page.evaluate(() => { location.hash = '#library'; });
  await sleep(1800);
  const away = await media();
  check(away && !away.paused && away.t > before.t, 'audio keeps playing on another page');
  await page.evaluate(() => { location.hash = '#radio'; });
  await page.waitForSelector('[data-testid="radio-now-title"]');
  check((await text('[data-testid="radio-now-title"]'))?.includes('Hour 1'), 'panel is correct again when you come back');
  check(await page.$('.ajr-jump') !== null, 'Jump to current is offered while something plays');

  // --- Daily Briefing
  check((await page.$$('[data-testid="briefing-block"]')).length === 2, 'briefing blocks are shown');
  check((await page.$$('[data-testid="digest-story"]')).length === 2, 'story cards are shown');
  check((await text('.ajr-news .ajr-status-ok'))?.startsWith('Updated 3 h ago'), 'freshness line states the digest age, not the fetch time');
  check(await page.$eval('[data-testid="digest-story"]', (el) => el.target === '_blank' && el.rel.includes('noopener')), 'headlines open the original publisher in a new tab');
  await clickText('.ajr-news .ajr-chip', 'REUTERS');
  check((await page.$$('[data-testid="digest-story"]')).length === 1, 'news source chip narrows the stories');

  // --- reload: nothing stale
  await page.goto(`${baseUrl}/#radio`, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="radio-now-title"]');
  check((await text('[data-testid="radio-now-title"]')) === 'Nothing playing', 'after a hard reload the panel says "Nothing playing" (no stale state)');

  check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
} catch (error) {
  failures.push(`exception: ${error.stack || error}`);
  console.error(error);
} finally {
  if (failures.length) { console.error('[radio-view] page errors:', errors.slice(0, 5)); await page.screenshot({ path: process.env.AJN_RADIO_FAIL_SHOT || '/tmp/radio-view-failure.png' }).catch(() => {}); console.error('[radio-view] url:', page.url(), 'body:', (await page.evaluate(() => document.body.innerText.slice(0, 300)).catch(() => ''))); }
  await browser.close();
}
if (failures.length) { console.error(`[radio-view] ${failures.length} failure(s)`); process.exit(1); }
console.log('RADIO VIEW REGRESSION PASSED');
