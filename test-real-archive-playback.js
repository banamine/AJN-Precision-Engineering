import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const BASE = 'http://localhost:3000';

async function getJson(path) {
  const response = await fetch(BASE + path);
  assert.ok(response.ok, `HTTP ${response.status} for ${path}`);
  return response.json();
}

async function waitForMedia(page, src, label) {
  await page.setContent(`<!doctype html><video id="v" muted playsinline preload="metadata"></video>`);
  const result = await page.evaluate(async ({ src, label }) => {
    const video = document.getElementById('v');
    video.src = src;
    video.load();
    return await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve({
        label, event: 'timeout', readyState: video.readyState, networkState: video.networkState,
        errorCode: video.error?.code ?? null, errorMessage: video.error?.message ?? null,
      }), 30000);
      video.addEventListener('loadedmetadata', () => {
        clearTimeout(timeout);
        resolve({ label, event: 'loadedmetadata', readyState: video.readyState, networkState: video.networkState,
          duration: Number.isFinite(video.duration) ? video.duration : null, errorCode: video.error?.code ?? null });
      }, { once: true });
      video.addEventListener('error', () => {
        clearTimeout(timeout);
        resolve({ label, event: 'error', readyState: video.readyState, networkState: video.networkState,
          errorCode: video.error?.code ?? null, errorMessage: video.error?.message ?? null });
      }, { once: true });
    });
  }, { src, label });
  console.log('[REAL PLAYBACK]', JSON.stringify(result));
  assert.equal(result.event, 'loadedmetadata', `${label} did not reach loadedmetadata`);
}

(async () => {
  console.log('Real archive playback gates: CNN Newsroom Live, Classic TV full list, Movies & Cinema Classics');

  const cable = await getJson('/api/schedule?guide=cable-tv');
  const cnn = cable.channels?.find((channel) => channel.id === 'cnn');
  assert.ok(cnn, 'CNN channel missing from cable TV guide');
  assert.ok(cnn.programs?.length > 0, 'CNN has no current 48-hour programs');
  assert.ok(cnn.programs[0].mediaUrl?.startsWith('/api/archive/proxy?path='), 'CNN program must use Archive proxy transport');

  const classic = await getJson('/api/schedule?guide=classic-tv');
  const classicChannel = classic.channels?.find((channel) => channel.id === 'honeymooners');
  assert.ok(classicChannel, 'Classic TV channel missing');
  assert.ok(classicChannel.fullShowList?.length > 1, 'Classic TV full show list was not restored');
  assert.ok(classicChannel.fullShowList.every((program) => program.mediaUrl?.startsWith('/api/archive/proxy?path=')),
    'Classic TV full show list contains non-proxied media');

  const movies = await getJson('/api/schedule?guide=movies-classics-vault');
  const movieChannel = movies.channels?.find((channel) => channel.id === 'classic-cinema');
  assert.ok(movieChannel, 'Movies & Cinema Classics channel missing');
  assert.ok(movieChannel.programs?.length > 1, 'Movies & Cinema Classics does not have multiple playable programs');
  assert.ok(movieChannel.programs.every((program) => program.mediaUrl?.startsWith('/api/archive/proxy?path=')),
    'Movies & Cinema Classics contains non-proxied media');

  // Use the repository's known Archive movie samples rather than assuming the
  // first manifest item is currently served by the Archive mirror.
  const movieSamples = [
    movieChannel.programs.find((program) => program.archivePath.includes('/NightOfTheLivingDead/')),
    movieChannel.programs.find((program) => program.archivePath.includes('/HisGirlFriday1940/')),
  ].filter(Boolean);
  assert.equal(movieSamples.length, 2, 'Known working Movies Classics samples are missing from the schedule');

  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    page.on('console', (msg) => console.log('[Browser]', msg.type(), msg.text()));
    page.on('requestfailed', (request) => console.error('[Browser requestfailed]', request.url(), request.failure()?.errorText));

    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });

    await waitForMedia(page, cnn.programs[0].mediaUrl, 'CNN Newsroom Live');
    await waitForMedia(page, classicChannel.fullShowList[0].mediaUrl, 'Classic TV first full-list show');
    await waitForMedia(page, movieChannel.programs[0].mediaUrl, 'Movies & Cinema Classics first title');
    await waitForMedia(page, movieChannel.programs[1].mediaUrl, 'Movies & Cinema Classics second title');
  } finally {
    await browser.close();
  }

  console.log('REAL ARCHIVE PLAYBACK GATES PASSED');
})().catch((error) => {
  console.error('REAL ARCHIVE PLAYBACK GATES FAILED', error);
  process.exitCode = 1;
});
