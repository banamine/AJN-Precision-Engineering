import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import moviesClassicsManifest from './src/data/moviesClassicsManifest.json' with { type: 'json' };
import { searchTVNews, resolveBestFileUrl, getSafeArchiveUrl } from './channels.ts';
import { buildHoneymoonersEpg } from './collections/honeymooners-epg.ts';
import {
  buildMoviesClassicsFromVerified,
  validateMoviesClassicsPrograms,
} from './src/services/producers/moviesClassicsProducer.ts';
import { buildArchiveProxyUrl } from './src/utils/archivePlayback.ts';

const BASE_URL = process.env.AJN_TEST_URL || 'http://localhost:3000';

function proxyPathFromArchiveUrl(rawUrl) {
  const safe = getSafeArchiveUrl(rawUrl);
  const url = new URL(safe);
  return `${url.pathname}${url.search}`;
}

async function waitForMedia(page, src, label, timeoutMs = 15_000) {
  const result = await page.evaluate(
    async ({ source, timeout }) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      return await new Promise((resolve) => {
        let settled = false;
        let timer;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          video.removeEventListener('loadedmetadata', onLoaded);
          video.removeEventListener('error', onError);
          video.remove();
          resolve(value);
        };
        const onLoaded = () => finish({ event: 'loadedmetadata', duration: video.duration, readyState: video.readyState, errorCode: null });
        const onError = () => finish({ event: 'error', duration: video.duration, readyState: video.readyState, errorCode: video.error?.code ?? null, message: video.error?.message ?? null });
        timer = setTimeout(() => finish({ event: 'timeout', duration: video.duration, readyState: video.readyState, errorCode: video.error?.code ?? null }), timeout);
        video.addEventListener('loadedmetadata', onLoaded, { once: true });
        video.addEventListener('error', onError, { once: true });
        video.src = source;
        video.load();
      });
    },
    { source: src, timeout: timeoutMs },
  );
  console.log('[REAL PLAYBACK]', JSON.stringify({ label, result }));
  assert.equal(result.event, 'loadedmetadata', `${label} failed real browser playback: ${result.event} ${result.errorCode ?? ''}`);
  return result;
}

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

try {
  const page = await browser.newPage();
  page.on('console', (msg) => console.log('[Browser]', msg.type(), msg.text()));
  page.on('requestfailed', (request) => console.error('[Browser requestfailed]', request.url(), request.failure()?.errorText));

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  const end = new Date();
  const start = new Date(end.getTime() - 48 * 60 * 60 * 1000);
  const news = await searchTVNews({
    network: 'CNNW',
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    rows: 25,
  });
  assert.ok(news.items.length > 0, 'CNN Newsroom Live gate found no current-window items');

  const newsCandidates = news.items
    .map((item) => ({ item, timestamp: item.identifier.match(/^[A-Z0-9]+_(\d{8})_(\d{6})_/i) }))
    .filter(({ timestamp }) => timestamp)
    .sort((a, b) => `${b.timestamp[1]}T${b.timestamp[2]}`.localeCompare(`${a.timestamp[1]}T${a.timestamp[2]}`));
  const cnnItem = (newsCandidates[0]?.item ?? news.items[0]);
  const cnnResolved = await resolveBestFileUrl(cnnItem.identifier);
  assert.ok(cnnResolved.url, `CNN media could not be resolved for ${cnnItem.identifier}`);
  await waitForMedia(page, buildArchiveProxyUrl(proxyPathFromArchiveUrl(cnnResolved.url)), 'CNN Newsroom Live');

  const classic = await buildHoneymoonersEpg();
  assert.ok(classic.programs.length > 0, 'Classic TV gate produced no programs');
  await waitForMedia(page, buildArchiveProxyUrl(classic.programs[0].archivePath), 'Classic TV first full-list show');

  const verifiedCandidates = await validateMoviesClassicsPrograms(moviesClassicsManifest, page);
  assert.ok(
    verifiedCandidates.length >= 2,
    `Fewer than two verified Movies & Cinema Classics programs: only ${verifiedCandidates.length} passed real browser validation`,
  );

  const verifiedPrograms = buildMoviesClassicsFromVerified(verifiedCandidates);
  assert.equal(verifiedPrograms.length, verifiedCandidates.length);
  assert.ok(verifiedPrograms.every((program) => program.mediaUrl.startsWith('/api/archive/proxy?path=')));

  console.log(`[Real Archive Playback Gates] Verified catalog has ${verifiedPrograms.length} playable programs`);
  console.log('REAL ARCHIVE PLAYBACK GATES PASSED');
} finally {
  await browser.close();
}
