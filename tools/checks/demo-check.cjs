const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const dist = path.join(root, 'dist-demo');
const reportDir = path.join(root, 'reports', 'demo');
const videoPath = path.join(dist, 'demo', 'synthetic.webm');
const vttPath = path.join(dist, 'demo', 'english.vtt');
function playwrightModule() {
  const requested = process.env.PLAYWRIGHT_CORE_PATH;
  if (requested) return require(path.resolve(requested));
  try { return require('playwright-core'); } catch {
    throw new Error('playwright-core is not installed; set PLAYWRIGHT_CORE_PATH to the runner-provided module.');
  }
}

function contentType(file) {
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.png': 'image/png',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.vtt': 'text/vtt; charset=utf-8',
  })[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

function startStaticServer() {
  const server = http.createServer((request, response) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); } catch {
      response.writeHead(400).end('invalid path');
      return;
    }
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = path.resolve(dist, relative);
    if (!file.startsWith(`${dist}${path.sep}`) && file !== path.join(dist, 'index.html')) {
      response.writeHead(403).end('forbidden');
      return;
    }
    fs.stat(file, (error, stat) => {
      if (error || !stat.isFile()) {
        response.writeHead(404).end('not found');
        return;
      }
      response.writeHead(200, {
        'content-type': contentType(file),
        'content-length': stat.size,
        'cache-control': 'no-store',
      });
      fs.createReadStream(file).pipe(response);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('No local static server address'));
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

function json(body, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

async function waitForVisibleText(page, testId, expected) {
  await page.waitForFunction(({ id, text }) => {
    const element = document.querySelector(`[data-testid="${id}"]`);
    return element instanceof HTMLElement && (element.getAttribute('aria-label') ?? '').includes(text);
  }, { id: testId, text: expected }, { timeout: 10_000 });
}

async function serveRange(route, fixture, state) {
  const request = route.request();
  const range = request.headers().range;
  if (fixture === 'retry' && state.retryMediaAttempts === 0) {
    state.retryMediaAttempts += 1;
    await route.fulfill({ ...json({ error: 'DEMO — synthetic circuit-open response', errorCode: 'AJN_UPSTREAM_CIRCUIT_OPEN', upstreamStatus: 503, retryAfterSeconds: 8 }, 503) });
    return;
  }
  if (fixture === 'restricted') {
    await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'DEMO — synthetic restricted fixture' }) });
    return;
  }
  if (fixture === 'non-media') {
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>DEMO non-media fixture</title>' });
    return;
  }
  const bytes = fs.readFileSync(videoPath);
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (match) {
      const start = Number(match[1]);
      const requestedEnd = match[2] ? Number(match[2]) : bytes.length - 1;
      const end = Math.min(requestedEnd, bytes.length - 1);
      await route.fulfill({
        status: 206,
      contentType: 'video/webm',
        body: bytes.subarray(start, end + 1),
        headers: { 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${bytes.length}` },
      });
      return;
    }
  }
  await route.fulfill({ status: 200, contentType: 'video/webm', body: bytes, headers: { 'accept-ranges': 'bytes' } });
}

async function main() {
  if (!fs.existsSync(path.join(dist, 'index.html')) || !fs.existsSync(videoPath) || !fs.existsSync(vttPath)) {
    throw new Error('Build the demo first: VITE_AJN_DEMO=1 npm run build:demo');
  }
  fs.mkdirSync(reportDir, { recursive: true });
  const { chromium } = playwrightModule();
  const { server, url } = await startStaticServer();
  const externalRequests = [];
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/repl/tools/bin/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    for (const viewport of [
      { name: 'desktop', width: 1440, height: 900 },
      { name: 'phone', width: 375, height: 740 },
    ]) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
      const page = await context.newPage();
      let activeFixture = 'status';
      const routeState = { retryMediaAttempts: 0 };
      const mediaEvents = [];
      const requests = [];
      page.on('request', (request) => requests.push({ url: request.url(), type: request.resourceType() }));
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
          externalRequests.push(url.href);
          await route.abort('blockedbyclient');
          return;
        }
        if (url.pathname === '/api/archive/subtitles') {
          if (activeFixture === 'no-subtitles') {
            await route.fulfill({ status: 404, contentType: 'text/plain', body: '' });
          } else {
            await route.fulfill({ status: 200, contentType: 'text/vtt; charset=utf-8', body: fs.readFileSync(vttPath) });
          }
          return;
        }
        if (url.pathname === '/api/archive/proxy' && url.searchParams.has('path') && url.searchParams.get('diagnostic') !== '1') {
          mediaEvents.push({ fixture: activeFixture, range: route.request().headers().range ?? null });
          await serveRange(route, activeFixture, routeState);
          return;
        }
        await route.continue();
      });
      await page.goto(`${url}/#demo`, { waitUntil: 'domcontentloaded' });
      await page.getByTestId('demo-banner').waitFor({ state: 'visible' });
      if ((await page.getByTestId('demo-banner').innerText()).trim() !== 'DEMO DATA — not live') {
        throw new Error(`${viewport.name}: demo banner is missing or incorrect`);
      }
      await page.evaluate(() => localStorage.setItem('demo-check', 'DEMO — synthetic storage marker'));
      const storageKeys = await page.evaluate(() => Array.from({ length: localStorage.length }, (_unused, index) => localStorage.key(index) ?? ''));
      if (storageKeys.some((key) => !key.startsWith('ajn.demo.'))) {
        throw new Error(`${viewport.name}: demo wrote a non-prefixed localStorage key: ${storageKeys.join(', ')}`);
      }

      await page.getByTestId('demo-fixture-status').click();
      for (const [choice, expected] of [
        ['demo-archive-checking', 'Archive checking'],
        ['demo-archive-available', 'Archive available'],
        ['demo-archive-slow', 'Archive slow'],
        ['demo-archive-unavailable', 'Archive status unknown'],
        ['demo-archive-unknown', 'Archive not checked'],
        ['demo-archive-playing', 'Archive playing'],
      ]) {
        await page.getByTestId(choice).click();
        await waitForVisibleText(page, 'status-indicator-archive', expected);
      }
      for (const [choice, expected] of [
        ['demo-news-checking', 'News checking'],
        ['demo-news-current', 'News current'],
        ['demo-news-updating', 'News updating'],
        ['demo-news-delayed', 'News delayed'],
        ['demo-news-ready', 'News ready'],
      ]) {
        await page.getByTestId(choice).click();
        await waitForVisibleText(page, 'status-indicator-news', expected);
      }
      await page.getByTestId('demo-offline').click();
      const networkIndicator = page.getByTestId('status-indicator-network');
      await networkIndicator.waitFor({ state: 'visible' });
      if (!(await networkIndicator.innerText()).includes('Offline')) throw new Error(`${viewport.name}: offline status label missing`);
      await page.screenshot({ path: path.join(reportDir, `01_status_${viewport.name}.png`) });

      activeFixture = 'retry';
      routeState.retryMediaAttempts = 0;
      await page.getByTestId('demo-fixture-retry').click();
      try {
        await page.waitForFunction(() => {
          const status = document.querySelector('[data-testid="playback-recovery"]')?.textContent ?? '';
          return status.includes('about 8 s');
        }, null, { timeout: 15_000 });
      } catch (error) {
        const retryText = await page.locator('[data-testid="retry-this-item"]').allTextContents();
        const visibleText = (await page.locator('body').innerText()).slice(0, 2500);
        const videoState = await page.locator('video').first().evaluate((video) => ({ src: video.src, currentSrc: video.currentSrc, errorCode: video.error?.code ?? null }));
        throw new Error(`Retry fixture failed: ${error.message}; media=${JSON.stringify(mediaEvents)}; requests=${JSON.stringify(requests)}; external=${JSON.stringify(externalRequests)}; video=${JSON.stringify(videoState)}; retry=${JSON.stringify(retryText)}; body=${visibleText}`);
      }
      await page.getByTestId('playback-retry').click();
      await page.screenshot({ path: path.join(reportDir, `02_retry_countdown_${viewport.name}.png`) });
      await page.getByTestId('playback-retry').click();
      const retryDeadline = Date.now() + 20_000;
      while (Date.now() < retryDeadline && mediaEvents.length < 2) await new Promise((resolve) => setTimeout(resolve, 100));
      if (mediaEvents.length < 2) throw new Error(`${viewport.name}: retry did not make a second local media request`);
      await page.waitForFunction(() => {
        const video = document.querySelector('video');
        return video instanceof HTMLVideoElement && video.error === null && video.readyState >= 2;
      }, null, { timeout: 15_000 });

      activeFixture = 'subtitles';
      await page.getByTestId('demo-fixture-subtitles').click();
      await page.getByTestId('subtitle-toggle').waitFor({ state: 'visible', timeout: 15_000 });
      await page.screenshot({ path: path.join(reportDir, `03_subtitles_${viewport.name}.png`) });
      activeFixture = 'no-subtitles';
      await page.getByTestId('demo-fixture-no-subtitles').click();
      await page.getByTestId('demo-player-no-subtitles').waitFor({ state: 'visible' });
      await page.getByTestId('subtitle-toggle').waitFor({ state: 'detached', timeout: 10_000 });
      await page.screenshot({ path: path.join(reportDir, `04_no_subtitles_${viewport.name}.png`) });

      activeFixture = 'resume';
      await page.getByTestId('demo-fixture-resume').click();
      await page.getByTestId('resume-prompt').getByText('Resume from 0:42?').waitFor({ state: 'visible', timeout: 15_000 });
      await page.screenshot({ path: path.join(reportDir, `05_resume_prompt_${viewport.name}.png`) });
      await page.getByTestId('resume-prompt').waitFor({ state: 'detached', timeout: 12_000 });

      activeFixture = 'restricted';
      await page.getByTestId('demo-fixture-restricted').click();
      await page.waitForFunction(() => document.querySelector('[data-testid="playback-recovery"]')?.textContent?.includes('restricted by Archive (403)'), null, { timeout: 15_000 });
      await page.screenshot({ path: path.join(reportDir, `06_restricted_${viewport.name}.png`) });

      activeFixture = 'nested-cyrillic';
      await page.getByTestId('demo-fixture-nested-cyrillic').click();
      await page.getByTestId('demo-nested-path').getByText(/Демо\/папка\/Клип/).waitFor({ state: 'visible' });
      await page.screenshot({ path: path.join(reportDir, `07_nested_cyrillic_${viewport.name}.png`) });

      activeFixture = 'non-media';
      await page.getByTestId('demo-fixture-non-media').click();
      await page.waitForFunction(() => document.querySelector('[data-testid="playback-recovery"]')?.textContent?.includes('UPSTREAM_NON_MEDIA'), null, { timeout: 15_000 });
      await page.screenshot({ path: path.join(reportDir, `08_non_media_${viewport.name}.png`) });

      activeFixture = 'bannedvideo';
      await page.getByTestId('demo-fixture-bannedvideo').click();
      await page.getByTestId('bannedvideo-wall').waitFor({ state: 'visible' });
      await page.getByTestId('bannedvideo-demo-banner').waitFor({ state: 'visible' });
      if (await page.getByTestId('bannedvideo-banner').count()) throw new Error(`${viewport.name}: real BANNED VIDEO banner appeared in the synthetic demo`);
      const syntheticTitles = await page.locator('[data-testid^="bannedvideo-panel-"] p[title]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('title') ?? ''));
      if (syntheticTitles.length === 0 || syntheticTitles.some((title) => !title.startsWith('DEMO — synthetic video'))) {
        throw new Error(`${viewport.name}: BANNED VIDEO demo used a non-synthetic title: ${JSON.stringify(syntheticTitles)}`);
      }
      await page.getByTestId('demo-simulate-embed-blocked').check();
      await page.getByTestId('bannedvideo-load-1').click();
      await page.getByTestId('bannedvideo-demo-embed-state-1').getByText(/embed blocked \(simulated\)/).waitFor({ state: 'visible' });
      await page.screenshot({ path: path.join(reportDir, `09_bannedvideo_blocked_${viewport.name}.png`) });

      await page.getByTestId('bannedvideo-network-rav').click();
      await page.getByTestId('bannedvideo-rav-empty').waitFor({ state: 'visible' });
      await page.screenshot({ path: path.join(reportDir, `10_rav_empty_${viewport.name}.png`) });
      await page.getByTestId('bannedvideo-network-ajn').click();
      const lowCountValue = await page.getByTestId('bannedvideo-channel-filter').locator('option').evaluateAll((options) => {
        const option = options.find((entry) => {
          const match = /\((\d+)\)\s*$/.exec(entry.textContent ?? '');
          return match && Number(match[1]) < 4 && entry.value !== 'all';
        });
        return option?.value ?? '';
      });
      if (!lowCountValue) throw new Error(`${viewport.name}: no AJN sub-channel under four items in supplied snapshot`);
      await page.getByTestId('bannedvideo-channel-filter').selectOption(lowCountValue);
      await page.screenshot({ path: path.join(reportDir, `11_low_count_subchannel_${viewport.name}.png`) });
      await context.close();
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
  if (externalRequests.length > 0) throw new Error(`External requests were attempted (${externalRequests.length}): ${externalRequests.join(', ')}`);
  const screenshots = fs.readdirSync(reportDir).filter((file) => file.endsWith('.png'));
  if (screenshots.length !== 22) throw new Error(`Expected 22 desktop/phone PNG screenshots, got ${screenshots.length}`);
  console.log(`PASS demo browser checks: 2 viewports; status, retry, subtitles, no-subtitles, resume, restricted, nested Cyrillic, non-media, BANNED VIDEO, RAV empty, low-count sub-channel; ${screenshots.length} PNGs`);
  console.log('PASS non-local browser requests: 0');
  console.log('PASS demo storage keys all use ajn.demo.*');
}

main().catch((error) => {
  console.error(`FAIL demo-check: ${error.stack ?? error.message}`);
  process.exitCode = 1;
});
