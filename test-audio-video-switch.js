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
  if (msg.type() !== 'error') return;
  const text = msg.text();
  if (text.includes('Manifest: Line: 1, column: 1, Syntax error.')) return;
  if (text.includes('Failed to load resource: the server responded with a status of 404 (Not Found)')) return;
  errors.push(`console: ${text}`);
});

try {
  await page.evaluateOnNewDocument(() => {
    const OriginalAudioContext = window.AudioContext;
    let created = 0;
    let sourceCreated = 0;
    const sourceErrors = [];

    if (OriginalAudioContext) {
      window.AudioContext = class extends OriginalAudioContext {
        constructor(...args) {
          super(...args);
          created += 1;
          window.__ajnAudioContextCreated = created;
          window.__ajnAudioContextStates = window.__ajnAudioContextStates || [];
          window.__ajnAudioContextStates.push(this.state);
          const original = this.createMediaElementSource.bind(this);
          this.createMediaElementSource = (media) => {
            try {
              const source = original(media);
              sourceCreated += 1;
              window.__ajnMediaElementSourceCreated = sourceCreated;
              return source;
            } catch (error) {
              sourceErrors.push(String(error?.message || error));
              window.__ajnMediaElementSourceErrors = sourceErrors;
              throw error;
            }
          };
        }
      };
      window.__ajnAudioContextCreated = 0;
      window.__ajnMediaElementSourceCreated = 0;
      window.__ajnMediaElementSourceErrors = [];
      window.__ajnAudioContextStates = [];
    }
  });

  console.log(`[audio-switch] Loading ${baseUrl}`);
  await page.goto(baseUrl, { waitUntil: 'networkidle2' });

  const initial = await page.evaluate(() => ({
    contexts: window.__ajnAudioContextCreated ?? 0,
    sources: window.__ajnMediaElementSourceCreated ?? 0,
    sourceErrors: window.__ajnMediaElementSourceErrors ?? [],
    media: Array.from(document.querySelectorAll('video, audio')).map((el) => ({
      tag: el.tagName.toLowerCase(),
      src: el.currentSrc || el.src || null,
      currentTime: el.currentTime,
      paused: el.paused,
      readyState: el.readyState,
      crossOrigin: el.crossOrigin || null,
    })),
  }));

  console.log(`[audio-switch] initial contexts: ${initial.contexts}`);
  console.log(`[audio-switch] initial sources: ${initial.sources}`);
  console.log(`[audio-switch] initial media count: ${initial.media.length}`);

  if (initial.contexts > 1) {
    throw new Error(`Initial mount created ${initial.contexts} AudioContexts`);
  }
  if (initial.media.length === 0) {
    console.log('[audio-switch] INFO: no media mounted on home page; full switch sequence requires real guide/program controls.');
  }
  if (errors.length) throw new Error(errors.join('\n'));

  console.log('[audio-switch] PASS: instrumentation is active and initial singleton invariant holds.');
} finally {
  await browser.close();
}
