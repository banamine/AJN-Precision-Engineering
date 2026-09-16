import puppeteer from 'puppeteer';

const baseUrl = process.env.AJN_TEST_URL || 'http://localhost:3000';

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required'],
});

const page = await browser.newPage();
const errors = [];

page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
});

try {
  await page.evaluateOnNewDocument(() => {
    const OriginalAudioContext = window.AudioContext;
    let created = 0;

    if (OriginalAudioContext) {
      window.AudioContext = class extends OriginalAudioContext {
        constructor(...args) {
          super(...args);
          created += 1;
          window.__ajnAudioContextCreated = created;
          window.__ajnAudioContextStates = window.__ajnAudioContextStates || [];
          window.__ajnAudioContextStates.push(this.state);
        }
      };
      window.__ajnAudioContextCreated = 0;
      window.__ajnAudioContextStates = [];
    }
  });

  console.log(`[audio-singleton] Loading ${baseUrl}`);
  await page.goto(baseUrl, { waitUntil: 'networkidle2' });

  await page.waitForSelector('video, audio', { timeout: 15000 });
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const initial = await page.evaluate(() => ({
    contexts: window.__ajnAudioContextCreated ?? 0,
    media: Array.from(document.querySelectorAll('video, audio')).map((el) => ({
      tag: el.tagName.toLowerCase(),
      src: el.currentSrc || el.src || null,
      currentTime: el.currentTime,
      paused: el.paused,
      readyState: el.readyState,
      crossOrigin: el.crossOrigin || null,
    })),
  }));

  console.log(`[audio-singleton] initial AudioContexts: ${initial.contexts}`);
  console.log(`[audio-singleton] initial media count: ${initial.media.length}`);
  console.log(`[audio-singleton] initial media: ${JSON.stringify(initial.media)}`);

  if (errors.length) throw new Error(errors.join('\n'));
  if (initial.contexts > 1) {
    throw new Error(`Expected at most one AudioContext after initial mount, found ${initial.contexts}`);
  }

  console.log('[audio-singleton] PASS: singleton owner did not create duplicate contexts during initial mount.');
} finally {
  await browser.close();
}
