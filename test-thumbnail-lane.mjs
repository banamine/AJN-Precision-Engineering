import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';

const imagePng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/d1sAAAAASUVORK5CYII=',
  'base64',
);
let server;
let browser;
let origin = '';
let activeImages = 0;
let maxActiveImages = 0;
let imageStarts = [];
let externalRequests = 0;
let archiveRequests = 0;
let mediaAtStart = null;
let mediaElapsedMs = null;
const artificialImageDelayMs = 400;

try {
  server = await createServer({
    configFile: './vite.config.ts',
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  });
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Vite did not bind a local test address');
  origin = `http://127.0.0.1:${address.port}`;
  browser = await puppeteer.launch({
    executablePath: '/repl/tools/bin/chromium',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== origin) {
      externalRequests++;
      if (url.hostname === 'archive.org' || url.hostname.endsWith('.archive.org')) archiveRequests++;
      void request.abort('blockedbyclient');
      return;
    }
    if (url.pathname.startsWith('/__synthetic/image/')) {
      activeImages++;
      maxActiveImages = Math.max(maxActiveImages, activeImages);
      imageStarts.push(url.pathname);
      setTimeout(() => {
        void request.respond({ status: 200, contentType: 'image/png', body: imagePng })
          .catch(() => {})
          .finally(() => { activeImages--; });
      }, artificialImageDelayMs);
      return;
    }
    if (url.pathname === '/__synthetic/media') {
      mediaAtStart = activeImages;
      const start = Date.now();
      void request.respond({ status: 200, contentType: 'text/plain', body: 'synthetic-media-ok' })
        .then(() => { mediaElapsedMs = Date.now() - start; })
        .catch(() => {});
      return;
    }
    if (url.pathname === '/thumbs/classic-archive.jpg') {
      activeImages++;
      maxActiveImages = Math.max(maxActiveImages, activeImages);
      imageStarts.push(url.pathname);
      setTimeout(() => {
        void request.respond({ status: 404, contentType: 'text/plain', body: 'synthetic local failure' })
          .catch(() => {})
          .finally(() => { activeImages--; });
      }, 10);
      return;
    }
    if (url.pathname.startsWith('/thumbs/')) {
      imageStarts.push(url.pathname);
      activeImages++;
      maxActiveImages = Math.max(maxActiveImages, activeImages);
      setTimeout(() => {
        void request.respond({ status: 200, contentType: 'image/png', body: imagePng })
          .catch(() => {})
          .finally(() => { activeImages--; });
      }, artificialImageDelayMs);
      return;
    }
    void request.continue();
  });

  await page.goto(`${origin}/test-thumbnail-lane.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const stats = window.__thumbnailLaneStats?.();
    return stats?.active === 4 && stats.queued === 36;
  });
  const initial = await page.evaluate(() => window.__thumbnailLaneStats());
  assert.deepEqual(initial, { active: 4, queued: 36, limit: 4 });
  assert.equal(await page.$eval('[data-loaded="false"]', (element) => element.getAttribute('data-testid')), 'lazy-thumb', 'offscreen LazyThumb is not activated');
  assert.equal(imageStarts.length, 4, 'only four images are requested while 40 channel logos are admitted');

  const mediaResult = await page.evaluate(async () => {
    const started = performance.now();
    const response = await fetch('/__synthetic/media');
    return { ok: response.ok, elapsedMs: performance.now() - started };
  });
  assert.equal(mediaResult.ok, true);
  assert.equal(mediaAtStart, 4, 'media request starts while all four image slots are occupied and 36 logos remain queued');
  assert.ok(mediaResult.elapsedMs < artificialImageDelayMs, `media completed in ${mediaResult.elapsedMs} ms, below the image delay`);

  await page.click('[data-testid="start-lazy"]');
  await page.waitForFunction(() => {
    const stats = window.__thumbnailLaneStats?.();
    return stats?.active === 4 && stats.queued === 37;
  });
  const whileQueued = await page.evaluate(() => window.__thumbnailLaneStats());
  assert.equal(whileQueued.active, 4);
  assert.equal(whileQueued.queued, 37, 'visible LazyThumb joins the same queue behind 40 ChannelLogo loads');
  await page.waitForFunction(() => {
    const stats = window.__thumbnailLaneStats?.();
    return stats?.active === 0 && stats.queued === 0;
  }, { timeout: 15_000 });
  assert.ok(imageStarts.includes('/thumbs/daily-highlights.jpg'), 'LazyThumb uses the shared lane after ChannelLogo jobs');
  assert.ok(!imageStarts.includes('/thumbs/live.jpg'), 'the offscreen LazyThumb was not requested');

  await page.click('[data-testid="start-failure"]');
  await page.waitForSelector('[data-thumb-source="initials"][aria-label="Synthetic Failure"]');
  assert.ok(maxActiveImages <= 4, `maximum in-flight image requests was ${maxActiveImages}`);
  assert.equal(archiveRequests, 0);
  assert.equal(externalRequests, 0);
  console.log(JSON.stringify({
    viewport: '1280x800',
    admittedChannelLogos: 40,
    inFlightAtStart: initial.active,
    queuedAtStart: initial.queued,
    concurrentLimit: 4,
    maxObservedInFlight: maxActiveImages,
    mediaStartedWithImagesInFlight: mediaAtStart,
    mediaLatencyMs: Math.round(mediaResult.elapsedMs),
    artificialImageDelayMs,
    visibleLazyThumbSharedLane: imageStarts.includes('/thumbs/daily-highlights.jpg'),
    offscreenLazyThumbRequests: imageStarts.filter((path) => path === '/thumbs/live.jpg').length,
    neutralFailureTile: true,
    archiveRequests: 0,
    externalRequests: 0,
  }));
  console.log('PASS thumbnail lane: four-slot shared queue, media independent, offscreen excluded, neutral failure tile, all local synthetic traffic');
  await page.close();
} finally {
  if (browser) await browser.close();
  if (server) await server.close();
}
