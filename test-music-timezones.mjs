import assert from 'node:assert/strict';

export const FIXED_INSTANT = '2026-10-07T12:15:00.000Z';
export const TIMEZONES = ['America/Los_Angeles', 'America/New_York', 'Asia/Tokyo'];

/**
 * Runs with an existing Playwright Browser; no new application dependencies.
 * Latest approval requires local-day consistency, NOT identical tracks between zones.
 * Snapshot is the real track-exact API response, shared by all three contexts.
 */
export async function runMusicTimezoneConsistency(browser, baseURL, snapshot) {
  snapshot ??= await (await fetch(`${baseURL}/api/schedule?guide=audio-podcasts`)).json();
  const music = snapshot.channels.filter(channel => channel.id.startsWith('item-music-'));
  assert.equal(music.length, 25);
  const results = [];
  for (const timezoneId of TIMEZONES) {
    const context = await browser.newContext({ timezoneId, viewport: { width: 1280, height: 800 } });
    try {
      await context.route('**/api/schedule?guide=audio-podcasts', route =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(snapshot) }));
      const page = await context.newPage();
      await page.clock.setFixedTime(new Date(FIXED_INSTANT));
      await page.goto(`${baseURL}/#tv-guide`);
      await page.locator('#guide-tab-audio-podcasts').click();
      await page.locator('[data-music-channel]').first().waitFor();
      const nowHour = await page.evaluate(() => {
        const now = new Date();
        return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
      });
      const lineHour = Number(await page.locator('[data-now-hour]').getAttribute('data-now-hour'));
      assert.equal(lineHour, nowHour, `${timezoneId}: now-line uses local clock`);
      for (const channel of music) {
        const expected = channel.programs.find(program => nowHour >= (program.startHour ?? program.startTime)
          && nowHour < (program.endHour ?? program.endTime));
        assert.ok(expected, `${timezoneId}/${channel.id}: schedule has a track under now-line`);
        const row = page.locator(`[data-music-channel="${channel.id}"]`);
        assert.equal(await row.getAttribute('data-now-program-id'), expected.id);
        const sticky = page.locator(`[data-now-channel-id="${channel.id}"]`);
        assert.equal(await sticky.getAttribute('data-now-program-id'), expected.id);
        const blocks = row.locator('[data-live-program-id]');
        if (await blocks.count()) {
          assert.equal(await blocks.count(), 1);
          assert.equal(await blocks.getAttribute('data-live-program-id'), expected.id);
          const start = Number(await blocks.getAttribute('data-start-hour'));
          const end = Number(await blocks.getAttribute('data-end-hour'));
          assert.ok(nowHour >= start && nowHour < end,
            `${timezoneId}/${channel.id}: highlighted block is under now-line`);
        } else {
          const live = row.locator('button').filter({ hasText: 'On Air Now' });
          assert.equal(await live.count(), 1);
          assert.equal(await live.getAttribute('title'), expected.title);
        }
      }
      const firstId = music[0].programs.find(program =>
        nowHour >= program.startHour && nowHour < program.endHour).id;
      const result = { timezoneId, fixedInstant: FIXED_INSTANT, localHour: nowHour,
        channelsChecked: music.length, firstLiveProgramId: firstId, consistency: 'PASS' };
      results.push(result);
      console.log(JSON.stringify(result));
    } finally {
      await context.close();
    }
  }
  assert.equal(results.length, 3);
  console.log('Playwright three-timezone Music cell/now-line/highlight consistency: PASS');
  return results;
}

// Optional standalone runner against a prebuilt server, using an already-installed
// platform Playwright runtime. No npm install/npx dependency download is required.
if (process.argv[1]?.endsWith('test-music-timezones.mjs')) {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/repl/tools/bin/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try { await runMusicTimezoneConsistency(browser, process.argv[2] || 'http://127.0.0.1:3000'); }
  finally { await browser.close(); }
}
