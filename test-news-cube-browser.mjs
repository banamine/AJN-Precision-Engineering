import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer';

const port = 4179;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
server.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });
let browser;

async function waitForServer() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Vite test server exited: ${serverOutput}`);
    try {
      const response = await fetch(`${origin}/tests/news-cube/browser.html`);
      if (response.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error(`Vite test server did not start: ${serverOutput}`);
}

try {
  await waitForServer();
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  const outsideRequests = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith(origin)) {
      outsideRequests.push(url);
      void request.abort();
    } else void request.continue();
  });
  await page.setRequestInterception(true);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.goto(`${origin}/tests/news-cube/browser.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__newsCubeHarness));
  await page.waitForFunction(() => window.__newsCubeHarness.getStats().fetchCount >= 1);
  await page.waitForSelector('[data-testid="face-label"]');
  assert.equal(await page.$eval('[data-testid="news-cube-page"]', (node) => getComputedStyle(node).overflowWrap), 'anywhere', 'long headline tokens can wrap without widening the page');
  await page.click('#nav-link-vault');
  await page.waitForSelector('[role="menuitem"]');
  assert.equal(await page.$$eval('[role="menuitem"]', (items) => items.some((item) => item.textContent.includes('NEWS CUBE'))), true, 'Vault includes the NEWS CUBE destination');
  await page.click('[role="menuitem"]#nav-link-news-cube');
  assert.equal((await page.evaluate(() => window.__newsCubeHarness.getStats())).lastDestination, 'news-cube', 'Vault menu routes to News Cube');

  const initial = await page.evaluate(() => window.__newsCubeHarness.getStats());
  assert.equal(initial.fetchCount, 1, 'initial digest is fetched once');
  assert.equal(await page.$$eval('canvas[data-testid="news-cube-canvas"]', (nodes) => nodes.length), 1, 'one visible WebGL canvas');
  const motionButton = await page.$('[data-testid="auto-rotate-toggle"]');
  assert.equal(await motionButton.evaluate((button) => button.disabled), true, 'reduced motion disables auto-rotate');

  await page.click('[data-testid="list-view-toggle"]');
  await page.waitForSelector('[data-testid="list-view"]');
  assert.equal(await page.$$eval('[data-testid^="cube-slot-"]', (nodes) => nodes.length), 36, 'list fallback renders all 36 slots');
  assert.equal(await page.$$eval('a[data-testid^="cube-slot-"]', (nodes) => nodes.length), 8, 'only real fixture articles become links');
  assert.equal(await page.$$eval('[data-testid^="cube-slot-"]:not(a)', (nodes) => nodes.length), 28, 'empty slots remain visibly empty');
  assert.equal(await page.$eval('a[data-testid="cube-slot-0"]', (node) => node.getAttribute('rel')), 'noopener noreferrer');
  assert.equal(outsideRequests.length, 0, 'all non-local requests are blocked');

  await page.click('[data-testid="list-view-toggle"]');
  await page.waitForFunction(() => window.__newsCubeHarness.getStats().prepareCount >= 2);
  const canvas = await page.$('canvas[data-testid="news-cube-canvas"]');
  const bounds = await canvas.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForSelector('[data-testid="detail-card"]');
  assert.equal(await page.$eval('[data-testid="no-media-message"]', (node) => node.textContent.trim()), 'No audio/video for this story.');
  await page.focus('canvas[data-testid="news-cube-canvas"]');
  await page.keyboard.press('Escape');
  assert.equal(await page.$('[data-testid="detail-card"]'), null, 'Escape closes the detail card');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.$eval('[data-testid="face-label"]', (node) => node.textContent), 'Face 2', 'ArrowRight rotates one face');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-testid="detail-card"]');
  await page.click('[data-testid="next-face"]');
  assert.equal(await page.$('[data-testid="detail-card"]'), null, 'face navigation closes the detail card');
  assert.equal((await page.evaluate(() => window.__newsCubeHarness.getStats())).pauseCount, 2, 'keyboard and face navigation both invoke the bridge pause');
  const dragCanvas = await page.$('canvas[data-testid="news-cube-canvas"]');
  const dragBounds = await dragCanvas.boundingBox();
  await page.mouse.move(dragBounds.x + dragBounds.width / 2, dragBounds.y + dragBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(dragBounds.x + dragBounds.width / 2 + 14, dragBounds.y + dragBounds.height / 2, { steps: 1 });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('[data-testid="face-label"]')?.textContent === 'Face 4');
  assert.equal(await page.$('[data-testid="detail-card"]'), null, 'drag past 5 px navigates and is not a click');

  await page.click('[data-testid="list-view-toggle"]');
  await page.waitForSelector('[data-testid="list-view"]');
  await page.evaluate(() => window.__newsCubeHarness.enqueueError('synthetic offline fixture error'));
  await page.evaluate(() => window.__newsCubeHarness.setVisible(true));
  await page.waitForSelector('[data-testid="digest-error"]');
  await page.evaluate(() => window.__newsCubeHarness.setVisible(false));
  assert.equal(await page.$$eval('a[data-testid^="cube-slot-"]', (nodes) => nodes.length), 8, 'failed refresh keeps the last successful data');
  await page.click('[data-testid="digest-error"] button');
  await page.waitForFunction(() => !document.querySelector('[data-testid="digest-error"]'));

  await page.click('[data-testid="list-view-toggle"]');
  await page.waitForFunction(() => window.__newsCubeHarness.getStats().prepareCount >= 3);
  for (let index = 0; index < 3; index += 1) await page.click('[data-testid="previous-face"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="face-label"]')?.textContent === 'Face 1');
  const secondCanvas = await page.$('canvas[data-testid="news-cube-canvas"]');
  const secondBounds = await secondCanvas.boundingBox();
  await page.mouse.click(secondBounds.x + secondBounds.width / 2, secondBounds.y + secondBounds.height / 2);
  await page.waitForSelector('[data-testid="detail-card"]');
  await page.evaluate(() => {
    // The browser fixture generator is test-only; this payload is synthetic and never reaches production.
    const entries = Array.from({ length: 9 }, (_, index) => ({
      id: `synthetic-new-${index}`,
      headline: `Synthetic update headline ${index}`,
      url: `https://publisher.invalid/update/${index}`,
      excerpt: `Synthetic update summary ${index}`,
      published: new Date(Date.parse('2026-10-21T18:00:00Z') - index * 3_600_000).toUTCString(),
      feedName: 'Synthetic updated feed',
      feedId: 'synthetic-updated-feed',
      imageUrl: null,
    }));
    const payload = {
      last_updated: '2026-10-21T18:00:00.000Z',
      stories_count: 9,
      rss_articles_count: 9,
      stories: entries.slice(0, 6),
      rss_feeds_articles: entries,
      scraped_articles: [],
    };
    window.__newsCubeHarness.enqueue(payload);
  });
  await page.evaluate(() => window.__newsCubeHarness.setVisible(true));
  await page.waitForSelector('[data-testid="new-stories-pill"]');
  await page.evaluate(() => window.__newsCubeHarness.setVisible(false));
  await page.click('[data-testid="list-view-toggle"]');
  assert.equal(await page.$$eval('a[data-testid^="cube-slot-"]', (nodes) => nodes.length), 8, 'new feed does not reshuffle while the user is browsing');
  await page.click('[data-testid="new-stories-pill"]');
  await page.waitForFunction(() => document.querySelectorAll('a[data-testid^="cube-slot-"]').length === 9);

  await page.evaluate(() => window.__newsCubeHarness.setVisible(false));
  const hiddenCount = (await page.evaluate(() => window.__newsCubeHarness.getStats())).fetchCount;
  await delay(350);
  assert.equal((await page.evaluate(() => window.__newsCubeHarness.getStats())).fetchCount, hiddenCount, 'polling pauses while hidden');
  await page.evaluate(() => window.__newsCubeHarness.setVisible(true));
  await page.waitForFunction((prior) => window.__newsCubeHarness.getStats().fetchCount > prior, { timeout: 2_000 }, hiddenCount);

  await page.evaluate(() => window.__newsCubeHarness.unmount());
  const finalRendererStats = await page.evaluate(() => window.__newsCubeHarness.getStats());
  assert.equal(finalRendererStats.disposedCount, finalRendererStats.rendererCount, 'every renderer instance is disposed after view switches and unmount');
  assert.equal(outsideRequests.length, 0);
  assert.deepEqual(pageErrors, [], 'browser had no uncaught errors');
  console.log('News Cube browser: PASS (36 slots, 8→9 feed update, failure retention, hidden polling, reduced motion, navigation and disposal; external requests=0)');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  await new Promise((resolve) => {
    if (server.exitCode !== null) return resolve();
    server.once('exit', resolve);
    setTimeout(() => { if (server.exitCode === null) server.kill('SIGKILL'); resolve(); }, 3_000).unref();
  });
}
