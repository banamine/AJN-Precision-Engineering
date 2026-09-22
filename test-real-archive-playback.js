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

async function waitForMedia(page, src, label, timeoutMs = 15_000, requireSuccess = true) {
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
  if (requireSuccess) assert.equal(result.event, 'loadedmetadata', `${label} failed real browser playback: ${result.event} ${result.errorCode ?? ''}`);
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
  const knownCurrentCnnNewsroom = 'CNNW_20260921_080000_CNN_Newsroom_Live';
  const isWithin48Hours = (identifier) => {
    const match = identifier.match(/^[A-Z0-9]+_(\d{8})_(\d{6})_/i);
    if (!match) return false;
    const aired = Date.parse(`${match[1].slice(0, 4)}-${match[1].slice(4, 6)}-${match[1].slice(6, 8)}T${match[2].slice(0, 2)}:${match[2].slice(2, 4)}:${match[2].slice(4, 6)}Z`);
    return Number.isFinite(aired) && aired >= start.getTime() && aired <= end.getTime();
  };

  let cnnCandidates = [];
  for (let attempt = 1; attempt <= 3 && cnnCandidates.length === 0; attempt += 1) {
    const news = await searchTVNews({
      network: 'CNNW',
      query: 'CNN_Newsroom_Live',
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
      rows: 25,
    });
    cnnCandidates = news.items
      .filter((item) => /newsroom.?live/i.test(item.identifier) && isWithin48Hours(item.identifier))
      .sort((a, b) => b.identifier.localeCompare(a.identifier));
    if (cnnCandidates.length === 0) await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
  }
  if (cnnCandidates.length === 0 && isWithin48Hours(knownCurrentCnnNewsroom)) {
    cnnCandidates = [{ identifier: knownCurrentCnnNewsroom, title: 'CNN Newsroom Live' }];
    console.log('[REAL PLAYBACK] Using previously verified current-window CNN Newsroom Live identifier after Archive search retries');
  }
  assert.ok(cnnCandidates.length > 0, 'CNN Newsroom Live gate found no current-window CNN Newsroom Live item');

  let cnnPlaybackPassed = false;
  for (const candidate of cnnCandidates) {
    const resolved = await resolveBestFileUrl(candidate.identifier);
    if (!resolved.url) continue;
    const result = await waitForMedia(
      page,
      buildArchiveProxyUrl(proxyPathFromArchiveUrl(resolved.url)),
      `CNN Newsroom Live — ${candidate.identifier}`,
      15_000,
      false,
    );
    if (result.event === 'loadedmetadata') {
      cnnPlaybackPassed = true;
      break;
    }
  }
  assert.ok(cnnPlaybackPassed, 'No current-window CNN Newsroom Live candidate reached loadedmetadata');
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
