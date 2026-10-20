import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { buildAudioLightSchedule } from './server/audioLightSchedule.ts';
import { localHourAt } from './server/scheduleWindow.ts';
import { createAudioLightFixture } from './test-audio-light-guide-fixture.ts';

const fixture = createAudioLightFixture();
const routeCounts = new Map();
const requestLog = [];
let viewportName = '';
let externalRequests = 0;
let archiveRequests = 0;
let server;
let browser;

const fixtureApi = {
  name: 'audio-light-guide-synthetic-api',
  configureServer(viteServer) {
    viteServer.middlewares.use((request, response, next) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/api/schedule') {
        next();
        return;
      }
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');

      const channelId = url.searchParams.get('channel');
      if (url.searchParams.get('light') === '1') {
        const localHour = localHourAt(Date.now(), url.searchParams.get('tz'));
        if (localHour === null) {
          response.statusCode = 400;
          response.end(JSON.stringify({ error: 'synthetic timezone missing' }));
          return;
        }
        const channels = buildAudioLightSchedule(fixture.channels, localHour);
        const body = JSON.stringify({ guideId: 'audio-podcasts', light: true, channels, generatedAt: 'DEMO-SYNTHETIC', source: 'synthetic-fixture' });
        response.setHeader('X-AJN-Light-Raw-Bytes', String(Buffer.byteLength(body)));
        requestLog.push({
          viewport: viewportName,
          route: 'light',
          tzPresent: url.searchParams.has('tz'),
          infowarsRows: channels.find((item) => item.id === 'archive-infowars-radio')?.programs.length ?? 0,
          bytes: Buffer.byteLength(body),
        });
        response.end(body);
        return;
      }
      if (channelId) {
        const count = (routeCounts.get(`${viewportName}:${channelId}`) ?? 0) + 1;
        routeCounts.set(`${viewportName}:${channelId}`, count);
        requestLog.push({ viewport: viewportName, route: 'channel', channelId, count, tzPresent: url.searchParams.has('tz'), ...(channelId === 'item-music-00s-radio-hits-2024' ? { responseDelayMs: 600 } : {}) });
        if (channelId === 'item-music-demo-error' && count === 1) {
          response.statusCode = 503;
          response.end(JSON.stringify({ error: 'DEMO synthetic upstream failure' }));
          return;
        }
        const channel = fixture.channels.find((item) => item.id === channelId);
        if (!channel) {
          response.statusCode = 404;
          response.end(JSON.stringify({ error: 'DEMO synthetic channel missing' }));
          return;
        }
        if (channelId === 'item-music-00s-radio-hits-2024') {
          setTimeout(() => {
            if (response.destroyed) return;
            const body = JSON.stringify({ guideId: 'audio-podcasts', channels: [{ ...channel, programsComplete: true }] });
            response.end(body);
          }, 600);
          return;
        }
        response.end(JSON.stringify({ guideId: 'audio-podcasts', channels: [{ ...channel, programsComplete: true }] }));
        return;
      }

      const lightHour = localHourAt(Date.now(), url.searchParams.get('tz'));
      if (lightHour === null) {
        response.statusCode = 400;
        response.end(JSON.stringify({ error: 'DEMO synthetic tz missing' }));
        return;
      }
      const channels = buildAudioLightSchedule(fixture.channels, lightHour);
      const body = JSON.stringify({ guideId: 'audio-podcasts', light: true, channels, generatedAt: 'DEMO-SYNTHETIC', source: 'synthetic-fixture' });
      response.setHeader('X-AJN-Light-Raw-Bytes', String(Buffer.byteLength(body)));
      requestLog.push({
        viewport: viewportName,
        route: 'light',
        tzPresent: url.searchParams.has('tz'),
        infowarsRows: channels.find((item) => item.id === 'archive-infowars-radio')?.programs.length ?? 0,
        bytes: Buffer.byteLength(body),
      });
      response.end(body);
    });
  },
};

function resetViewport(name) {
  viewportName = name;
  for (const key of [...routeCounts.keys()]) if (key.startsWith(`${name}:`)) routeCounts.delete(key);
  externalRequests = 0;
  archiveRequests = 0;
}

async function waitForNodeCondition(predicate, label, timeoutMs = 10_000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function runViewport(viewport, origin, screensDir) {
  resetViewport(viewport.name);
  const page = await browser.newPage();
  await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });
  page.setDefaultTimeout(15_000);
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin === origin) {
      void request.continue();
      return;
    }
    externalRequests++;
    if (url.hostname === 'archive.org' || url.hostname.endsWith('.archive.org')) archiveRequests++;
    void request.abort('blockedbyclient');
  });

  try {
    await page.goto(`${origin}/test-audio-light-guide.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('[data-testid="epg-result-count"]')?.textContent?.includes('3 channels'));
    await page.waitForSelector('[data-epg-channel-row][data-channel-id="archive-infowars-radio"]');
    const initialLightRequest = requestLog.find((entry) => entry.viewport === viewport.name && entry.route === 'light');
    assert.ok(initialLightRequest?.tzPresent, `${viewport.name}: initial audio request carries tz`);
    assert.equal(initialLightRequest.infowarsRows, 9, `${viewport.name}: untouched demo radio retains nine programs`);

    const targetButton = `#epg-prog-item-music-00s-radio-hits-2024-0`;
    await page.waitForSelector(targetButton);
    const clickedTitle = await page.$eval(targetButton, (element) => element.title);
    const expectedProgramId = fixture.channels[0].programs.find((program) => program.title === clickedTitle)?.id;
    assert.ok(expectedProgramId, `${viewport.name}: clicked demo title maps to a fixture program`);
    const fullRowsStartedAt = Date.now();
    await page.click(targetButton);
    await waitForNodeCondition(() => routeCounts.get(`${viewport.name}:item-music-00s-radio-hits-2024`) === 1, `${viewport.name} full music row request`);
    await page.waitForSelector('[data-channel-row-loading="item-music-00s-radio-hits-2024"]');
    const played = await page.evaluate(() => window.__audioLightPlayed ?? null);
    assert.equal(played?.programId, expectedProgramId, `${viewport.name}: playback starts the exact clicked program ID`);
    const firstChannelRequest = requestLog.find((entry) => entry.viewport === viewport.name && entry.route === 'channel' && entry.channelId === 'item-music-00s-radio-hits-2024');
    assert.equal(firstChannelRequest?.tzPresent, true, `${viewport.name}: on-demand channel request carries tz`);
    await page.waitForFunction(() => !document.querySelector('[data-channel-row-loading="item-music-00s-radio-hits-2024"]'));
    await page.waitForFunction(() => {
      const label = document.querySelector('[data-music-row="item-music-00s-radio-hits-2024"]')?.getAttribute('aria-label') ?? '';
      const count = Number(/,\s*(\d+)\s+(?:tracks|hourly blocks)/.exec(label)?.[1] ?? 0);
      return count > 3;
    });
    const timeToFullRowsMs = Date.now() - fullRowsStartedAt;
    assert.ok(timeToFullRowsMs >= 500, `${viewport.name}: UI row refresh includes the 600 ms stubbed delay`);

    const failureButton = '#epg-prog-item-music-demo-error-0';
    await page.waitForSelector(failureButton);
    await page.click(failureButton);
    await page.waitForSelector('[data-channel-row-error="item-music-demo-error"]');
    await page.click('[data-retry-channel="item-music-demo-error"]');
    await page.waitForFunction(() => !document.querySelector('[data-channel-row-error="item-music-demo-error"]'));
    assert.equal(routeCounts.get(`${viewport.name}:item-music-demo-error`), 2, `${viewport.name}: one failed request and one explicit retry`);

    assert.equal(archiveRequests, 0, `${viewport.name}: no Archive requests`);
    assert.equal(externalRequests, 0, `${viewport.name}: all non-local requests blocked`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(screensDir, `audio-guide-${viewport.name}.png`), fullPage: false });
    return {
      viewport: viewport.name,
      width: viewport.width,
      height: viewport.height,
      initialLightRawBytes: initialLightRequest.bytes,
      infowarsRows: initialLightRequest.infowarsRows,
      fullMusicRequests: routeCounts.get(`${viewport.name}:item-music-00s-radio-hits-2024`),
      timeToFullRowsMs,
      fullMusicRowsAdvertised: await page.$eval('[data-music-row="item-music-00s-radio-hits-2024"]', (element) => element.getAttribute('aria-label')),
      retryRequests: routeCounts.get(`${viewport.name}:item-music-demo-error`),
      archiveRequests,
      externalRequests,
    };
  } finally {
    await page.close();
  }
}

let origin = '';
try {
  const screensDir = path.join(process.cwd(), 'REVIEW', 'screens');
  await mkdir(screensDir, { recursive: true });
  server = await createServer({
    configFile: './vite.config.ts',
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0, strictPort: false },
    plugins: [fixtureApi],
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
  const results = [];
  for (const viewport of [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1440, height: 900 }]) {
    results.push(await runViewport(viewport, origin, screensDir));
  }
  console.log(JSON.stringify({ results, requestLog, externalRequests: 0, archiveRequests: 0 }));
  console.log('PASS audio-light-guide: synthetic fixture; load, row fetch, exact program ID, explicit 503/retry, 390/1440 Chromium, no non-local traffic');
} finally {
  if (browser) await browser.close();
  if (server) await server.close();
}
