import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { createClassicLightFixture } from './test-classic-light-guide-fixture.ts';
import { searchClassicProgramTitles } from './server/classicScheduleSearch.ts';

const channels = createClassicLightFixture();
const routeCounts = new Map();
const requestLog = [];
let viewportName = '';
let externalRequests = 0;
let archiveRequests = 0;
let failChannel050Once = true;
let server;
let browser;

const fixtureApi = {
  name: 'classic-light-guide-synthetic-api',
  configureServer(viteServer) {
    viteServer.middlewares.use((request, response, next) => {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (requestUrl.pathname !== '/api/schedule' && requestUrl.pathname !== '/api/schedule/search') {
        next();
        return;
      }
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Access-Control-Allow-Origin', 'null');

      if (requestUrl.pathname === '/api/schedule/search') {
        const query = requestUrl.searchParams.get('q') ?? '';
        const matches = searchClassicProgramTitles(channels, query);
        requestLog.push({ viewport: viewportName, route: 'search', matches: matches.length });
        response.end(JSON.stringify({ guideId: 'classic-tv', matches }));
        return;
      }

      if (requestUrl.searchParams.get('light') === '1') {
        const lightChannels = channels.map((channel) => ({
          ...channel,
          programs: channel.id === 'demo-channel-050' || channel.id === 'demo-channel-060'
            ? channel.programs.slice(1, 4)
            : channel.programs.slice(0, 3),
          programsComplete: false,
          ...(channel.id === 'demo-channel-050' || channel.id === 'demo-channel-060' ? { hasCurrentProgram: true } : {}),
        }));
        requestLog.push({ viewport: viewportName, route: 'light', channels: lightChannels.length });
        response.end(JSON.stringify({ guideId: 'classic-tv', generatedAt: '2026-01-01T00:00:00.000Z', light: true, channels: lightChannels }));
        return;
      }

      const channelId = requestUrl.searchParams.get('channel');
      if (!channelId) {
        response.statusCode = 400;
        response.end(JSON.stringify({ error: 'channel required in the synthetic test server' }));
        return;
      }
      const nextCount = (routeCounts.get(`${viewportName}:${channelId}`) ?? 0) + 1;
      routeCounts.set(`${viewportName}:${channelId}`, nextCount);
      requestLog.push({ viewport: viewportName, route: 'channel', channelId, count: nextCount });
      if (channelId === 'demo-channel-001' && nextCount === 1) {
        setTimeout(() => {
          if (response.destroyed) return;
          response.end(JSON.stringify({ guideId: 'classic-tv', channels: [channels[0]] }));
        }, 2500);
        return;
      }
      if (channelId === 'demo-channel-050' && failChannel050Once) {
        failChannel050Once = false;
        response.statusCode = 503;
        response.end(JSON.stringify({ error: 'synthetic upstream failure' }));
        return;
      }
      const channel = channels.find((item) => item.id === channelId);
      if (!channel) {
        response.statusCode = 404;
        response.end(JSON.stringify({ error: 'synthetic channel missing' }));
        return;
      }
      if (channelId === 'demo-channel-060') {
        setTimeout(() => {
          if (response.destroyed) return;
          response.end(JSON.stringify({
            guideId: 'classic-tv',
            channels: [{ ...channel, programs: channel.programs.slice(1), hasCurrentProgram: true, programsComplete: true }],
          }));
        }, 2_000);
        return;
      }
      response.end(JSON.stringify({ guideId: 'classic-tv', channels: [{ ...channel, programsComplete: true }] }));
    });
  },
};

function resetForViewport(name) {
  viewportName = name;
  failChannel050Once = true;
  for (const key of [...routeCounts.keys()]) if (key.startsWith(`${name}:`)) routeCounts.delete(key);
  requestLog.length = 0;
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

async function runViewport(viewport) {
  resetForViewport(viewport.name);
  const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('requestfailed', (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  page.setDefaultTimeout(20_000);
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin === serverOrigin) {
      void request.continue();
      return;
    }
    externalRequests++;
    if (url.hostname === 'archive.org' || url.hostname.endsWith('.archive.org')) archiveRequests++;
    void request.abort('blockedbyclient');
  });
  await page.goto(`${serverOrigin}/test-classic-light-guide.html`, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(() => document.querySelector('[data-testid="epg-result-count"]')?.textContent?.includes('80 channels'));
  } catch (error) {
    console.error('[classic-light-guide diagnostic]', JSON.stringify({
      viewport: viewport.name,
      bodyText: await page.$eval('body', (element) => element.innerText.slice(0, 1200)).catch(() => ''),
      pageErrors,
      consoleErrors,
      failedRequests,
      requestLog,
    }));
    throw error;
  }
  await page.waitForSelector('[data-epg-channel-row][data-channel-id="demo-channel-001"]');
  await page.waitForSelector('#epg-prog-demo-channel-001-0');
  await page.evaluate(() => window.scrollTo(0, 0));
  // The first channel request is deliberately held open. Tuning must still use the
  // light current-row data while its full row response is pending.
  await waitForNodeCondition(() => routeCounts.get(`${viewport.name}:demo-channel-001`) === 1, `${viewport.name} channel 001 initial request`);
  await page.waitForSelector('[data-channel-row-loading="demo-channel-001"]');
  await page.click('[data-play-live="demo-channel-001"]');
  await page.waitForFunction(() => window.__classicLightPlayed?.programId === 'demo-channel-001-current');
  assert.equal(routeCounts.get(`${viewport.name}:demo-channel-001`), 1, `${viewport.name}: tuning reuses the in-flight row request`);

  const search = await page.waitForSelector('[data-testid="epg-search"]');
  await search.type('Hidden Program Title Candidate');
  await page.waitForSelector('[data-testid="matched-show"]');
  const matchedTitle = await page.$eval('[data-testid="matched-show"]', (element) => element.textContent ?? '');
  assert.equal(matchedTitle, '↳ DEMO Hidden Program Title Candidate', `${viewport.name}: server title search finds a row absent from light data`);
  assert.ok(requestLog.some((entry) => entry.route === 'search'), `${viewport.name}: on-demand search route used`);
  await page.click('[data-testid="epg-search-clear"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="epg-result-count"]')?.textContent?.includes('80 channels'));

  await page.$$eval('button', (buttons) => {
    const button = buttons.find((candidate) => candidate.textContent?.includes('Load more'));
    button?.click();
  });

  await page.waitForSelector('[data-epg-channel-row][data-channel-id="demo-channel-048"]');
  await page.$eval('[data-epg-channel-row][data-channel-id="demo-channel-048"]', (element) => element.scrollIntoView({ block: 'center' }));
  await waitForNodeCondition(() => routeCounts.get(`${viewport.name}:demo-channel-048`) === 1, `${viewport.name} channel 048 request`);
  const channel048Count = routeCounts.get(`${viewport.name}:demo-channel-048`) ?? 0;
  assert.equal(channel048Count, 1, `${viewport.name}: visible channel fetches once`);

  await page.$eval('[data-epg-channel-row][data-channel-id="demo-channel-060"]', (element) => element.scrollIntoView({ block: 'center' }));
  await page.click('[data-play-live="demo-channel-060"]');
  await waitForNodeCondition(() => routeCounts.get(`${viewport.name}:demo-channel-060`) === 1, `${viewport.name} channel 060 request`);
  await page.waitForSelector('[data-channel-row-loading="demo-channel-060"]');
  await page.waitForFunction(() => document.querySelector('[data-play-live="demo-channel-060"]')?.disabled === true);
  assert.equal(await page.$eval('[data-play-live="demo-channel-060"]', (button) => button.getAttribute('aria-busy')), 'true', `${viewport.name}: play-now announces its loading state`);
  await page.waitForSelector('[data-play-live-no-current="demo-channel-060"]');
  const noCurrentText = await page.$eval('[data-play-live-no-current="demo-channel-060"]', (element) => element.textContent ?? '');
  assert.match(noCurrentText, /No current program was found/, `${viewport.name}: missing current item is reported explicitly`);

  await page.$eval('[data-epg-channel-row][data-channel-id="demo-channel-050"]', (element) => element.scrollIntoView({ block: 'center' }));
  try {
    await page.waitForSelector('[data-channel-row-error="demo-channel-050"]');
  } catch (error) {
    console.error(JSON.stringify({
      viewport: viewport.name,
      channel050Requests: routeCounts.get(`${viewport.name}:demo-channel-050`) ?? 0,
      channel050Loading: await page.$('[data-channel-row-loading="demo-channel-050"]') !== null,
      visibleRows: await page.$$eval('[data-epg-channel-row]', (rows) => rows.length),
      routeNames: requestLog.map((entry) => entry.route === 'channel' ? `channel:${entry.channelId}` : entry.route),
    }));
    throw error;
  }
  await page.click('[data-play-live="demo-channel-050"]');
  await page.waitForSelector('[data-play-live-retry="demo-channel-050"]');
  const playErrorText = await page.$eval('[data-channel-row-error="demo-channel-050"]', (element) => element.textContent ?? '');
  assert.match(playErrorText, /Could not load the current program/, `${viewport.name}: failed Play-now load reports an explicit error`);
  await page.click('[data-play-live-retry="demo-channel-050"]');
  await page.waitForFunction(() => window.__classicLightPlayed?.channelId === 'demo-channel-050' && window.__classicLightPlayed?.programId === 'demo-channel-050-current');
  await page.waitForFunction(() => document.querySelector('[data-channel-row-error="demo-channel-050"]') === null);
  assert.equal(routeCounts.get(`${viewport.name}:demo-channel-050`), 2, `${viewport.name}: retry repeats exactly once`);

  assert.deepEqual(pageErrors, [], `${viewport.name}: Play-now paths do not produce unhandled browser errors`);
  assert.equal(archiveRequests, 0, `${viewport.name}: zero Archive requests`);
  assert.equal(externalRequests, 0, `${viewport.name}: all non-local requests blocked`);
  const rowCount = await page.$$eval('[data-epg-channel-row]', (rows) => rows.length);
  const result = {
    viewport: viewport.name,
    width: viewport.width,
    height: viewport.height,
    initialRows: 40,
    displayedRowsAfterLoadMore: rowCount,
    channel048Requests: channel048Count,
    channel050Requests: routeCounts.get(`${viewport.name}:demo-channel-050`),
    channel001TuneRequests: routeCounts.get(`${viewport.name}:demo-channel-001`),
    titleSearchRequests: requestLog.filter((entry) => entry.route === 'search').length,
    archiveRequests: archiveRequests,
    externalRequests: externalRequests,
  };
  await page.close();
  return result;
}

let serverOrigin = '';
try {
  server = await createServer({
    configFile: './vite.config.ts',
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0, strictPort: false },
    plugins: [fixtureApi],
  });
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Vite did not bind a local test address');
  serverOrigin = `http://127.0.0.1:${address.port}`;
  browser = await puppeteer.launch({
    ...(process.env.PUPPETEER_EXECUTABLE_PATH ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH } : {}),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const results = [];
  for (const viewport of [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1440, height: 800 }]) {
    results.push(await runViewport(viewport));
  }
  console.log(JSON.stringify({ results, apiRequestCount: requestLog.length, archiveRequests: 0, externalRequests: 0 }));
  console.log('PASS classic-light-guide: synthetic phone/desktop; light first paint; complete title search; visible fetch; tune; explicit error/retry; no Archive traffic');
} finally {
  if (browser) await browser.close();
  if (server) await server.close();
}
