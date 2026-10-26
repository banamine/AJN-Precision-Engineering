import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { appendPhysicalEvents, decodePhysicalEvents } from './ledger';
import { runOwnerApprovedBrowserPlayback } from './browser-playback-owner';

const identifier = '01_20200728_20200728_1511';
const itemId = `ia-${identifier}`;
const expectedTitle = 'The Alex Jones Show January 2019 (HD)';
const base = new URL(process.env.AJN_TEST_URL ?? 'http://127.0.0.1:3110');
if (!['localhost', '127.0.0.1', '::1'].includes(base.hostname)) {
  throw new Error('browser verification is restricted to a loopback app');
}
const origin = base.origin;
const evidenceDir = path.resolve('tools/nker150/evidence');
const samplePath = '/tmp/ajn-nker150-first-slice.mp4';
const tempEvidenceDir = `/tmp/ajn-nker150-browser-evidence-${process.pid}`;
const tempLedgerPath = `/tmp/ajn-nker150-browser-requests-${process.pid}.csv`;
fs.rmSync(tempEvidenceDir, { recursive: true, force: true });
fs.rmSync(tempLedgerPath, { force: true });
fs.mkdirSync(tempEvidenceDir, { recursive: true });
fs.mkdirSync(evidenceDir, { recursive: true });
let savedSample = false;
const blockedHosts = new Set<string>();
const failures: string[] = [];
const proxyRequests: string[] = [];
const failedProxyRequests: string[] = [];
const abortedProxyRequests: string[] = [];
const ledgerPath = path.resolve('tools/nker150/nker150_requests.csv');

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.CHROME_BIN ?? '/repl/tools/bin/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = request.url();
      if (url.startsWith(`${origin}/`) || /^(data|blob|about):/.test(url)) {
        if (url.includes('/api/archive/proxy')) {
          const parsed = new URL(url);
          proxyRequests.push(`${request.method()} ${parsed.pathname}?path=${parsed.searchParams.get('path') ?? ''}`);
        }
        void request.continue();
        return;
      }
      try { blockedHosts.add(new URL(url).host); } catch { blockedHosts.add('unparseable'); }
      void request.abort('blockedbyclient');
    });
    page.on('requestfailed', (request) => {
      if (request.url().startsWith(`${origin}/`)) {
        const label = `${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText ?? 'failed'}`;
        failures.push(label);
        if (request.url().includes('/api/archive/proxy')) {
          if (request.failure()?.errorText === 'net::ERR_ABORTED') abortedProxyRequests.push(label);
          else failedProxyRequests.push(label);
        }
      }
    });
    page.on('response', async (response) => {
      const responseUrl = new URL(response.url());
      if (responseUrl.origin !== origin || responseUrl.pathname !== '/api/archive/proxy') return;
      try {
        const headers = response.headers();
        const events = decodePhysicalEvents(headers['x-ajn-archive-physical'] ?? null);
        appendPhysicalEvents(
          tempLedgerPath,
          `browser:${responseUrl.searchParams.get('path') ?? 'archive-proxy'}`,
          headers['x-proxy-request-id'] ?? null,
          events,
        );
        if (!savedSample && response.status() === 206 && /^video\/mp4\b/i.test(headers['content-type'] ?? '')) {
          const body = await response.buffer();
          if (body.byteLength <= 8_388_608) {
            fs.writeFileSync(samplePath, body);
            savedSample = true;
          }
        }
      } catch (error) {
        failures.push(`proxy response capture failed: ${(error as Error).message}`);
      }
    });

    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const libraryClicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const button = buttons.find((candidate) => candidate.textContent?.trim() === 'Library');
      button?.click();
      return Boolean(button);
    });
    assert.ok(libraryClicked, 'existing Library navigation button is present');
    await page.waitForSelector('#lib-cat-btn-nker150-special', { timeout: 20_000 });
    await page.click('#lib-cat-btn-nker150-special');
    await page.waitForSelector(`#play-lib-item-${itemId}`, { timeout: 20_000 });
    await page.click(`#play-lib-item-${itemId}`);
    try {
      await page.waitForFunction(
        ({ title, id }) => {
          const titleNode = document.querySelector('[data-testid="player-title"]');
          const video = document.querySelector('video');
          return titleNode?.textContent?.trim() === title &&
            Boolean(video?.currentSrc.includes(id)) &&
            Boolean(video && !video.paused && video.currentTime > 0.5 && video.videoWidth > 0 && video.videoHeight > 0);
        },
        { timeout: 60_000 },
        { title: expectedTitle, id: identifier },
      );
    } catch (error) {
      const diagnostics = await page.evaluate(() => ({
        hash: location.hash,
        playerTitle: document.querySelector('[data-testid="player-title"]')?.textContent?.trim() ?? null,
        alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((node) => node.textContent?.trim() ?? ''),
        media: Array.from(document.querySelectorAll<HTMLMediaElement>('video,audio')).map((media) => ({
          tag: media.tagName,
          src: media.getAttribute('src'),
          currentSrc: media.currentSrc,
          paused: media.paused,
          currentTime: media.currentTime,
          readyState: media.readyState,
          networkState: media.networkState,
          error: media.error?.code ?? null,
        })),
      }));
      await page.screenshot({ path: path.join(tempEvidenceDir, '00-playback-diagnostic.png'), fullPage: true });
      console.error(JSON.stringify({ phase: 'first-item-playback', diagnostics, proxyRequests, blockedExternalHosts: [...blockedHosts], localFailures: failures, failedProxyRequests }, null, 2));
      throw error;
    }
    const firstStart = await page.evaluate(() => {
      const video = document.querySelector('video')!;
      const measured = video as HTMLVideoElement & { webkitAudioDecodedByteCount?: number };
      return {
        currentTime: video.currentTime,
        currentSrc: video.currentSrc,
        width: video.videoWidth,
        height: video.videoHeight,
        audioDecodedBytes: measured.webkitAudioDecodedByteCount ?? null,
      };
    });
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const firstEnd = await page.evaluate(() => {
      const video = document.querySelector('video')!;
      const measured = video as HTMLVideoElement & { webkitAudioDecodedByteCount?: number };
      return { currentTime: video.currentTime, paused: video.paused, audioDecodedBytes: measured.webkitAudioDecodedByteCount ?? null };
    });
    assert.ok(firstEnd.currentTime - firstStart.currentTime >= 0.5, 'video currentTime advances by at least 0.5 seconds');
    assert.equal(firstEnd.paused, false, 'the video is actively playing');
    await page.screenshot({ path: path.join(tempEvidenceDir, '01-library-playing.png'), fullPage: true });

    const pauseButton = await page.$('button[aria-label="Pause"]');
    assert.ok(pauseButton, 'existing player exposes its pause control');
    await pauseButton.click();
    await page.waitForFunction(() => {
      const video = document.querySelector('video');
      return Boolean(video?.paused);
    }, { timeout: 5000 });
    const stoppedTime = await page.evaluate(() => document.querySelector('video')?.currentTime ?? -1);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const afterPauseTime = await page.evaluate(() => document.querySelector('video')?.currentTime ?? -1);
    assert.ok(afterPauseTime - stoppedTime < 0.15, 'pause control stops media progression');

    const switchResult = await page.evaluate(async (targetIdentifier) => {
      const response = await fetch('/api/library/items?limit=12');
      const data = await response.json();
      const next = data.items.find((item: any) => item.type === 'item' && item.mediaType === 'video' && item.identifier !== targetIdentifier);
      return next ? { id: next.id, identifier: next.identifier, title: next.title } : null;
    }, identifier);
    if (switchResult) {
      await page.evaluate(() => {
        const button = Array.from(document.querySelectorAll('button')).find((candidate) => candidate.textContent?.trim() === 'Library');
        button?.click();
      });
      await page.waitForSelector('#lib-cat-btn-all', { timeout: 15_000 });
      await page.click('#lib-cat-btn-all');
      await page.waitForSelector(`#play-lib-item-${switchResult.id}`, { timeout: 15_000 });
      await page.click(`#play-lib-item-${switchResult.id}`);
      await page.waitForFunction(
        ({ id, title }) => {
          const video = document.querySelector('video');
          return Boolean(video?.currentSrc.includes(id)) &&
            document.querySelector('[data-testid="player-title"]')?.textContent?.trim() === title;
        },
        { timeout: 30_000 },
        { id: switchResult.identifier, title: switchResult.title },
      );
    }

    if (switchResult) {
      await page.waitForFunction(
        () => {
          const media = Array.from(document.querySelectorAll<HTMLMediaElement>('video,audio'));
          return media.some((element) => (!element.paused && !element.ended) || element.error !== null);
        },
        { timeout: 30_000 },
      ).catch(() => undefined);
    }
    const switchState = await page.evaluate(() => {
      const media = Array.from(document.querySelectorAll<HTMLMediaElement>('video,audio'));
      return {
        activeMediaCount: media.filter((element) => !element.paused && !element.ended).length,
        elements: media.map((element) => ({
          kind: element.tagName.toLowerCase(),
          paused: element.paused,
          ended: element.ended,
          readyState: element.readyState,
          networkState: element.networkState,
          currentSrc: element.currentSrc,
          videoWidth: element instanceof HTMLVideoElement ? element.videoWidth : null,
          videoHeight: element instanceof HTMLVideoElement ? element.videoHeight : null,
          audioDecodedBytes: element instanceof HTMLVideoElement
            ? ((element as HTMLVideoElement & { webkitAudioDecodedByteCount?: number }).webkitAudioDecodedByteCount ?? null)
            : null,
          errorCode: element.error?.code ?? null,
        })),
      };
    });
    const playingCount = switchState.activeMediaCount;
    await page.screenshot({ path: path.join(tempEvidenceDir, '02-library-switched.png'), fullPage: true });
    const output = {
      firstItem: {
        identifier,
        title: expectedTitle,
        currentSrcPath: new URL(firstStart.currentSrc).pathname,
        videoWidth: firstStart.width,
        videoHeight: firstStart.height,
        audioDecodedBytesAtStart: firstStart.audioDecodedBytes,
        audioDecodedBytesAtEnd: firstEnd.audioDecodedBytes,
        currentTimeAdvancedSeconds: Number((firstEnd.currentTime - firstStart.currentTime).toFixed(3)),
        pauseWorks: afterPauseTime - stoppedTime < 0.15,
      },
      switchedTo: switchResult,
      switchState,
      activeMediaCountAfterSwitch: playingCount,
      firstSliceSaved: savedSample,
      blockedExternalHostCount: blockedHosts.size,
      blockedExternalHosts: [...blockedHosts],
      localRequestFailures: failures,
      failedArchiveProxyRequests: failedProxyRequests,
      expectedAbortedArchiveProxyRequests: abortedProxyRequests,
      screenshots: ['tools/nker150/evidence/01-library-playing.png', 'tools/nker150/evidence/02-library-switched.png'],
    };
    fs.writeFileSync(path.join(tempEvidenceDir, 'browser-playback.json'), `${JSON.stringify(output, null, 2)}\n`);
    console.log(JSON.stringify(output, null, 2));
    assert.equal(playingCount, switchResult ? 1 : 0, 'the app has at most one active media element after pause/switch');
    assert.equal(failedProxyRequests.length, 0, 'no failed local Archive proxy requests (browser cancellations are recorded separately)');
    assert.equal(savedSample, true, 'one bounded video/mp4 206 slice was captured for ffprobe');
  } finally {
    await browser.close();
    fs.mkdirSync(evidenceDir, { recursive: true });
    for (const file of fs.readdirSync(tempEvidenceDir)) {
      fs.copyFileSync(path.join(tempEvidenceDir, file), path.join(evidenceDir, file));
    }
    if (fs.existsSync(tempLedgerPath)) {
      const rows = fs.readFileSync(tempLedgerPath, 'utf8').trim().split(/\r?\n/).slice(1);
      if (rows.length) fs.appendFileSync(ledgerPath, `${rows.join('\n')}\n`);
    }
  }
}

const run = process.env.AJN_NKER150_OWNER_APPROVAL_BATCH === '1'
  ? runOwnerApprovedBrowserPlayback()
  : main();
run.catch((error) => {
  console.error(`browser playback verification failed: ${(error as Error).stack ?? String(error)}`);
  process.exitCode = 1;
});
