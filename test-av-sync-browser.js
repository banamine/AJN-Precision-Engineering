// Browser regression for Parallel Audio/Video Sync (AJN feed items). Deterministic: feeds and the AJN proxy are served by request interception.
// Proves, with real media decoded by the browser: Watch at ~10:00 of the audio starts the video at ~10:00 (and Listen goes back at the same spot),
// the Mini Video overlay follows the audio (play/pause/seek) without making sound, the shared position is saved continuously,
// episodes without a paired video show no switch, and one AudioContext / one persistent player remain.
import puppeteer from 'puppeteer';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const baseUrl = process.env.AJN_TEST_URL || 'http://localhost:3000';
const A = 'https://archive.alexjoneslive.com/hourly-mp3/';
const V = 'https://archive.alexjoneslive.com/hourly-m4v/';
const SECONDS = 12 * 60;
const item = (id, file, type, title) => ({ id, title, url: `${type === 'audio' ? A : V}${file}`, mediaType: type, feedId: type === 'audio' ? 'AJNHourlyAudio' : 'AJNHourlyVideo', publishedAt: '2026-10-02T12:00:00Z' });
const audioItems = [item('a2', '20261002_Fri_Alex-Hr2.mp3', 'audio', 'Alex Jones Hour 2'), item('a1', '20261002_Fri_Alex-Hr1.mp3', 'audio', 'Alex Jones Hour 1')];
const videoItems = [item('v1', '20261002_Fri_Alex-Hr1.m4v', 'video', 'Alex Jones Hour 1 video')];
const catalog = { source: 'test', resources: [
  { id: 'AJNHourlyAudio', name: 'AJN Hourly Audio', htmlUrl: 'https://x.test/a', rssUrl: 'https://x.test/a.xml', mediaType: 'audio' },
  { id: 'AJNHourlyVideo', name: 'AJN Hourly Video', htmlUrl: 'https://x.test/v', rssUrl: 'https://x.test/v.xml', mediaType: 'video' },
] };

// Real media, generated here: a 12-minute 8 kHz mono WAV and a 12-minute 1 fps VP8/WebM (Chromium for Testing has no H.264).
function wav(seconds, rate = 8000) {
  const samples = seconds * rate; const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(Math.sin(i / 8) * 3000), i * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVEfmt ', 8); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}
const dir = mkdtempSync(join(tmpdir(), 'ajn-avsync-'));
const videoPath = join(dir, 'video.webm');
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc=size=160x90:rate=1:duration=${SECONDS}`, '-c:v', 'libvpx', '-b:v', '60k', '-g', '2', '-an', videoPath], { stdio: 'inherit' });
const WAV = wav(SECONDS);
const WEBM = readFileSync(videoPath);

const failures = [];
const check = (condition, message) => { if (!condition) { failures.push(message); console.error(`[av-sync] FAIL: ${message}`); } else console.log(`[av-sync] ok: ${message}`); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SHOTS = process.env.AJN_AVSYNC_SHOTS || '';

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
await page.evaluateOnNewDocument(() => {
  const Original = window.AudioContext; let created = 0;
  if (Original) window.AudioContext = class extends Original { constructor(...a) { super(...a); created += 1; window.__ajnAudioContextCreated = created; } };
  window.__ajnAudioContextCreated = 0;
});
await page.setRequestInterception(true);
const proxied = [];
page.on('request', (request) => {
  const url = new URL(request.url());
  if (url.origin !== new URL(baseUrl).origin) return void request.abort();
  const json = (body) => request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  if (url.pathname === '/api/ajn/resources') return json(catalog);
  if (url.pathname === '/api/ajn/resources/AJNHourlyAudio') return json({ items: audioItems });
  if (url.pathname === '/api/ajn/resources/AJNHourlyVideo') return json({ items: videoItems });
  if (url.pathname === '/api/digest') return request.respond({ status: 503, contentType: 'application/json', body: '{}' });
  if (url.pathname === '/api/ajn/proxy') {
    const target = url.searchParams.get('url') || '';
    const isVideo = target.includes('hourly-m4v');
    proxied.push(isVideo ? 'video' : 'audio');
    const body0 = isVideo ? WEBM : WAV;
    const range = /bytes=(\d*)-(\d*)/.exec(request.headers().range || '');
    const start = range && range[1] ? Number(range[1]) : 0;
    const end = Math.min(range && range[2] ? Number(range[2]) : body0.length - 1, body0.length - 1, start + 8 * 1024 * 1024 - 1);
    const body = body0.subarray(start, end + 1);
    return request.respond({ status: range ? 206 : 200, headers: { 'content-type': isVideo ? 'video/webm' : 'audio/wav', 'accept-ranges': 'bytes', 'content-length': String(body.length), ...(range ? { 'content-range': `bytes ${start}-${end}/${body0.length}` } : {}), 'access-control-allow-origin': '*' }, body });
  }
  return void request.continue();
});

const media = () => page.evaluate(() => { const el = document.querySelector('#persistent-player audio, #persistent-player video'); return el ? { tag: el.tagName, paused: el.paused, t: el.currentTime, d: el.duration, ready: el.readyState } : null; });
const pipVideo = () => page.evaluate(() => { const el = document.querySelector('#synced-video-pip video'); return el ? { paused: el.paused, t: el.currentTime, muted: el.muted, ready: el.readyState } : null; });
const stored = () => page.evaluate(() => { try { const m = JSON.parse(localStorage.getItem('ajn.avsync.v1') || '{}'); return m.a1 ?? null; } catch { return null; } });
const waitFor = async (fn, ms = 15000) => { const stop = Date.now() + ms; while (Date.now() < stop) { const v = await fn(); if (v) return v; await sleep(150); } return null; };
const domClick = (selector) => page.$eval(selector, (el) => el.click());
const hash = () => page.evaluate(() => location.hash);
const near = (value, expected, tol) => typeof value === 'number' && Math.abs(value - expected) <= tol;

try {
  await page.goto(`${baseUrl}/#radio`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="radio-entry"]', { timeout: 20000 });

  // --- episode WITHOUT a paired video: no switch offered
  await page.evaluate(() => { const card = [...document.querySelectorAll('[data-testid="radio-entry"]')].find((c) => c.textContent.includes('Hour 2')); card.querySelector('.ajr-card-open').click(); });
  check(await waitFor(async () => { const m = await media(); return m && !m.paused && m.t > 0.3; }), 'Hour 2 (no video) plays');
  await sleep(1200);
  check(await page.$('[data-testid="av-sync-controls"]') === null, 'no Watch / Mini video for an episode with no paired video');

  // --- episode WITH a paired video
  await page.evaluate(() => { const card = [...document.querySelectorAll('[data-testid="radio-entry"]')].find((c) => c.textContent.includes('Hour 1')); card.querySelector('.ajr-card-open').click(); });
  check(await waitFor(async () => { const m = await media(); return m && m.tag === 'AUDIO' && !m.paused && m.t > 0.3 && m.d > 600; }), 'Hour 1 audio plays');
  check(await waitFor(() => page.$('[data-testid="av-watch"]')), 'Watch is offered because a paired video exists');
  check(await page.$('[data-testid="av-mini"]') !== null, 'Mini video is offered too');

  // listener is 10 minutes in
  await page.evaluate(() => { document.querySelector('#persistent-player audio').currentTime = 600; });
  check(await waitFor(async () => (await media())?.t >= 600), 'audio is at the 10 minute mark');
  await sleep(1500); // let the real-time position save run
  const saved = await stored();
  check(saved && near(saved.seconds, 601.5, 3), `position was saved in real time (stored ${saved?.seconds}s)`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/avsync-1-audio-10min.png` });

  // --- Mini video: audio keeps leading
  await domClick('[data-testid="av-mini"]');
  check(await waitFor(() => page.$('#synced-video-pip video')), 'mini video overlay opens');
  const pip = await waitFor(async () => { const p = await pipVideo(); return p && p.ready >= 2 && near(p.t, (await media()).t, 1.2) && !p.paused ? p : null; }, 20000);
  check(Boolean(pip), 'mini video starts at the audio position and plays');
  check(pip?.muted === true, 'mini video is muted (sound comes only from the audio player)');
  check((await media())?.tag === 'AUDIO' && !(await media()).paused, 'audio is still the main player and still playing');
  check(await page.evaluate(() => location.hash) === '#radio', 'opening the mini video does not navigate away');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/avsync-2-mini-video.png` });
  await page.evaluate(() => { document.querySelector('#persistent-player audio').currentTime = 300; });
  check(await waitFor(async () => { const p = await pipVideo(); return p && near(p.t, (await media()).t, 1.5); }), 'seeking the audio moves the mini video with it');
  await page.evaluate(() => document.querySelector('#persistent-player audio').pause());
  check(await waitFor(async () => (await pipVideo())?.paused === true), 'pausing the audio pauses the mini video');
  await page.evaluate(() => document.querySelector('#persistent-player audio').play());
  check(await waitFor(async () => (await pipVideo())?.paused === false), 'resuming the audio resumes the mini video');
  await domClick('[data-testid="av-mini"]');
  check(await waitFor(async () => (await page.$('#synced-video-pip')) === null), 'mini video closes');
  check(await page.$$eval('audio, video', (els) => els.length) === 1, 'back to one media element in the page');

  // --- Hard switch: Watch at 10:00 -> video starts at 10:00
  await page.evaluate(() => { document.querySelector('#persistent-player audio').currentTime = 600; });
  await waitFor(async () => (await media())?.t >= 600);
  const beforeWatch = (await media()).t;
  await domClick('[data-testid="av-watch"]');
  const video = await waitFor(async () => { const m = await media(); return m && m.tag === 'VIDEO' && m.ready >= 2 && !m.paused ? m : null; }, 20000);
  check(Boolean(video), 'Watch switches the main player to the video and it plays');
  check(near(video?.t, beforeWatch, 4), `video starts at the audio position (audio was ${beforeWatch.toFixed(1)}s, video ${video?.t.toFixed(1)}s)`);
  check(video && video.t > 590, 'video did not restart from 0:00');
  check(await hash() === '#player', 'Watch shows the main view as the video player');
  await sleep(2500);
  const playingVideo = await media();
  check(playingVideo.t > video.t + 1.5, 'video keeps playing from there');
  check(await page.$('[data-testid="av-listen"]') !== null, 'Listen (switch back) is offered on the video player');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/avsync-3-video-at-10min.png` });

  // --- and back: Listen keeps the place
  await page.evaluate(() => { document.querySelector('#persistent-player video').currentTime = 720 - 30; });
  await waitFor(async () => (await media())?.t >= 689);
  const beforeListen = (await media()).t;
  await domClick('[data-testid="av-listen"]');
  const audio = await waitFor(async () => { const m = await media(); return m && m.tag === 'AUDIO' && m.ready >= 2 && !m.paused ? m : null; }, 20000);
  check(Boolean(audio), 'Listen switches back to the audio player and it plays');
  check(near(audio?.t, beforeListen, 4), `audio resumes at the video position (video was ${beforeListen.toFixed(1)}s, audio ${audio?.t.toFixed(1)}s)`);

  // --- state persistence: shared record, written by either version
  await sleep(1500);
  const after = await stored();
  check(after && near(after.seconds, (await media()).t, 3), `shared position keeps tracking after the toggles (stored ${after?.seconds}s)`);
  const keys = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('ajn.avsync.v1') || '{}')));
  check(keys.includes('a1') && !keys.some((k) => k.endsWith(':video')), `audio and video versions share ONE record (keys: ${keys.join(',')})`);

  // --- the single player / single AudioContext rules still hold
  check(await page.$$eval('audio, video', (els) => els.length) === 1, 'exactly one media element after all the switching');
  check((await page.evaluate(() => window.__ajnAudioContextCreated)) <= 1, `at most one AudioContext was created (${await page.evaluate(() => window.__ajnAudioContextCreated)})`);
  check(proxied.includes('video') && proxied.includes('audio'), 'both versions were fetched through /api/ajn/proxy');
  check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
} catch (error) {
  failures.push(`exception: ${error.stack || error}`);
  console.error(error);
} finally {
  if (failures.length) { console.error('[av-sync] page errors:', errors.slice(0, 5)); await page.screenshot({ path: process.env.AJN_AVSYNC_FAIL_SHOT || '/tmp/av-sync-failure.png' }).catch(() => {}); console.error('[av-sync] url:', page.url()); }
  await browser.close();
}
if (failures.length) { console.error(`[av-sync] ${failures.length} failure(s)`); process.exit(1); }
console.log('AV SYNC BROWSER REGRESSION PASSED');
