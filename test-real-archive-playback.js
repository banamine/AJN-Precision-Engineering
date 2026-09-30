import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import moviesClassicsManifest from './src/data/moviesClassicsManifest.json' with { type: 'json' };
import { searchTVNews, resolveArchiveMediaCandidates, tryResolveArchiveMediaCandidates, getSafeArchiveUrl } from './channels.ts';
import { resolveMoviesClassicsManifest } from './src/services/producers/moviesClassicsProducer.ts';
import { buildHoneymoonersEpg } from './collections/honeymooners-epg.ts';
import {
  buildMoviesClassicsFromVerified,
  validateMoviesClassicsPrograms,
} from './src/services/producers/moviesClassicsProducer.ts';
import { buildArchiveProxyUrl } from './src/utils/archivePlayback.ts';
import { CLIP_SECONDS } from './server/sources/archiveNews.ts';

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
  // Archive.org publishes TV News recordings with a delay of one to several days,
  // so a fixed 48h window regularly contains nothing. Use a 7-day window and pick
  // the newest item; no hard-coded identifier (it expires as time passes).
  const CNN_WINDOW_DAYS = 7;
  const start = new Date(end.getTime() - CNN_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const isWithinWindow = (identifier) => {
    const match = identifier.match(/^[A-Z0-9]+_(\d{8})_(\d{6})_/i);
    if (!match) return false;
    const aired = Date.parse(`${match[1].slice(0, 4)}-${match[1].slice(4, 6)}-${match[1].slice(6, 8)}T${match[2].slice(0, 2)}:${match[2].slice(2, 4)}:${match[2].slice(4, 6)}Z`);
    return Number.isFinite(aired) && aired >= start.getTime() && aired <= end.getTime();
  };

  // Resolve stored filenames against live Archive metadata before probing playback.
  const resolvedManifest = await resolveMoviesClassicsManifest(moviesClassicsManifest, tryResolveArchiveMediaCandidates);
  console.log('[MovieResolver]', JSON.stringify({
    kept: resolvedManifest.report.kept.length,
    unverified: resolvedManifest.report.unverified.length,
    replaced: resolvedManifest.report.replaced,
    dropped: resolvedManifest.report.dropped.map((d) => d.identifier),
  }));
  const verifiedCandidates = await validateMoviesClassicsPrograms(resolvedManifest.items, page);
  assert.ok(
    verifiedCandidates.length >= 2,
    `Fewer than two verified Movies & Cinema Classics programs: only ${verifiedCandidates.length} passed real browser validation`,
  );

  const verifiedPrograms = buildMoviesClassicsFromVerified(verifiedCandidates);
  assert.equal(verifiedPrograms.length, verifiedCandidates.length);
  assert.ok(verifiedPrograms.every((program) => program.mediaUrl.startsWith('/api/archive/proxy?path=')));


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
      .filter((item) => /newsroom.?live/i.test(item.identifier) && isWithinWindow(item.identifier))
      .sort((a, b) => b.identifier.localeCompare(a.identifier));
    if (cnnCandidates.length === 0) await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
  }
  assert.ok(cnnCandidates.length > 0, `CNN Newsroom Live gate found no CNN Newsroom Live item aired in the last ${CNN_WINDOW_DAYS} days`);

  // TV News recordings are access-restricted as whole files (HTTP 403), but Archive serves
  // exact clip windows of them. That is what the news guide and discovery channels play
  // (server/sources/archiveNews.ts), so this gate plays the same clip through the proxy.
  // A failure here is a real news-playback failure, not an external availability condition.
  let cnnPlaybackPassed = false;
  for (const candidate of cnnCandidates) {
    const id = candidate.identifier;
    const clipPath = `/download/${encodeURIComponent(id)}/${encodeURIComponent(`${id}.mp4`)}?exact=1&start=0&end=${CLIP_SECONDS}`;
    const result = await waitForMedia(
      page,
      buildArchiveProxyUrl(clipPath),
      `CNN Newsroom Live clip — ${id} — 0-${CLIP_SECONDS}s`,
      20_000,
      false,
    );
    if (result.event === 'loadedmetadata') {
      console.log(`[CNN clip] ${id} played through the proxy (clip 0-${CLIP_SECONDS}s)`);
      cnnPlaybackPassed = true;
      break;
    }
    console.warn(`[CNN clip] ${id} clip did not load: ${result.message ?? result.event}`);
  }
  assert.ok(cnnPlaybackPassed, `No current-window CNN Newsroom Live clip (0-${CLIP_SECONDS}s) reached loadedmetadata through the proxy (${cnnCandidates.length} candidates tried)`);
  const classic = await buildHoneymoonersEpg();
  assert.ok(classic.programs.length > 0, 'Classic TV gate produced no programs');
  await waitForMedia(page, buildArchiveProxyUrl(classic.programs[0].archivePath), 'Classic TV first full-list show');

  console.log(`[Real Archive Playback Gates] Verified catalog has ${verifiedPrograms.length} playable programs`);
  console.log('REAL ARCHIVE PLAYBACK GATES PASSED');
} finally {
  await browser.close();
}
