#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { existsSync } = require('node:fs');
const { chromium } = require('playwright-core');

const root = process.cwd();
const viteEntry = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const chromiumPath = process.env.CHROMIUM_PATH
  || ['/repl/tools/bin/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(existsSync);

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function historyItems(count) {
  const now = Date.now();
  return Array.from({ length: count }, (_, index) => ({
    id: `demo-history-${index + 1}`,
    src: `/demo/history-${index + 1}.mp4`,
    title: `DEMO — synthetic history item ${index + 1}`,
    subtitle: 'Synthetic test fixture',
    mediaType: 'video',
    playedAt: now - index * 1000,
    progressSeconds: 0,
    plays: 1,
    updatedAt: now - index * 1000,
  }));
}

function favoriteItems(count) {
  const now = Date.now();
  return Array.from({ length: count }, (_, index) => ({
    id: `demo-favorite-${index + 1}`,
    src: `/demo/favorite-${index + 1}.mp4`,
    title: `DEMO — synthetic favorite ${index + 1}`,
    savedAt: now - index * 1000,
  }));
}

function searchResponse(query, network) {
  if (!query) return { total: 0, items: [] };
  const safe = query.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'query';
  return {
    total: 1,
    items: [{
      identifier: `demo-${safe}`,
      title: `DEMO — synthetic result for ${query}`,
      program: 'DEMO — synthetic broadcast',
      description: 'Synthetic browser-test fixture; not a real broadcast or transcript.',
      date: '2026-10-23',
      time: '12:00',
      network,
    }],
  };
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function getStatus(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      response.resume();
      response.once('end', () => resolve(response.statusCode));
    });
    request.setTimeout(1500, () => request.destroy(new Error('Vite readiness request timed out')));
    request.once('error', reject);
  });
}

async function startVite() {
  assert.ok(existsSync(viteEntry), `Vite entry not found: ${viteEntry}`);
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [viteEntry, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: root,
    detached: process.platform !== 'win32',
    env: { ...process.env, NODE_ENV: 'test', NET_GUARD: 'block' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let childOutput = '';
  child.stdout.on('data', (chunk) => { childOutput += chunk.toString(); });
  child.stderr.on('data', (chunk) => { childOutput += chunk.toString(); });

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Vite exited early (${child.exitCode}):\n${childOutput}`);
    try {
      if (await getStatus(origin) === 200) return { child, origin, childOutput: () => childOutput };
    } catch {
      // Vite is still starting; retry the local readiness check.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Vite did not become ready in 30 seconds:\n${childOutput}`);
}

async function stopVite(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
    else child.kill('SIGTERM');
  } catch { /* It may have exited between the status check and signal. */ }
  const exited = await Promise.race([
    once(child, 'exit').then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 2000)),
  ]);
  if (!exited) {
    try {
      if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
      else child.kill('SIGKILL');
    } catch { /* Already gone. */ }
    await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 1000))]);
  }
}

async function makeHarnessPage(browser, origin, {
  viewport = { width: 390, height: 844 },
  destination = 'search',
  recent = [],
  histories = [],
  favorites = [],
  delayJsonQuery = null,
  deferRouteQuery = null,
  reducedMotion = 'no-preference',
} = {}) {
  const context = await browser.newContext({ viewport, reducedMotion });
  await context.addInitScript(({ recentSearches, history, favoriteList, delayedQuery }) => {
    if (location.origin === 'null') return;
    localStorage.setItem('ajn.recentSearches.v1', JSON.stringify(recentSearches));
    localStorage.setItem('ajn.history.v1', JSON.stringify({ version: 1, items: history }));
    localStorage.setItem('ajn.favorites.media.v1', JSON.stringify({ version: 1, items: favoriteList }));

    window.__searchScrollCalls = [];
    window.__staleResponseDelaySeen = false;
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (options) {
      if (this.matches?.('[data-testid="search-results-region"]')) {
        window.__searchScrollCalls.push(options || {});
      }
      return originalScrollIntoView?.call(this, options);
    };

    if (delayedQuery) {
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const response = await originalFetch(input, init);
        const requestUrl = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (requestUrl.pathname === '/api/search' && requestUrl.searchParams.get('q') === delayedQuery) {
          const body = await response.text();
          window.__staleResponseDelaySeen = true;
          await new Promise((resolve) => setTimeout(resolve, 1400));
          return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
        }
        return response;
      };
    }
  }, { recentSearches: recent, history: histories, favoriteList: favorites, delayedQuery: delayJsonQuery });

  const page = await context.newPage();
  const searchRequests = [];
  const blockedExternalRequests = [];
  let archiveRequestAttempts = 0;
  const requestSeen = deferred();
  const routeRelease = deferred();
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'archive.org' || url.hostname.endsWith('.archive.org')) {
      archiveRequestAttempts += 1;
      await route.abort();
      return;
    }
    if (url.origin !== origin) {
      blockedExternalRequests.push(url.hostname);
      await route.abort();
      return;
    }
    if (url.pathname === '/api/search') {
      const query = url.searchParams.get('q') || '';
      const network = url.searchParams.get('network') || 'FOXNEWSW';
      searchRequests.push(query);
      if (query === deferRouteQuery) {
        requestSeen.resolve();
        await routeRelease.promise;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(searchResponse(query, network)) });
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'unknown', items: [], total: 0 }) });
      return;
    }
    await route.continue();
  });

  return {
    context,
    page,
    searchRequests,
    blockedExternalRequests,
    get archiveRequestAttempts() { return archiveRequestAttempts; },
    requestSeen: requestSeen.promise,
    releaseRoute: () => routeRelease.resolve(),
    async open() {
      await page.goto(`${origin}/#${destination}`, { waitUntil: 'domcontentloaded' });
      if (destination === 'search') {
        await page.getByTestId('search-results-heading').waitFor({ state: 'visible' });
        await page.waitForFunction(() => document.querySelector('[data-testid="search-results-heading"]')?.textContent?.includes('Found 0'));
      } else {
        await page.getByTestId('history-view').waitFor({ state: 'visible' });
      }
    },
    async close() { await context.close(); },
  };
}

async function assertNoArchiveRequests(harness) {
  assert.equal(harness.archiveRequestAttempts, 0, 'No Archive.org request may leave the local browser harness');
}

async function main() {
  assert.ok(chromiumPath && existsSync(chromiumPath), 'Set CHROMIUM_PATH to a local Chromium executable');
  const server = await startVite();
  let browser;
  const harnesses = [];
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: chromiumPath,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });

    const suggestions = await makeHarnessPage(browser, server.origin, { recent: ['Recent One', 'Recent Two'] });
    harnesses.push(suggestions);
    await suggestions.open();
    assert.equal(await suggestions.page.evaluate(() => window.__searchScrollCalls.length), 0, 'Initial mount must not scroll');
    const input = suggestions.page.locator('#tvnews-search-input');
    await input.focus();
    const groups = await suggestions.page.locator('[role="listbox"] [role="group"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
    assert.deepEqual(groups, ['Recent', 'Topics'], 'Empty-focus groups appear Recent first, then Topics');
    assert.equal(await suggestions.page.locator('[role="listbox"] [role="option"]').count(), 7, 'Two recents plus five topic seeds are shown');
    const beforePick = suggestions.searchRequests.length;
    await input.press('ArrowDown');
    assert.ok((await input.getAttribute('aria-activedescendant'))?.endsWith('-option-0'), 'ArrowDown activates the first option');
    await input.press('ArrowUp');
    assert.ok((await input.getAttribute('aria-activedescendant'))?.endsWith('-option-6'), 'ArrowUp wraps to the final option');
    await input.press('Escape');
    assert.equal(await input.getAttribute('aria-expanded'), 'false', 'Escape closes suggestions');
    assert.equal(suggestions.searchRequests.length, beforePick, 'Escape does not submit a search');
    await input.press('ArrowDown');
    await input.press('Enter');
    await suggestions.page.waitForFunction(() => document.querySelector('[data-testid="search-results-heading"]')?.textContent?.includes('Found 1'));
    assert.deepEqual(suggestions.searchRequests.slice(beforePick), ['Recent One'], 'Keyboard suggestion selection sends exactly one search');
    assert.equal(await suggestions.page.evaluate(() => JSON.parse(localStorage.getItem('ajn.recentSearches.v1'))[0]), 'Recent One', 'Picked suggestion is saved as a recent search');
    await assertNoArchiveRequests(suggestions);
    console.log('PASS empty-focus groups, keyboard pick, single request, recent recording, no initial scroll');
    await suggestions.close();

    const typed = await makeHarnessPage(browser, server.origin, { recent: ['Café News'] });
    harnesses.push(typed);
    await typed.open();
    const typedInput = typed.page.locator('#tvnews-search-input');
    await typedInput.fill('cafe');
    const typedOptions = await typed.page.getByRole('option').allTextContents();
    assert.ok(typedOptions.some((text) => text.includes('Café News')), 'Accent-insensitive typed matching is preserved');
    assert.ok(await typed.page.locator('[role="option"] mark').count() > 0, 'Typed query match remains highlighted');
    console.log('PASS typed accent-insensitive matching and highlighting');
    await typed.close();

    const clearRecent = await makeHarnessPage(browser, server.origin, {
      recent: ['Keep history, not this recent'],
      histories: historyItems(1),
      favorites: favoriteItems(1),
    });
    harnesses.push(clearRecent);
    await clearRecent.open();
    const clearInput = clearRecent.page.locator('#tvnews-search-input');
    await clearInput.focus();
    await clearRecent.page.getByTestId('clear-recent-searches').click();
    await clearRecent.page.waitForFunction(() => JSON.parse(localStorage.getItem('ajn.recentSearches.v1')).length === 0);
    assert.equal(await clearRecent.page.evaluate(() => JSON.parse(localStorage.getItem('ajn.history.v1')).items.length), 1, 'Clearing recents preserves history');
    assert.equal(await clearRecent.page.evaluate(() => JSON.parse(localStorage.getItem('ajn.favorites.media.v1')).items.length), 1, 'Clearing recents preserves favorites');
    await assertNoArchiveRequests(clearRecent);
    console.log('PASS Clear recent searches changes only the recent-search store');
    await clearRecent.close();

    const history = await makeHarnessPage(browser, server.origin, { destination: 'history', histories: historyItems(3) });
    harnesses.push(history);
    await history.open();
    await history.page.getByTestId('history-clear').click();
    await history.page.getByTestId('history-clear-confirm').click();
    const clearBanner = history.page.getByTestId('history-cleared');
    await clearBanner.waitFor({ state: 'visible' });
    assert.equal((await clearBanner.innerText()).trim().replace(/\s+/g, ' '), 'History cleared (3 items removed).');
    await history.page.waitForFunction(() => JSON.parse(localStorage.getItem('ajn.history.v1')).items.length === 0, { timeout: 3000 });
    await history.page.waitForTimeout(5200);
    assert.equal(await history.page.getByTestId('history-cleared').count(), 0, 'Banner auto-dismisses after five seconds');
    assert.ok((await history.page.getByTestId('history-empty').innerText()).startsWith('No history yet.'));
    await assertNoArchiveRequests(history);
    console.log('PASS history clear count, role=status banner, five-second dismissal, and honest empty state');
    await history.close();

    const manualDismiss = await makeHarnessPage(browser, server.origin, { destination: 'history', histories: historyItems(2) });
    harnesses.push(manualDismiss);
    await manualDismiss.open();
    await manualDismiss.page.getByTestId('history-clear').click();
    await manualDismiss.page.getByTestId('history-clear-confirm').click();
    await manualDismiss.page.getByTestId('history-cleared').waitFor({ state: 'visible' });
    await manualDismiss.page.getByRole('button', { name: 'Dismiss history cleared message' }).click();
    assert.equal(await manualDismiss.page.getByTestId('history-cleared').count(), 0, 'Banner can be dismissed manually');
    await assertNoArchiveRequests(manualDismiss);
    console.log('PASS manual history-banner dismissal');
    await manualDismiss.close();

    const emptyHistory = await makeHarnessPage(browser, server.origin, { destination: 'history' });
    harnesses.push(emptyHistory);
    await emptyHistory.open();
    assert.equal(await emptyHistory.page.getByTestId('history-cleared').count(), 0, 'Empty history shows no cleared banner');
    assert.equal(await emptyHistory.page.getByTestId('history-clear').count(), 0, 'Empty history has no clear action');
    await assertNoArchiveRequests(emptyHistory);
    console.log('PASS empty history shows no false success banner');
    await emptyHistory.close();

    for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
      const query = `scroll-${viewport.width}`;
      const scrollTest = await makeHarnessPage(browser, server.origin, { viewport, deferRouteQuery: query });
      harnesses.push(scrollTest);
      await scrollTest.open();
      const searchInput = scrollTest.page.locator('#tvnews-search-input');
      await searchInput.fill(query);
      await searchInput.press('Enter');
      await scrollTest.requestSeen;
      await scrollTest.page.evaluate(() => {
        document.body.style.minHeight = '2400px';
        window.scrollTo(0, document.body.scrollHeight);
      });
      scrollTest.releaseRoute();
      await scrollTest.page.waitForFunction(() => document.querySelector('[data-testid="search-results-heading"]')?.textContent?.includes('Found 1'));
      await scrollTest.page.waitForFunction(() => {
        const top = document.querySelector('[data-testid="search-results-region"]').getBoundingClientRect().top;
        const headerHeight = document.querySelector('#canonical-app-header').getBoundingClientRect().height;
        return top >= headerHeight - 1 && top < window.innerHeight;
      }, undefined, { timeout: 5000 });
      const geometry = await scrollTest.page.evaluate(() => ({
        top: document.querySelector('[data-testid="search-results-region"]').getBoundingClientRect().top,
        headerHeight: document.querySelector('#canonical-app-header').getBoundingClientRect().height,
        viewport: window.innerHeight,
        calls: window.__searchScrollCalls,
      }));
      assert.ok(geometry.top >= geometry.headerHeight - 1 && geometry.top < geometry.viewport, `Results are visible below the sticky header at ${viewport.width}px: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.calls.some((call) => call.block === 'start' && call.behavior === 'smooth'), `Search scroll is smooth at ${viewport.width}px`);
      assert.equal(await scrollTest.page.getByTestId('search-results-heading').evaluate((node) => node === document.activeElement), true, 'Results summary receives focus');
      await assertNoArchiveRequests(scrollTest);
      console.log(`PASS results scroll and visible geometry at ${viewport.width}x${viewport.height}`);
      await scrollTest.close();
    }

    const reducedMotion = await makeHarnessPage(browser, server.origin, {
      viewport: { width: 390, height: 844 },
      reducedMotion: 'reduce',
      deferRouteQuery: 'reduced-motion-check',
    });
    harnesses.push(reducedMotion);
    await reducedMotion.open();
    const reducedInput = reducedMotion.page.locator('#tvnews-search-input');
    await reducedInput.fill('reduced-motion-check');
    await reducedInput.press('Enter');
    await reducedMotion.requestSeen;
    await reducedMotion.page.evaluate(() => {
      document.body.style.minHeight = '2400px';
      window.scrollTo(0, document.body.scrollHeight);
    });
    reducedMotion.releaseRoute();
    await reducedMotion.page.waitForFunction(() => document.querySelector('[data-testid="search-results-heading"]')?.textContent?.includes('Found 1'));
    const reducedCalls = await reducedMotion.page.evaluate(() => window.__searchScrollCalls);
    assert.ok(reducedCalls.some((call) => call.block === 'start' && call.behavior === 'auto'), 'Reduced-motion search scroll uses behavior auto');
    await assertNoArchiveRequests(reducedMotion);
    console.log('PASS reduced-motion search scroll uses auto');
    await reducedMotion.close();

    const stale = await makeHarnessPage(browser, server.origin, {
      viewport: { width: 390, height: 844 },
      delayJsonQuery: 'stale-search',
      deferRouteQuery: 'current-search',
    });
    harnesses.push(stale);
    await stale.open();
    const staleInput = stale.page.locator('#tvnews-search-input');
    await staleInput.fill('stale-search');
    await staleInput.press('Enter');
    await stale.page.waitForFunction(() => window.__staleResponseDelaySeen === true);
    await staleInput.fill('current-search');
    await staleInput.press('Enter');
    await stale.requestSeen;
    await stale.page.evaluate(() => {
      document.body.style.minHeight = '2400px';
      window.scrollTo(0, document.body.scrollHeight);
    });
    stale.releaseRoute();
    await stale.page.waitForFunction(() => document.querySelector('[data-testid="search-results-heading"]')?.textContent?.includes('Found 1'));
    const currentScrollCount = await stale.page.evaluate(() => window.__searchScrollCalls.length);
    await stale.page.waitForTimeout(1700);
    assert.equal(await stale.page.evaluate(() => window.__searchScrollCalls.length), currentScrollCount, 'Late stale response does not trigger another scroll');
    assert.equal(currentScrollCount, 1, 'Only the current request scrolls');
    await assertNoArchiveRequests(stale);
    console.log('PASS stale response cannot trigger a second scroll');
    await stale.close();

    const archiveAttempts = harnesses.reduce((sum, harness) => sum + harness.archiveRequestAttempts, 0);
    assert.equal(archiveAttempts, 0, 'No Archive.org requests were made');
    const externalBlocked = harnesses.reduce((sum, harness) => sum + harness.blockedExternalRequests.length, 0);
    console.log(`Archive.org requests: ${archiveAttempts}; external requests blocked before network: ${externalBlocked}; all /api/search responses mocked`);
  } finally {
    for (const harness of harnesses) {
      try { await harness.close(); } catch { /* Preserve the original test failure. */ }
    }
    if (browser) await browser.close();
    await stopVite(server.child);
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
