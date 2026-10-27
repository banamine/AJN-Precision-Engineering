#!/usr/bin/env node
/* Hermetic Cloud Run-shape and player-resume check.
 * All Archive/upstream fetches in the child server are replaced with local fixtures;
 * the browser blocks every non-local request and serves synthetic media from memory.
 * Set PLAYWRIGHT_CORE_PATH or NODE_PATH and REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE
 * when using the workspace-provided Chromium/Playwright installation.
 */
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const net = require('node:net');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const root = path.resolve(__dirname, '../..');
const port = Number(process.env.AJN_SMOKE_PORT || 8080);
const baseUrl = `http://127.0.0.1:${port}`;
const archiveRequests = [];
const blockedExternal = [];
const serverLogs = [];
const browserErrors = [];
let server;
let vite;
let browser;

function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_CORE_PATH,
    'playwright-core',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { return require(candidate); } catch { /* try the next workspace-provided location */ }
  }
  throw new Error('playwright-core is not installed; set PLAYWRIGHT_CORE_PATH or NODE_PATH to the runner-provided module');
}

function makeWav(seconds = 80) {
  const sampleRate = 8_000;
  const sampleCount = sampleRate * seconds;
  const pcmBytes = sampleCount * 2;
  const wav = Buffer.alloc(44 + pcmBytes);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + pcmBytes, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(pcmBytes, 40);
  for (let i = 0; i < sampleCount; i++) {
    const value = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 1000);
    wav.writeInt16LE(value, 44 + i * 2);
  }
  return wav;
}

function makeWebm() {
  const result = spawnSync('ffmpeg', [
    '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=5',
    '-t', '80', '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8',
    '-b:v', '40k', '-f', 'webm', 'pipe:1',
  ], { cwd: root, encoding: 'buffer', maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0 || !result.stdout?.length) {
    throw new Error(`synthetic video generation failed: ${String(result.stderr || '').slice(-1000)}`);
  }
  return result.stdout;
}

function waitForServer(child, timeoutMs = 45_000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let settled = false;
    const poll = async () => {
      while (!settled && Date.now() - started < timeoutMs) {
        if (child.exitCode !== null) return reject(new Error(`server exited ${child.exitCode}; log tail: ${serverLogs.slice(-30).join('')}`));
        try {
          const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1_000) });
          if (response.ok) {
            const body = await response.json();
            if (body?.service) {
              settled = true;
              return resolve(Date.now() - started);
            }
          }
        } catch { /* keep waiting until the fixed startup deadline */ }
        await delay(250);
      }
      if (!settled) reject(new Error(`server did not become healthy within ${timeoutMs} ms; log tail: ${serverLogs.slice(-30).join('')}`));
    };
    void poll();
  });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  const exited = Promise.race([
    once(child, 'exit').then(() => true),
    delay(3_000).then(() => false),
  ]);
  if (!(await exited)) {
    child.kill('SIGKILL');
    await Promise.race([once(child, 'exit'), delay(2_000)]);
  }
}

async function startProductionStubServer() {
  const bundle = path.join(root, 'dist/server.cjs');
  const code = `
    const toUrl = (value) => value instanceof Request ? value.url : String(value);
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(toUrl(input));
      if (url.hostname === 'archive.org' && url.pathname.startsWith('/download/')) {
        const range = new Headers(init.headers || (input instanceof Request ? input.headers : undefined)).get('range') || '';
        if (/^bytes=0-0$/i.test(range)) {
          return new Response(new Uint8Array([0]), { status: 206, headers: {
            'content-type': 'video/mp4', 'content-length': '1', 'content-range': 'bytes 0-0/1024',
            'accept-ranges': 'bytes', 'access-control-allow-origin': '*'
          } });
        }
        return new Response(null, { status: 416, headers: { 'content-range': 'bytes */1024' } });
      }
      if (url.hostname === 'archive.org') {
        if (url.pathname === '/') return new Response(null, { status: 503 });
        return new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } });
      }
      if (url.hostname === 'www.gstatic.com') return new Response(null, { status: 204 });
      return new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } });
    };
    require(${JSON.stringify(bundle)});
  `;
  server = spawn(process.execPath, ['-e', code], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      AJN_BOOT_WARMERS: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => serverLogs.push(String(chunk)));
  server.stderr.on('data', (chunk) => serverLogs.push(String(chunk)));
  const readyMs = await waitForServer(server);
  console.log(`PASS local production-mode server ready in ${readyMs} ms (all upstream fetches stubbed)`);
}

async function verifyProductionRoutes() {
  const healthResponse = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(5_000) });
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  assert.equal(typeof health.service, 'string');

  const statusResponse = await fetch(`${baseUrl}/api/archive/status`, { signal: AbortSignal.timeout(5_000) });
  assert.equal(statusResponse.status, 200);
  assert.equal(statusResponse.headers.get('cache-control'), 'no-store');
  const status = await statusResponse.json();
  for (const field of ['lastTransitionReason', 'lastTransitionAt', 'lastCountedEvents']) {
    assert.ok(Object.hasOwn(status, field), `archive status has ${field}`);
  }
  assert.ok(Array.isArray(status.lastCountedEvents));
  assert.ok(status.lastCountedEvents.length <= 5);

  const itemPath = '/download/synthetic-resume-check/fixture.mp4';
  const proxyResponse = await fetch(`${baseUrl}/api/archive/proxy?path=${encodeURIComponent(itemPath)}`, {
    headers: { Range: 'bytes=0-0', 'User-Agent': 'AJN-local-resume-check/1.0' },
    signal: AbortSignal.timeout(10_000),
  });
  const body = await proxyResponse.arrayBuffer();
  assert.equal(proxyResponse.status, 206);
  assert.ok(proxyResponse.headers.get('content-range'));
  assert.ok(body.byteLength <= 8 * 1024 * 1024);
  console.log(`PASS production route checks: /api/health 200; /api/archive/status 200 with new fields; proxy 206, Content-Range=${proxyResponse.headers.get('content-range')}, body=${body.byteLength} B`);
  console.log('Archive itself was not contacted; the child server used only the in-memory fetch stub.');
}

async function installBrowserMocks(context, baseOrigin, wav) {
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'archive.org' || url.hostname.endsWith('.archive.org')) {
      archiveRequests.push(`${route.request().method()} ${url.hostname}${url.pathname}`);
      return route.abort();
    }
    if (url.origin !== baseOrigin) {
      blockedExternal.push(url.origin);
      return route.abort();
    }
    if (url.pathname === '/api/archive/status') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ state: 'down', since: Date.now() - 5_000 }),
      });
    }
    if (url.pathname === '/api/archive/proxy') {
      return route.fulfill({
        status: 200,
        contentType: 'audio/wav',
        headers: { 'accept-ranges': 'bytes', 'access-control-allow-origin': '*' },
        body: wav,
      });
    }
    if (url.pathname.startsWith('/api/')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return route.continue();
  });
}

async function verifyAudioRestore(chromium, wav) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const failedRequests = [];
  const consoleErrors = [];
  page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await installBrowserMocks(context, new URL(baseUrl).origin, wav);
  const proxySrc = '/api/archive/proxy?path=%2Fdownload%2Fsynthetic-resume-check%2Ftone.wav';
  await page.addInitScript(({ src }) => {
    const now = Date.now();
    localStorage.setItem('ajn.recentlyPlayed.v1', JSON.stringify([{
      id: 'synthetic-audio-no-program-id',
      src,
      archivePath: 'https://archive.org/download/synthetic-resume-check/tone.wav',
      title: 'DEMO — synthetic audio resume',
      mediaType: 'audio',
      progressSeconds: 42,
      updatedAt: now,
    }]));
    localStorage.setItem(`ajn-playback-position:${src}`, '42');
  }, { src: proxySrc });
  await page.goto(`${baseUrl}/#player`, { waitUntil: 'domcontentloaded' });
  const resume = page.getByTestId('autoplay-blocked');
  await resume.waitFor({ state: 'visible', timeout: 15_000 });
  assert.match(await resume.innerText(), /Resume where you left off/);
  const audio = page.locator('audio').first();
  await audio.waitFor({ state: 'attached' });
  await resume.click();
  try {
    await page.waitForFunction(() => {
    const el = document.querySelector('audio');
    return Boolean(el && Number.isFinite(el.duration) && el.duration >= 70);
    }, null, { timeout: 15_000 });
  } catch {
    const mediaState = await audio.evaluate((el) => ({
      src: el.currentSrc,
      srcAttribute: el.getAttribute('src'),
      readyState: el.readyState,
      networkState: el.networkState,
      duration: el.duration,
      errorCode: el.error?.code ?? null,
      paused: el.paused,
    }));
    throw new Error(`synthetic audio did not load metadata: ${JSON.stringify(mediaState)}; failed=${JSON.stringify(failedRequests)}; console=${JSON.stringify(consoleErrors)}`);
  }
  await page.waitForFunction(() => {
    const el = document.querySelector('audio');
    return Boolean(el && !el.paused && el.currentTime >= 42 && el.currentTime <= 47);
  }, null, { timeout: 15_000 });
  // Mocked server state is 'down'; real Archive progress must flip the top-row indicator to "Archive playing" (green).
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="status-indicator-archive"]');
    return Boolean(el && el.getAttribute('data-tone') === 'ok' && /Archive playing/.test(el.getAttribute('aria-label') || ''));
  }, null, { timeout: 5_000 });
  assert.equal(await page.locator('[role="dialog"], [data-testid="archive-outage-banner"], [data-testid="news-ready-dock"]').count(), 0, 'no auto-opened report or legacy banner');
  const position = await audio.evaluate((el) => Number(el.currentTime.toFixed(2)));
  assert.equal(archiveRequests.length, 0);
  assert.deepEqual(browserErrors, []);
  await context.close();
  console.log(`PASS audio resume without programId: user tap resumed at ${position}s (target 42s ±5s); Archive indicator shows playing (not down) after Archive progress; Archive browser requests=0`);
}

async function startVite() {
  const port = await new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => {
      const address = socket.address();
      const selected = address && typeof address === 'object' ? address.port : null;
      socket.close((error) => error ? reject(error) : resolve(selected));
    });
  });
  assert.ok(port, 'Vite test server obtained a local port');
  const viteBin = path.join(root, 'node_modules/vite/bin/vite.js');
  vite = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: root,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  vite.stdout.on('data', (chunk) => logs.push(String(chunk)));
  vite.stderr.on('data', (chunk) => logs.push(String(chunk)));
  const origin = `http://127.0.0.1:${port}`;
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    if (vite.exitCode !== null) throw new Error(`Vite exited ${vite.exitCode}: ${logs.slice(-20).join('')}`);
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return origin;
    } catch { /* fixed startup deadline */ }
    await delay(250);
  }
  throw new Error(`Vite did not become ready: ${logs.slice(-20).join('')}`);
}

async function verifyVideoResume(chromium) {
  const webm = makeWebm();
  const origin = await startVite();
  const context = await browser.newContext();
  const page = await context.newPage();
  const videoErrors = [];
  page.on('pageerror', (error) => videoErrors.push(error.message));
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'archive.org' || url.hostname.endsWith('.archive.org')) {
      archiveRequests.push(`${route.request().method()} ${url.hostname}${url.pathname}`);
      return route.abort();
    }
    if (url.origin !== origin) {
      blockedExternal.push(url.origin);
      return route.abort();
    }
    if (url.pathname === '/synthetic-resume-check.webm') {
      return route.fulfill({ status: 200, contentType: 'video/webm', body: webm });
    }
    if (url.pathname.startsWith('/api/')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    if (url.pathname === '/src/main.tsx') return route.abort();
    return route.continue();
  });
  await page.addInitScript(() => localStorage.setItem('ajn-playback-position:/synthetic-resume-check.webm', '42'));
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    const ReactModule = await import('/node_modules/.vite/deps/react.js');
    const ReactDOMModule = await import('/node_modules/.vite/deps/react-dom_client.js');
    const PlayerModule = await import('/src/MinimalPlayer.tsx');
    const React = ReactModule.default || ReactModule;
    const ReactDOM = ReactDOMModule.default || ReactDOMModule;
    const rootElement = document.createElement('div');
    rootElement.id = 'resume-check-root';
    document.body.append(rootElement);
    ReactDOM.createRoot(rootElement).render(React.createElement(PlayerModule.default, {
      src: '/synthetic-resume-check.webm',
      title: 'DEMO — synthetic video resume',
      mediaType: 'video',
      nowPlaying: { src: '/synthetic-resume-check.webm', title: 'DEMO — synthetic video resume', mediaType: 'video' },
    }));
  });
  const prompt = page.getByTestId('resume-prompt');
  await prompt.waitFor({ state: 'visible', timeout: 20_000 });
  assert.match(await prompt.innerText(), /Resume from 0:42\?/);
  assert.deepEqual(videoErrors, []);
  assert.equal(archiveRequests.length, 0);
  await context.close();
  console.log(`PASS video resume: in-player prompt shows 0:42 from synthetic local storage; Archive browser requests=${archiveRequests.length}`);
}

async function main() {
  const { chromium: playwrightChromium } = loadPlaywright();
  const executablePath = process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE
    || process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  browser = await playwrightChromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox'],
  });
  await startProductionStubServer();
  await verifyProductionRoutes();
  const wav = makeWav();
  await verifyAudioRestore(playwrightChromium, wav);
  await verifyVideoResume(playwrightChromium);
  assert.equal(archiveRequests.length, 0, 'no browser Archive request is allowed');
  console.log(`RESUME_CHECK_PASS archive_requests=${archiveRequests.length} blocked_external_origins=${new Set(blockedExternal).size}`);
}

main()
  .catch((error) => {
    console.error(`RESUME_CHECK_FAIL ${error?.stack || error}`);
    if (serverLogs.length) console.error(`server log tail:\n${serverLogs.slice(-30).join('')}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await stopChild(vite);
    await stopChild(server);
    await browser?.close().catch(() => {});
  });
