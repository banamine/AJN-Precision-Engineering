import puppeteer from 'puppeteer';

const baseUrl = process.env.AJN_TEST_URL || 'http://localhost:3000';

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required'],
});

const page = await browser.newPage();
const errors = [];
const consoleErrors = [];
const mediaEvents = [];

page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('requestfailed', (request) => {
  const url = request.url();
  if (url.includes('/api/') || url.includes('audio') || url.includes('stream') || url.includes('m3u') || url.includes('mp3') || url.includes('aac')) {
    mediaEvents.push(`requestfailed: ${request.failure()?.errorText ?? 'unknown'} ${url}`);
  }
});

try {
  console.log(`[audio-test] Loading ${baseUrl}`);
  await page.goto(baseUrl, { waitUntil: 'networkidle2' });

  const result = await page.evaluate(() => {
    const audio = Array.from(document.querySelectorAll('audio')).map((el) => ({
      src: el.currentSrc || el.src || null,
      crossOrigin: el.crossOrigin || null,
      readyState: el.readyState,
      paused: el.paused,
    }));

    const video = Array.from(document.querySelectorAll('video')).map((el) => ({
      src: el.currentSrc || el.src || null,
      crossOrigin: el.crossOrigin || null,
      readyState: el.readyState,
      paused: el.paused,
    }));

    const bridgePanel = document.querySelector('#audio-bridge-panel');
    const bridgeText = bridgePanel?.textContent ?? '';

    return {
      audio,
      video,
      bridgePresent: Boolean(bridgePanel),
      analyzerState: /Analyzer Active|Analyzer Ready|Analyzer Unavailable/.exec(bridgeText)?.[0] ?? null,
      barCanvas: Array.from(document.querySelectorAll('canvas')).find((el) => el.getAttribute('aria-label') === 'Real-time audio frequency visualizer') ?? null,
    };
  });

  console.log(`[audio-test] audio elements: ${result.audio.length}`);
  console.log(`[audio-test] video elements: ${result.video.length}`);
  console.log(`[audio-test] bridge panel present: ${result.bridgePresent}`);
  console.log(`[audio-test] analyzer state: ${result.analyzerState ?? 'not mounted'}`);

  if (errors.length) throw new Error(errors.join('\n'));
  if (consoleErrors.length) throw new Error(`Browser console errors:\n${consoleErrors.join('\n')}`);

  console.log('[audio-test] PASS: page loaded without browser errors.');
  console.log('[audio-test] NOTE: A real analyzer signal requires a real audio source to be selected and played in the browser.');
  console.log('[audio-test] NOTE: This check intentionally does not treat a static visualizer or synthetic signal as success.');
} finally {
  await browser.close();
}
