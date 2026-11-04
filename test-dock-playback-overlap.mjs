// Issue #51: with media ACTIVELY PLAYING through the real player, the mini dock must not cover guide filters,
// channel actions or the bottom navigation (390px phone and 1376px desktop); the Radio toggle must stay reachable;
// the podcast visualizer must read the one shared analyser. Local fixtures only: no Archive traffic.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { createClassicLightFixture } from './test-classic-light-guide-fixture.ts';

const VIDEO_FIXTURE = await readFile(path.join(process.cwd(), 'testFixtures', 'dock-playback-clip.webm'));
const VIEWPORTS = [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1376, height: 900 }];

// 11.025 kHz mono 16-bit sine, 30 s, built in memory so no binary audio file is needed.
function buildToneWav(seconds = 30, rate = 11025) {
  const samples = seconds * rate;
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const t = i / rate;
    const v = 0.35 * Math.sin(2 * Math.PI * 440 * t) + 0.2 * Math.sin(2 * Math.PI * 1320 * t) + 0.1 * Math.sin(2 * Math.PI * 3300 * t);
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}
const AUDIO_FIXTURE = buildToneWav();

function serveBytes(request, response, bytes, type) {
  response.setHeader('Content-Type', type);
  response.setHeader('Accept-Ranges', 'bytes');
  response.setHeader('Cache-Control', 'no-store');
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '');
  if (!range) { response.statusCode = 200; response.setHeader('Content-Length', String(bytes.length)); response.end(bytes); return; }
  const start = range[1] === '' ? Math.max(0, bytes.length - Number(range[2])) : Number(range[1]);
  const end = range[1] !== '' && range[2] !== '' ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
  response.statusCode = 206;
  response.setHeader('Content-Range', `bytes ${start}-${end}/${bytes.length}`);
  response.setHeader('Content-Length', String(end - start + 1));
  response.end(bytes.subarray(start, end + 1));
}

// ---- synthetic guides: every media URL points at the two local fixtures -------------------------------------------
const VIDEO_URL = '/__fixture__/clip.webm';
const AUDIO_URL = '/__fixture__/tone.wav';
const classicChannels = createClassicLightFixture().map((channel) => ({
  ...channel,
  programs: channel.programs.map((p) => ({ ...p, mediaUrl: VIDEO_URL, archivePath: VIDEO_URL })),
}));
const podChannels = Array.from({ length: 3 }, (_, c) => {
  const id = `pod-fixture-${c + 1}`;
  return {
    id, guideId: 'audio-podcasts', name: `DEMO — Synthetic Podcast ${c + 1}`, mediaType: 'audio', group: 'Synthetic podcasts', sourceStatus: 'snapshot',
    programs: Array.from({ length: 4 }, (_, i) => ({
      id: `${id}-ep-${i}`, guideId: 'audio-podcasts', channelId: id, title: `DEMO — Synthetic episode ${i + 1}`,
      startTime: i === 0 ? 0 : 23 + i, endTime: i === 0 ? 24 : 24 + i, startHour: i === 0 ? 0 : 23 + i, endHour: i === 0 ? 24 : 24 + i,
      mediaType: 'audio', mediaUrl: AUDIO_URL, archivePath: AUDIO_URL,
    })),
  };
});

const unstubbed = [];
const fixtureApi = {
  name: 'dock-playback-fixture-api',
  configureServer(viteServer) {
    viteServer.middlewares.use((request, response, next) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/__fixture__/clip.webm') { serveBytes(request, response, VIDEO_FIXTURE, 'video/webm'); return; }
      if (url.pathname === '/__fixture__/tone.wav') { serveBytes(request, response, AUDIO_FIXTURE, 'audio/wav'); return; }
      if (!url.pathname.startsWith('/api/')) { next(); return; }
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('Cache-Control', 'no-store');
      if (url.pathname === '/api/guides') {
        response.end(JSON.stringify({ guides: [
          { id: 'classic-tv', name: 'Classic TV', type: 'video', enabled: true },
          { id: 'audio-podcasts', name: 'Audio & Podcasts', type: 'audio', enabled: true },
        ] }));
        return;
      }
      if (url.pathname === '/api/schedule') {
        const guide = url.searchParams.get('guide');
        const channelId = url.searchParams.get('channel');
        if (guide === 'classic-tv') {
          if (channelId) {
            const channel = classicChannels.find((item) => item.id === channelId);
            response.end(JSON.stringify({ guideId: guide, channels: channel ? [{ ...channel, programsComplete: true }] : [] }));
            return;
          }
          response.end(JSON.stringify({ guideId: guide, light: true, generatedAt: '2026-01-01T00:00:00.000Z', channels: classicChannels.map((channel) => ({
            ...channel, programs: channel.programs.slice(0, 3), programsComplete: false,
          })) }));
          return;
        }
        if (guide === 'audio-podcasts') {
          // No `light: true`: the app caches this as a complete schedule (same path a real full audio response takes).
          const rows = channelId ? podChannels.filter((item) => item.id === channelId) : podChannels;
          response.end(JSON.stringify({ guideId: guide, generatedAt: '2026-01-01T00:00:00.000Z', channels: rows.map((c) => ({ ...c, programsComplete: true })) }));
          return;
        }
      }
      unstubbed.push(url.pathname + url.search);
      response.statusCode = 404;
      response.end(JSON.stringify({ error: 'not stubbed in dock playback test' }));
    });
  },
};

// ---- browser-side instrumentation: counts the audio graph so "shared analyser" is measured, not assumed ----------
const AUDIO_PROBE = () => {
  const stats = { contexts: 0, analysersCreated: 0, mediaSources: 0, reads: [] };
  const ids = new WeakMap(); let nextId = 0;
  const idOf = (node) => { if (!ids.has(node)) ids.set(node, ++nextId); return ids.get(node); };
  window.__audioProbe = {
    stats,
    snapshot() {
      const perAnalyser = {};
      for (const r of stats.reads) { const k = `${r.id}:fft${r.fft}`; perAnalyser[k] = (perAnalyser[k] ?? 0) + 1; }
      return { contexts: stats.contexts, analysersCreated: stats.analysersCreated, mediaSources: stats.mediaSources, perAnalyser, readsWithLength128: stats.reads.filter((r) => r.len === 128).length };
    },
  };
  const NativeAC = window.AudioContext || window.webkitAudioContext; // captured BEFORE the counting subclass replaces it
  for (const name of ['AudioContext', 'webkitAudioContext']) {
    const Native = window[name];
    if (!Native) continue;
    window[name] = class extends Native { constructor(...a) { super(...a); stats.contexts++; } };
  }
  const proto = (window.BaseAudioContext || AudioContext).prototype;
  const origAnalyser = proto.createAnalyser;
  proto.createAnalyser = function (...a) { stats.analysersCreated++; return origAnalyser.apply(this, a); };
  const ctxProto = NativeAC.prototype;
  const sourceHost = Object.prototype.hasOwnProperty.call(ctxProto, 'createMediaElementSource') ? ctxProto : proto;
  const origSource = sourceHost.createMediaElementSource;
  sourceHost.createMediaElementSource = function (...a) { stats.mediaSources++; return origSource.apply(this, a); };
  const hookRead = (method) => {
    const orig = AnalyserNode.prototype[method];
    AnalyserNode.prototype[method] = function (arr) { stats.reads.push({ id: idOf(this), fft: this.fftSize, len: arr?.length ?? 0 }); return orig.call(this, arr); };
  };
  hookRead('getByteFrequencyData'); hookRead('getByteTimeDomainData'); hookRead('getFloatFrequencyData'); hookRead('getFloatTimeDomainData');
};

let server;
let browser;
let origin = '';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- in-page geometry helpers (serialised into the page) ---------------------------------------------------------
const PAGE_HELPERS = () => {
  const r = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
  const intersects = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
  /** The element must be on screen, not overlap the dock rectangle, and be the topmost thing at its own centre. */
  window.__probeTarget = (selector, index = 0) => {
    const els = Array.from(document.querySelectorAll(selector));
    const el = index === -1 ? els[els.length - 1] : els[index];
    if (!el) return { found: false, selector };
    const dock = document.querySelector('#persistent-mini-player');
    const box = r(el);
    const cx = box.left + box.width / 2; const cy = box.top + box.height / 2;
    const top = document.elementFromPoint(cx, cy);
    return {
      found: true, selector, box,
      onScreen: box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth,
      overlapsDock: dock ? intersects(box, r(dock)) : false,
      hitIsTarget: Boolean(top && (top === el || el.contains(top) || top.contains(el) && top !== document.body && !top.matches('main, #root, body, html'))),
      hitTag: top ? `${top.tagName.toLowerCase()}${top.id ? '#' + top.id : ''}` : null,
    };
  };
};

async function probe(page, selector, index = 0) {
  return page.evaluate((s, i) => window.__probeTarget(s, i), selector, index);
}

function assertClear(info, label, { insideDock = false } = {}) {
  assert.ok(info.found, `${label}: element ${info.selector} exists`);
  assert.ok(info.onScreen, `${label}: ${info.selector} is on screen (box ${JSON.stringify(info.box)})`);
  // Dock controls (the Radio toggle) live INSIDE the dock by design, so they must overlap it; everything else must not.
  if (!insideDock) assert.equal(info.overlapsDock, false, `${label}: ${info.selector} does not overlap the dock (box ${JSON.stringify(info.box)})`);
  assert.ok(info.hitIsTarget, `${label}: ${info.selector} is the topmost element at its centre (got ${info.hitTag})`);
}

// The guide virtualises rows and grows as you scroll, so "bottom" is only real once the page height stops changing.
async function scrollTo(page, where) {
  if (where === 'top') { await page.evaluate(() => window.scrollTo(0, 0)); await wait(200); return; }
  let last = -1; let stable = 0;
  for (let i = 0; i < 25 && stable < 3; i++) {
    const h = await page.evaluate(() => { window.scrollTo(0, document.documentElement.scrollHeight); return document.documentElement.scrollHeight; });
    stable = h === last ? stable + 1 : 0; last = h;
    await wait(150);
  }
}

async function dockRect(page) {
  return page.evaluate(() => {
    const dock = document.querySelector('#persistent-mini-player');
    if (!dock) return null;
    const b = dock.getBoundingClientRect();
    return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height, vw: innerWidth, vh: innerHeight };
  });
}

async function waitPlaying(page, kind) {
  await page.waitForFunction((k) => {
    const el = document.querySelector(`#persistent-player ${k}`);
    return Boolean(el && !el.paused && el.currentTime > 0.4 && el.readyState >= 3);
  }, { timeout: 30_000 }, kind);
}

/** The core assertion set for one playing guide at one viewport. */
async function assertDockClearsGuide(page, viewport, guideLabel, firstChannelId, results) {
  const label = `${viewport.name}/${guideLabel}`;
  await page.waitForSelector('#persistent-mini-player', { timeout: 15_000 });
  const status = await page.$eval('[data-testid="dock-status"]', (el) => el.getAttribute('data-status'));
  assert.equal(status, 'playing', `${label}: dock reports real playback state`);

  const dock = await dockRect(page);
  assert.ok(dock.left >= 0 && dock.right <= dock.vw && dock.top >= 0 && dock.bottom <= dock.vh, `${label}: dock stays inside the viewport ${JSON.stringify(dock)}`);

  // Bottom navigation (phone) / not rendered (desktop).
  const navInfo = await page.evaluate(() => {
    const nav = document.querySelector('#mobile-bottom-nav');
    if (!nav) return { present: false, shown: false };
    const shown = getComputedStyle(nav).display !== 'none';
    return { present: true, shown, top: nav.getBoundingClientRect().top };
  });
  if (viewport.name === 'phone') {
    assert.ok(navInfo.shown, `${label}: bottom navigation is visible on phone`);
    assert.ok(dock.bottom <= navInfo.top + 1, `${label}: dock bottom (${dock.bottom}) sits above bottom navigation top (${navInfo.top})`);
    const count = await page.$$eval('#mobile-bottom-nav button, #mobile-bottom-nav a', (els) => els.length);
    assert.ok(count >= 4, `${label}: bottom navigation has its buttons (${count})`);
    for (let i = 0; i < count; i++) assertClear(await probe(page, '#mobile-bottom-nav button, #mobile-bottom-nav a', i), `${label} bottom-nav[${i}]`);
  } else {
    assert.ok(!navInfo.shown, `${label}: bottom navigation is hidden on desktop`);
  }

  // Guide filters at the top of the page, then channel actions and "Load more" at the very bottom.
  await scrollTo(page, 'top');
  await page.$eval('[data-epg-filters]', (el) => el.scrollIntoView({ block: 'start' }));
  await page.evaluate(() => window.scrollBy(0, -140));
  await wait(150);
  assertClear(await probe(page, '[data-testid="epg-search"]'), `${label} filters search`);
  assertClear(await probe(page, '[data-testid="epg-on-now"]'), `${label} filters on-now`);
  const categoryCount = await page.$$eval('[data-testid="epg-categories"] button', (els) => els.length);
  if (categoryCount > 0) {
    assertClear(await probe(page, '[data-testid="epg-categories"] button', 0), `${label} first category`);
    assertClear(await probe(page, '[data-testid="epg-categories"] button', categoryCount - 1), `${label} last category`);
  }
  assertClear(await probe(page, `[data-play-live="${firstChannelId}"]`), `${label} first channel play-now`);

  await scrollTo(page, 'bottom');
  const lastPlay = await probe(page, '[data-epg-channel-row] [data-play-live]', -1);
  assertClear(lastPlay, `${label} last channel play-now at page bottom`);
  const lastRowBottom = await page.evaluate(() => { const rows = document.querySelectorAll('[data-epg-channel-row]'); return rows[rows.length - 1].getBoundingClientRect().bottom; });
  const dockAtBottom = await dockRect(page);
  const geo = await page.evaluate(() => {
    const lm = Array.from(document.querySelectorAll('button')).find((x) => /load more/i.test(x.textContent ?? ''));
    const main = document.querySelector('#canonical-main-viewport');
    return { loadMoreBottom: lm?.getBoundingClientRect().bottom ?? null, mainBottom: main?.getBoundingClientRect().bottom ?? null, docH: document.documentElement.scrollHeight, scrollY: Math.round(scrollY), vh: innerHeight, lastChildBottom: main?.lastElementChild?.getBoundingClientRect().bottom ?? null };
  });
  if (process.env.DOCK_TEST_DEBUG) console.error('[geo]', label, JSON.stringify({ lastRowBottom, dockTop: dockAtBottom.top, ...geo }));
  assert.ok(lastRowBottom <= dockAtBottom.top + 0.5, `${label}: last channel row (${lastRowBottom}) ends above the dock (${dockAtBottom.top}) at the settled page bottom ${JSON.stringify(geo)}`);
  const loadMore = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => /load more/i.test(x.textContent ?? ''));
    if (!b) return false; b.setAttribute('data-test-load-more', '1'); return true;
  });
  if (loadMore) assertClear(await probe(page, '[data-test-load-more="1"]'), `${label} Load more at page bottom`);
  results.push({ label, dock: dockAtBottom, loadMore, categoryCount });
}

/** Radio toggle: inside the dock, 44px target, reachable, opens/closes without stranding the user. */
async function assertRadioToggle(page, viewport, guideLabel) {
  const label = `${viewport.name}/${guideLabel}`;
  await scrollTo(page, 'top');
  const placement = await page.evaluate(() => {
    const btn = document.querySelector('#radio-dock-button');
    const slot = document.querySelector('#radio-dock-slot');
    const dock = document.querySelector('#persistent-mini-player');
    if (!btn || !slot || !dock) return null;
    const b = btn.getBoundingClientRect();
    const siblings = Array.from(dock.querySelectorAll('button')).filter((x) => x !== btn && !x.closest('#radio-dock-slot')).map((x) => x.getBoundingClientRect());
    const overlaps = siblings.filter((s) => b.left < s.right - 0.5 && b.right > s.left + 0.5 && b.top < s.bottom - 0.5 && b.bottom > s.top + 0.5).length;
    return { inSlot: slot.contains(btn), inDock: dock.contains(btn), width: b.width, height: b.height, overlaps };
  });
  assert.ok(placement, `${label}: Radio toggle, dock slot and dock all exist`);
  assert.ok(placement.inDock && placement.inSlot, `${label}: Radio toggle lives in the dock slot while media plays`);
  assert.ok(placement.width >= 43.5 && placement.height >= 43.5, `${label}: Radio toggle is a 44px target (${placement.width}x${placement.height})`);
  assert.equal(placement.overlaps, 0, `${label}: Radio toggle overlaps no other dock button`);
  assertClear(await probe(page, '#radio-dock-button'), `${label} radio toggle`, { insideDock: true });

  await page.click('#radio-dock-button');
  await page.waitForFunction(() => { const p = document.querySelector('#radio-dock-panel'); return p && !p.hidden && getComputedStyle(p).display !== 'none'; }, { timeout: 10_000 });
  const closeInfo = await page.evaluate(() => window.__probeTarget('[data-testid="radio-dock-close"]'));
  assert.ok(closeInfo.found && closeInfo.hitIsTarget && closeInfo.onScreen, `${label}: Radio panel close button is reachable (${JSON.stringify(closeInfo)})`);
  await page.click('[data-testid="radio-dock-close"]');
  await page.waitForFunction(() => { const p = document.querySelector('#radio-dock-panel'); return !p || p.hidden || getComputedStyle(p).display === 'none'; }, { timeout: 10_000 });
  await page.waitForSelector('#radio-dock-slot #radio-dock-button');
  assertClear(await probe(page, '#radio-dock-button'), `${label} radio toggle after close`, { insideDock: true });
  return { label, width: placement.width, height: placement.height };
}

async function runViewport(viewport, screensDir) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const pageErrors = []; const archiveRequests = []; const externalRequests = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.setDefaultTimeout(30_000);
  await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1, isMobile: viewport.name === 'phone', hasTouch: viewport.name === 'phone' });
  await page.evaluateOnNewDocument(AUDIO_PROBE);
  await page.evaluateOnNewDocument(PAGE_HELPERS);
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const raw = request.url();
    let decoded = raw; try { decoded = decodeURIComponent(raw); } catch { /* keep raw */ }
    if (/archive\.org/i.test(decoded)) archiveRequests.push(raw);   // direct OR via a local proxy query string
    let parsed; try { parsed = new URL(raw); } catch { void request.continue(); return; }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') { void request.continue(); return; }
    if (parsed.origin === origin) { void request.continue(); return; }
    externalRequests.push(raw);
    void request.abort('blockedbyclient');
  });

  const out = { viewport: viewport.name, width: viewport.width, height: viewport.height, checks: [] };
  try {
    // ---- 1) VIDEO playing from Classic TV ----
    await page.goto(`${origin}/#tv-guide`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#guide-tab-classic-tv');
    await page.click('#guide-tab-classic-tv');
    await page.waitForSelector('[data-epg-channel-row][data-channel-id="demo-channel-001"]');
    await page.click('[data-play-live="demo-channel-001"]');
    await page.waitForSelector('#persistent-player video', { timeout: 30_000 });
    await waitPlaying(page, 'video');
    await page.evaluate(() => { window.location.hash = '#tv-guide'; });
    await page.waitForSelector('#persistent-mini-player');
    await page.waitForSelector('[data-epg-channel-row][data-channel-id="demo-channel-001"]');
    await assertDockClearsGuide(page, viewport, 'video', 'demo-channel-001', out.checks);
    out.checks.push(await assertRadioToggle(page, viewport, 'video'));
    await scrollTo(page, 'bottom');
    await page.screenshot({ path: path.join(screensDir, `dock-playing-video-${viewport.name}-bottom.png`) });
    const videoStillPlaying = await page.$eval('#persistent-player video', (v) => !v.paused);
    assert.ok(videoStillPlaying, `${viewport.name}: video kept playing while the guide and Radio toggle were exercised`);

    // ---- 2) PODCAST (audio) playing from Audio & Podcasts ----
    await scrollTo(page, 'top');
    await page.click('#guide-tab-audio-podcasts');
    await page.waitForSelector('[data-epg-channel-row][data-channel-id="pod-fixture-1"]');
    await page.click('[data-play-live="pod-fixture-1"]');
    await page.waitForSelector('#persistent-player audio', { timeout: 30_000 });
    await waitPlaying(page, 'audio');

    // On the full player the visualizer must be drawing from the single shared analyser.
    await page.waitForSelector('[data-testid="visualizer-overlay"][data-running="1"]', { timeout: 20_000 });
    const before = await page.evaluate(() => window.__audioProbe.snapshot());
    await wait(1200);
    const after = await page.evaluate(() => window.__audioProbe.snapshot());
    const canvasInk = await page.$eval('[data-testid="visualizer-overlay"]', (canvas) => {
      const ctx = canvas.getContext('2d'); const { width, height } = canvas; if (!ctx || !width || !height) return 0;
      const data = ctx.getImageData(0, 0, width, height).data; let ink = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) ink++;
      return ink;
    });
    assert.equal(after.contexts, 1, `${viewport.name}: exactly one AudioContext for the whole session (got ${after.contexts})`);
    assert.equal(after.analysersCreated, before.analysersCreated, `${viewport.name}: the visualizer created no analyser of its own`);
    assert.ok(after.analysersCreated <= 2, `${viewport.name}: only the shared pre/diagnostics analysers exist (got ${after.analysersCreated})`);
    const diagnosticsReads = Object.entries(after.perAnalyser).filter(([k]) => k.endsWith(':fft256')).reduce((n, [, c]) => n + c, 0)
      - Object.entries(before.perAnalyser).filter(([k]) => k.endsWith(':fft256')).reduce((n, [, c]) => n + c, 0);
    assert.ok(diagnosticsReads >= 10, `${viewport.name}: visualizer polled the shared diagnostics analyser (${diagnosticsReads} reads in 1.2 s)`);
    assert.ok(canvasInk > 50, `${viewport.name}: visualizer canvas actually painted from the tone (${canvasInk} painted px)`);
    out.analyser = { contexts: after.contexts, analysersCreated: after.analysersCreated, mediaSources: after.mediaSources, diagnosticsReads, canvasInk, perAnalyser: after.perAnalyser };
    if (viewport.name === 'phone') await page.screenshot({ path: path.join(screensDir, `dock-playing-podcast-player-${viewport.name}.png`) });

    // Back on the guide with audio playing: same overlap + Radio checks.
    await page.evaluate(() => { window.location.hash = '#tv-guide'; });
    await page.waitForSelector('#persistent-mini-player');
    await page.waitForSelector('[data-epg-channel-row][data-channel-id="pod-fixture-1"]');
    await assertDockClearsGuide(page, viewport, 'podcast', 'pod-fixture-1', out.checks);
    out.checks.push(await assertRadioToggle(page, viewport, 'podcast'));
    await scrollTo(page, 'top');
    await page.screenshot({ path: path.join(screensDir, `dock-playing-podcast-${viewport.name}.png`) });
    const finalProbe = await page.evaluate(() => window.__audioProbe.snapshot());
    assert.equal(finalProbe.contexts, 1, `${viewport.name}: still one AudioContext after switching video → podcast`);
    assert.ok(finalProbe.analysersCreated <= 2, `${viewport.name}: still only the shared analysers after switching sources (got ${finalProbe.analysersCreated})`);

    assert.deepEqual(pageErrors, [], `${viewport.name}: no unhandled page errors`);
    assert.deepEqual(archiveRequests, [], `${viewport.name}: zero Archive requests (including via local proxy URLs)`);
    // index.html links Google Fonts; those are blocked and harmless. Any OTHER non-local host is a failure.
    const unexpectedExternal = externalRequests.filter((u) => !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u));
    assert.deepEqual(unexpectedExternal, [], `${viewport.name}: every non-local request (other than font CSS) was blocked and none occurred`);
    out.archiveRequests = 0; out.externalRequests = 0;
    return out;
  } catch (error) {
    try { await page.screenshot({ path: path.join(screensDir, `dock-FAIL-${viewport.name}.png`) }); } catch { /* best effort */ }
    console.error('[dock-playback diagnostic]', JSON.stringify({ viewport: viewport.name, pageErrors, archiveRequests, externalRequests, unstubbed: [...new Set(unstubbed)].slice(0, 20), dock: await dockRect(page).catch(() => null) }));
    throw error;
  } finally {
    await context.close();
  }
}

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
    ...(process.env.PUPPETEER_EXECUTABLE_PATH ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH } : {}),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
  });
  const results = [];
  for (const viewport of VIEWPORTS) results.push(await runViewport(viewport, screensDir));
  console.log(JSON.stringify({ results, unstubbedApiCalls: [...new Set(unstubbed)] }, null, 1));
  console.log('PASS dock-playback-overlap: real playback (video + podcast) at 390 and 1376; dock clears guide filters, channel actions and bottom nav; Radio toggle reachable; visualizer on the shared analyser; zero Archive traffic');
} finally {
  if (browser) await browser.close();
  if (server) await server.close();
}
