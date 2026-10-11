// UI smoke test for the sync panel in a signed-out browser. Real Google sign-in can't be completed headlessly.
const { chromium } = require('playwright-core'); const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/$/, '');
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'], executablePath: '/opt/pw-browsers/chromium' }); const p = await (await b.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e))); const reqs = []; p.on('request', r => reqs.push(r.url()));
  await p.goto(BASE + '/#history', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2500);
  ok(await p.getByTestId('sync-panel').isVisible(), 'sync panel shows on History page');
  ok(/Not signed in/.test(await p.getByTestId('sync-status').textContent()), 'signed-out status text is honest: device-only');
  ok(await p.getByTestId('sync-history-toggle').count() === 0, 'history toggle hidden until signed in');
  ok(!reqs.some(u => /firebase|googleapis|gstatic/.test(u) && /firestore|auth/.test(u)), 'Firebase SDK NOT loaded before the user asks to sign in');
  await p.getByTestId('sync-signin').click(); await p.waitForTimeout(12000);
  ok(reqs.some(u => /firebase/.test(u)), 'SDK loads lazily on click');
  const txt = await p.getByTestId('sync-panel').textContent(); console.log('panel after click:', txt.slice(0, 200));
  ok(!/not been registered/i.test(txt), 'no "Component auth has not been registered" error');
  ok(errs.length === 0, 'no uncaught page errors: ' + errs.join('|'));
  await p.screenshot({ path: '/tmp/p0/sync-panel.png' }); await b.close();
})();
