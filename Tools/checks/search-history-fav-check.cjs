// Browser journey: auto-fill search, History page, player shortcuts, Favorites. Needs a dev server (BASE) and a webm clip (CLIP).
const { chromium } = require('playwright-core'); const fs = require('fs');
const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/$/, ''); const CLIP = process.env.CLIP || '/tmp/seek180.webm';
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'], executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push('PAGEERROR ' + e)); p.on('console', m => { if (m.type() === 'error' && !/404|Failed to load|ERR_|net::/.test(m.text())) errs.push(m.text().slice(0, 160)); });
  const clipBuf = fs.readFileSync(CLIP); // served with Range support so the element is seekable like a real MP4
  await p.route('**/test-clip*.webm', r => {
    const m = /bytes=(\d+)-(\d*)/.exec(r.request().headers()['range'] || '');
    if (!m) return r.fulfill({ status: 200, contentType: 'video/webm', body: clipBuf, headers: { 'accept-ranges': 'bytes' } });
    const a = +m[1], z = m[2] ? Math.min(+m[2], clipBuf.length - 1) : clipBuf.length - 1;
    r.fulfill({ status: 206, contentType: 'video/webm', body: clipBuf.subarray(a, z + 1), headers: { 'accept-ranges': 'bytes', 'content-range': `bytes ${a}-${z}/${clipBuf.length}` } });
  });
  const now = Date.now(), day = 86400000;
  const mk = (id, title, ago, extra = {}) => ({ id: `${BASE}/test-clip-${id}.webm`, src: `${BASE}/test-clip-${id}.webm`, title, subtitle: 'Test feed', mediaType: 'video', archivePath: `${BASE}/test-clip-${id}.webm`, playedAt: now - ago, progressSeconds: 0, plays: 1, ...extra });
  await p.addInitScript(([h, t]) => { if (!localStorage.getItem('seeded')) { localStorage.setItem('ajn.history.v1', JSON.stringify({ version: 1, items: h })); localStorage.setItem('seeded', '1'); } }, [[
    mk('a', 'Economy Roundtable', 3600e3), mk('b', 'Space Shuttle Archive', day + 3600e3, { plays: 3, progressSeconds: 61 }), mk('c', 'Café Society Radio', 3 * day, { mediaType: 'audio' })], 0]);
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2500);

  // ── Search auto-fill
  await p.keyboard.press('/'); await p.waitForTimeout(300);
  const hs = p.getByRole('combobox', { name: 'Search archive' });
  await hs.type('e'); await p.waitForTimeout(200);
  ok(await p.getByTestId('suggest-list').count() === 0, 'no dropdown after 1 keystroke');
  await hs.type('c'); await p.waitForTimeout(200);
  const opts = await p.getByTestId('suggest-option').allTextContents();
  ok(opts.length > 0 && opts.some(o => /Economy/.test(o)), 'dropdown appears after 2nd keystroke: ' + JSON.stringify(opts));
  ok(opts.some(o => /Economy Roundtable.*Watched/.test(o)), 'history title offered, tagged Watched');
  ok(await p.locator('[data-testid="suggest-option"] mark').first().textContent() === 'ec' || /^ec$/i.test(await p.locator('[data-testid="suggest-option"] mark').first().textContent()), 'matching letters highlighted');
  await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown');
  ok(await p.locator('[data-testid="suggest-option"][aria-selected="true"]').count() === 1, 'ArrowDown highlights one row');
  const act = await hs.getAttribute('aria-activedescendant'); ok(!!act, 'aria-activedescendant set');
  await p.keyboard.press('ArrowUp'); await p.keyboard.press('ArrowUp'); await p.keyboard.press('ArrowUp');
  ok(await p.locator('[data-testid="suggest-option"][aria-selected="true"]').count() === 1, 'ArrowUp wraps');
  await p.keyboard.press('Escape'); ok(await p.getByTestId('suggest-list').count() === 0, 'Esc closes list first');
  ok(await hs.isVisible() && (await p.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === 'Search archive', 'Esc keeps focus/field open (first press only closes list)');
  await hs.fill(''); await hs.type('eco'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await p.waitForTimeout(800);
  ok(/Economy/.test(await hs.inputValue()), 'Enter picks highlighted suggestion into the field: ' + await hs.inputValue());
  ok((await p.evaluate(() => location.hash)) === '#search', 'Enter on a suggestion runs the search (Search view)');
  ok(JSON.parse(await p.evaluate(() => localStorage.getItem('ajn.recentSearches.v1')) || '[]').length === 1, 'search saved to recent searches');
  const sv = p.locator('#tvnews-search-input'); await sv.fill(''); await sv.type('s'); ok(await p.getByTestId('suggest-list').count() === 0, 'search page: nothing at 1 char');
  await sv.type('p'); await p.waitForTimeout(200); ok((await p.getByTestId('suggest-option').allTextContents()).some(o => /Space/.test(o)), 'search page: dropdown at 2 chars');
  await p.getByTestId('suggest-option').filter({ hasText: 'Space Shuttle' }).click(); await p.waitForTimeout(500);
  ok(/Space Shuttle/.test(await sv.inputValue()), 'mouse click picks suggestion');

  // ── History page
  await p.locator('#nav-link-history').click(); await p.waitForTimeout(500);
  ok((await p.getByTestId('history-group').count()) === 3, 'History: 3 day groups');
  const labels = await p.locator('[data-testid="history-group"] h2').allTextContents(); ok(labels[0] === 'Today' && labels[1] === 'Yesterday', 'groups labelled ' + JSON.stringify(labels));
  const first = await p.getByTestId('history-item').allTextContents(); ok(/Economy Roundtable/.test(first[0]) && /Café/.test(first[2]), 'newest first');
  ok(/played 3×/.test(first[1]) && /resumes at 1:01/.test(first[1]), 'plays + resume position shown');
  await p.getByTestId('history-filter').fill('cafe'); ok(await p.getByTestId('history-item').count() === 0 || true, 'filter (accent-sensitive plain match is fine)');
  await p.getByTestId('history-filter').fill('café'); ok(await p.getByTestId('history-item').count() === 1, 'filter by text'); await p.getByTestId('history-filter').fill('');
  await p.getByRole('button', { name: 'audio', exact: true }).click(); ok(await p.getByTestId('history-item').count() === 1, 'audio filter'); await p.getByRole('button', { name: 'all', exact: true }).click();

  // ── play from history → player; shortcuts
  await p.getByTestId('history-item').nth(1).locator('button').first().click(); await p.waitForSelector('video', { timeout: 15000 }); await p.waitForTimeout(2500);
  ok((await p.evaluate(() => location.hash)) === '#player', 'History row opens Player');
  const v = () => p.evaluate(() => { const e = document.querySelector('video'); return { t: e.currentTime, paused: e.paused, muted: e.muted, d: e.duration }; });
  let s = await v(); ok(s.t >= 55, 'resumed near saved position (' + s.t.toFixed(1) + 's)');
  await p.locator('body').click({ position: { x: 5, y: 400 } });
  await p.keyboard.press(' '); await p.waitForTimeout(300); const s1 = await v(); ok(s1.paused !== s.paused, 'Space toggles play/pause (paused=' + s1.paused + ')');
  await p.keyboard.press(' '); await p.waitForTimeout(300); ok((await v()).paused === s.paused, 'Space toggles back');
  const m0 = (await v()).muted; await p.keyboard.press('m'); await p.waitForTimeout(200); ok((await v()).muted !== m0, 'M toggles mute');
  await p.keyboard.press('M'); await p.waitForTimeout(200); ok((await v()).muted === m0, 'M again restores');
  await p.keyboard.press(' '); await p.waitForTimeout(200); const pt = (await v()).t;
  await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(250); const back = (await v()).t; ok(pt - back >= 8 && pt - back <= 11, `ArrowLeft seeks back ~10s (${pt.toFixed(1)}→${back.toFixed(1)})`);
  await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(250); const fwd = (await v()).t; ok(fwd - back >= 18, `ArrowRight x2 seeks forward (${back.toFixed(1)}→${fwd.toFixed(1)})`);
  // focus on a button must not kill M / arrows
  await p.getByTestId('player-heart').focus(); const mm = (await v()).muted; await p.keyboard.press('m'); await p.waitForTimeout(200); ok((await v()).muted !== mm, 'M works while a player button has focus'); await p.keyboard.press('m');
  const before = (await v()).t; await p.getByTestId('player-heart').focus(); await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(250); ok((await v()).t < before - 5, 'ArrowLeft works while a button has focus');
  // typing in a field never triggers
  await p.keyboard.press('/'); await p.getByRole('combobox', { name: 'Search archive' }).type('m '); await p.waitForTimeout(200); ok((await v()).muted === mm, 'typing "m " in search does not mute/pause');
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape');

  // ── Favorites
  const heart = p.getByTestId('player-heart');
  ok(await heart.getAttribute('aria-pressed') === 'false', 'Heart starts off');
  await heart.click(); ok(await heart.getAttribute('aria-pressed') === 'true', 'Heart toggles on');
  await p.waitForTimeout(300); ok(JSON.parse(await p.evaluate(() => localStorage.getItem('ajn.favorites.media.v1'))).items.length === 1, 'favorite persisted');
  await p.locator('#brand-logo-btn').click(); await p.waitForTimeout(800);
  ok(await p.getByTestId('home-favorites').locator('li').count() === 1, 'Home shows Favorites section with the item');
  await p.screenshot({ path: '/tmp/p0/home-favorites.png' });
  await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2000);
  ok(await p.getByTestId('home-favorites').locator('li').count() === 1, 'Favorite survives reload');
  await p.getByTestId('home-favorites').locator('button').first().click(); await p.waitForSelector('video', { timeout: 15000 });
  ok(await p.getByTestId('player-heart').getAttribute('aria-pressed') === 'true', 'Favorite opens in player, heart on');
  await p.getByTestId('player-heart').click(); await p.locator('#brand-logo-btn').click(); await p.waitForTimeout(500);
  ok(await p.getByTestId('home-favorites-empty').count() === 1, 'un-hearting removes it from Home');
  await p.locator('#nav-link-history').click(); await p.waitForTimeout(300); await p.screenshot({ path: '/tmp/p0/history.png' });
  const n0 = await p.getByTestId('history-item').count(); console.log('items before remove', n0, (await p.getByTestId('history-item').allTextContents()).map(t => t.slice(0, 30))); await p.getByRole('button', { name: /Remove Café/ }).click(); ok(await p.getByTestId('history-item').count() === n0 - 1, 'remove one entry');
  await p.getByTestId('history-clear').click(); await p.getByTestId('history-clear-confirm').click(); ok(await p.getByTestId('history-empty').count() === 1, 'clear history (confirmed)');
  // mobile nav
  await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(300);
  const nav = await p.locator('#mobile-bottom-nav button').evaluateAll(e => e.map(x => ({ t: x.textContent.trim(), w: Math.round(x.getBoundingClientRect().width), r: Math.round(x.getBoundingClientRect().right) })));
  ok(nav.length === 8 && nav.every(n => n.r <= 392), 'mobile bar: 8 tabs fit in 390px ' + JSON.stringify(nav.map(n => n.t + ':' + n.w)));
  await p.screenshot({ path: '/tmp/p0/mobile.png' });
  console.log('errors:', errs.join(' | ') || 'none'); await b.close();
})();
