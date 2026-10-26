import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
import {
  readNkerCatalog,
  readProxyEvidence,
  saveProxyEvidence,
  writeNker150Projections,
  type NkerCatalogItem,
  type ProxyEvidenceItem,
} from './owner-approval-data';
import { appendPhysicalEvents, decodePhysicalEvents } from './ledger';

const base = new URL(process.env.AJN_TEST_URL ?? 'http://127.0.0.1:3110');
if (!['localhost', '127.0.0.1', '::1'].includes(base.hostname)) throw new Error('browser verification is restricted to a loopback app');
const origin = base.origin;
const evidenceDir = path.resolve('tools/nker150/evidence');
const ledgerPath = path.resolve('tools/nker150/nker150_requests.csv');
const tempLedgerPath = `/tmp/ajn-nker150-owner-browser-${process.pid}.csv`;

interface PlaybackResult {
  identifier: string;
  title: string;
  result: 'PASS' | 'FAIL';
  failureBoundary?: string;
  reason?: string;
  httpStatus: number | null;
  currentSrc?: string;
  width?: number;
  height?: number;
  advancedSeconds?: number;
  ownerApprovalLabel?: boolean;
  archiveDetailsLink?: boolean;
  showLabel?: boolean;
  creatorLabel?: boolean;
  videoState?: {
    currentSrc: string;
    srcAttribute: string | null;
    paused: boolean;
    readyState: number;
    networkState: number;
    currentTime: number;
    duration: number;
    width: number;
    height: number;
    errorCode: number | null;
    errorMessage: string | null;
  } | null;
}

type LibraryTarget =
  | { kind: 'item'; id: string; title: string }
  | { kind: 'episode'; id: string; title: string; seriesTitle: string };

interface PreviousPlaybackEvidence {
  selectedIdentifiers?: string[];
  results: PlaybackResult[];
}

function evenlySample(items: NkerCatalogItem[], count: number): NkerCatalogItem[] {
  if (items.length <= count) return items;
  return Array.from({ length: count }, (_, index) => items[Math.round(index * (items.length - 1) / (count - 1))]);
}

function replaceEvidence(items: ProxyEvidenceItem[], next: ProxyEvidenceItem): ProxyEvidenceItem[] {
  return [...items.filter((item) => item.identifier !== next.identifier), next];
}

export async function runOwnerApprovedBrowserPlayback(): Promise<void> {
  const catalog = readNkerCatalog();
  const proxyEvidence = readProxyEvidence();
  const outputPath = path.join(evidenceDir, 'owner-approved-playback.json');
  const previousRun = fs.existsSync(outputPath)
    ? JSON.parse(fs.readFileSync(outputPath, 'utf8')) as PreviousPlaybackEvidence
    : null;
  const unplayedHarnessFailures = new Set((previousRun?.results ?? [])
    .filter((result) => result.result === 'FAIL' &&
      result.failureBoundary === 'library-item-selection' &&
      result.reason === 'No element found for selector: #library-filter-input')
    .map((result) => result.identifier));
  if (unplayedHarnessFailures.size) {
    let resetAny = false;
    proxyEvidence.items = proxyEvidence.items.map((item) => {
      if (!unplayedHarnessFailures.has(item.identifier) ||
          item.status !== 'FAILED' || item.failureBoundary !== 'library-item-selection') return item;
      resetAny = true;
      return {
        ...item,
        status: 'PROXY_VERIFIED',
        reason: 'bounded Archive range verified; prior browser run did not select or attempt playback',
        failureBoundary: undefined,
        httpStatus: undefined,
        contentType: undefined,
      };
    });
    if (resetAny) {
      saveProxyEvidence(proxyEvidence);
      writeNker150Projections(catalog, proxyEvidence);
    }
  }
  const byId = new Map(catalog.items.map((item) => [item.identifier, item]));
  const candidates = proxyEvidence.items
    .filter((item) => item.status === 'PROXY_VERIFIED')
    .map((item) => byId.get(item.identifier))
    .filter((item): item is NkerCatalogItem => Boolean(item));
  const requestedIdentifiers = process.env.AJN_NKER150_OWNER_APPROVAL_IDS
    ?.split(',').map((identifier) => identifier.trim()).filter(Boolean);
  const candidatesById = new Map(candidates.map((item) => [item.identifier, item]));
  const sample = requestedIdentifiers?.length
    ? requestedIdentifiers.map((identifier) => candidatesById.get(identifier)).filter((item): item is NkerCatalogItem => Boolean(item))
    : evenlySample(candidates, 5);
  if ((requestedIdentifiers?.length && sample.length !== requestedIdentifiers.length) ||
      (!requestedIdentifiers?.length && sample.length < 5)) {
    throw new Error(`Could not select the requested PROXY_VERIFIED browser items; requested=${requestedIdentifiers?.length ?? 5}, selected=${sample.length}`);
  }

  fs.rmSync(tempLedgerPath, { force: true });
  fs.mkdirSync(evidenceDir, { recursive: true });
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.CHROME_BIN ?? '/repl/tools/bin/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
  });
  const results: PlaybackResult[] = [];
  const blockedHosts = new Set<string>();
  const blockedExternalRequests: Array<{ identifier: string; url: string }> = [];
  const blockedThumbnailRequests: string[] = [];
  const pageErrors: string[] = [];
  let currentIdentifier = '';
  let lastProxyStatus: number | null = null;
  let lastProxyContentType: string | null = null;
  const failedProxyRequests: string[] = [];

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = request.url();
      if (url.startsWith(`${origin}/api/archive/proxy`)) {
        const archivePath = new URL(url).searchParams.get('path') ?? '';
        if (/__ia_thumb\.jpg$/i.test(archivePath)) {
          blockedThumbnailRequests.push(archivePath);
          void request.abort('blockedbyclient');
          return;
        }
      }
      if (url.startsWith(`${origin}/`) || /^(data|blob|about):/.test(url)) {
        void request.continue();
        return;
      }
      try {
        const parsed = new URL(url);
        blockedHosts.add(parsed.host);
        blockedExternalRequests.push({ identifier: currentIdentifier, url: `${parsed.host}${parsed.pathname}` });
      } catch {
        blockedHosts.add('unparseable');
        blockedExternalRequests.push({ identifier: currentIdentifier, url: 'unparseable' });
      }
      void request.abort('blockedbyclient');
    });
    page.on('pageerror', (error) => {
      pageErrors.push(error instanceof Error ? error.message : String(error));
    });
    page.on('requestfailed', (request) => {
      const failure = request.failure()?.errorText ?? '';
      if (failure === 'net::ERR_ABORTED' || failure === 'net::ERR_BLOCKED_BY_CLIENT' ||
          failure.startsWith('net::ERR_BLOCKED_BY_CLIENT.')) return;
      if (request.url().startsWith(`${origin}/api/archive/proxy`)) {
        failedProxyRequests.push(`${currentIdentifier}: ${failure || 'proxy request failed'}`);
      }
    });
    page.on('response', async (response) => {
      const responseUrl = new URL(response.url());
      if (responseUrl.origin !== origin || responseUrl.pathname !== '/api/archive/proxy') return;
      lastProxyStatus = response.status();
      lastProxyContentType = response.headers()['content-type'] ?? null;
      try {
        const headers = response.headers();
        const events = decodePhysicalEvents(headers['x-ajn-archive-physical'] ?? null);
        appendPhysicalEvents(
          tempLedgerPath,
          `browser-owner:${currentIdentifier}`,
          headers['x-proxy-request-id'] ?? null,
          events,
        );
      } catch (error) {
        failedProxyRequests.push(`${currentIdentifier}: physical ledger capture failed: ${(error as Error).message}`);
      }
    });

    await page.goto(`${origin}/#library`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const enterNkerLibrary = async () => {
      await page.evaluate(() => {
        if (window.location.hash !== '#library') window.location.hash = '#library';
      });
      await page.waitForSelector('#lib-cat-btn-nker150-special', { timeout: 45_000 });
      await page.click('#lib-cat-btn-nker150-special');
      await page.waitForSelector('#library-filter-input', { timeout: 20_000 });
    };
    for (const item of sample) {
      currentIdentifier = item.identifier;
      lastProxyStatus = null;
      lastProxyContentType = null;
      let failureBoundary = '';
      let reason = '';
      let measurements: { currentSrc: string; width: number; height: number; advancedSeconds: number } | undefined;
      let cardMetadata: { ownerApprovalLabel: boolean; archiveDetailsLink: boolean; showLabel: boolean; creatorLabel: boolean } | undefined;
      try {
        await enterNkerLibrary();
        await page.click('#library-filter-input');
        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await page.type('#library-filter-input', item.identifier, { delay: 5 });
        const target = await page.evaluate(async (identifier): Promise<LibraryTarget | null> => {
          const params = new URLSearchParams({ category: 'nker150-special', q: identifier, page: '1', limit: '24' });
          const response = await fetch(`/api/library/items?${params}`);
          if (!response.ok) return null;
          const data = await response.json() as {
            items: Array<{
              type: string;
              id: string;
              title?: string;
              identifier?: string;
              episodes?: Array<{ id: string; identifier: string; episodeTitle: string }>;
            }>;
          };
          for (const result of data.items) {
            if (result.type === 'item' && result.identifier === identifier && result.title) {
              return { kind: 'item', id: result.id, title: result.title };
            }
            const episode = result.episodes?.find((entry) => entry.identifier === identifier);
            if (result.type === 'series' && result.title && episode) {
              return { kind: 'episode', id: episode.id, title: episode.episodeTitle, seriesTitle: result.title };
            }
          }
          return null;
        }, item.identifier);
        if (!target) {
          failureBoundary = 'library-item-selection';
          throw new Error('The library API did not return the selected identifier');
        }
        if (target.kind === 'episode') {
          const expanded = await page.evaluate((seriesTitle) => {
            const card = Array.from(document.querySelectorAll('div.group')).find((candidate) =>
              candidate.querySelector('h2')?.textContent?.trim() === seriesTitle,
            );
            const toggle = card?.querySelector('button');
            toggle?.click();
            return Boolean(toggle);
          }, target.seriesTitle);
          if (!expanded) {
            failureBoundary = 'library-series-expansion';
            throw new Error(`Series card not found: ${target.seriesTitle}`);
          }
        }
        const playSelector = target.kind === 'item'
          ? `#play-lib-item-${target.id}`
          : `#play-lib-episode-${target.id}`;
        await page.waitForSelector(playSelector, { timeout: 20_000 });
        const card = await page.$eval(playSelector, (button) => {
          const container = button.closest('div.group');
          return {
            text: container?.textContent?.trim() ?? '',
            archiveDetailsLink: Boolean(container?.querySelector('a[href^="https://archive.org/details/"]')),
          };
        });
        if (!card.text.includes(target.title)) {
          failureBoundary = 'library-item-selection';
          throw new Error(`Expected library title ${target.title}; selected card did not contain it`);
        }
        cardMetadata = {
          ownerApprovalLabel: card.text.includes('Owner-approved for this collection.'),
          archiveDetailsLink: card.archiveDetailsLink,
          showLabel: card.text.includes(`Show: ${item.showLabel}`),
          creatorLabel: item.originalCreator ? card.text.includes(`Creator: ${item.originalCreator}`) : true,
        };
        if (!cardMetadata.ownerApprovalLabel || !cardMetadata.archiveDetailsLink ||
            !cardMetadata.showLabel || !cardMetadata.creatorLabel) {
          failureBoundary = 'owner-approved-card-metadata';
          throw new Error('Owner label, show/creator details, or Archive details link is missing');
        }
        await page.click(playSelector);
        await page.waitForFunction(
          (identifier) => {
            const video = document.querySelector('video');
            return Boolean(video && video.currentSrc.includes(identifier));
          },
          { timeout: 30_000 },
          item.identifier,
        ).catch(() => {
          failureBoundary = 'player-source';
          throw new Error('The in-app player did not load the selected Archive source');
        });
        await page.waitForFunction(
          (identifier) => {
            const video = document.querySelector('video');
            return Boolean(video && video.currentSrc.includes(identifier) && !video.paused &&
              video.currentTime > 0.5 && video.videoWidth > 0 && video.videoHeight > 0);
          },
          { timeout: 90_000 },
          item.identifier,
        ).catch(() => {
          failureBoundary = 'decode-or-start';
          throw new Error('No decoded, actively playing video frame appeared');
        });
        const start = await page.evaluate(() => {
          const video = document.querySelector('video')!;
          return { currentTime: video.currentTime, currentSrc: video.currentSrc, width: video.videoWidth, height: video.videoHeight };
        });
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const end = await page.evaluate(() => {
          const video = document.querySelector('video')!;
          return { currentTime: video.currentTime, paused: video.paused };
        });
        const advancedSeconds = Number((end.currentTime - start.currentTime).toFixed(3));
        if (end.paused || advancedSeconds < 0.5) {
          failureBoundary = 'playback-progress';
          throw new Error(`Playback did not advance reliably (${advancedSeconds}s; paused=${end.paused})`);
        }
        measurements = {
          currentSrc: new URL(start.currentSrc).pathname,
          width: start.width,
          height: start.height,
          advancedSeconds,
        };
      } catch (error) {
        reason = (error as Error).message;
        if (!failureBoundary) failureBoundary = 'library-item-selection';
      }

      let videoState: PlaybackResult['videoState'];
      if (failureBoundary === 'player-source' || failureBoundary === 'decode-or-start' ||
          failureBoundary === 'playback-progress') {
        videoState = await page.evaluate(() => {
          const video = document.querySelector('video');
          if (!(video instanceof HTMLVideoElement)) return null;
          return {
            currentSrc: video.currentSrc,
            srcAttribute: video.getAttribute('src'),
            paused: video.paused,
            readyState: video.readyState,
            networkState: video.networkState,
            currentTime: video.currentTime,
            duration: video.duration,
            width: video.videoWidth,
            height: video.videoHeight,
            errorCode: video.error?.code ?? null,
            errorMessage: video.error?.message ?? null,
          };
        }).catch(() => null);
      }
      const result: PlaybackResult = {
        identifier: item.identifier,
        title: item.title,
        result: reason ? 'FAIL' : 'PASS',
        ...(reason ? { failureBoundary, reason } : {}),
        httpStatus: lastProxyStatus,
        ...(cardMetadata ?? {}),
        ...(measurements ?? {}),
        ...(videoState !== undefined ? { videoState } : {}),
      };
      results.push(result);
      console.log(JSON.stringify({
        event: 'owner-approved-browser-result',
        identifier: result.identifier,
        result: result.result,
        httpStatus: result.httpStatus,
        failureBoundary: result.failureBoundary,
        reason: result.reason,
      }));
      const auditItem: ProxyEvidenceItem = {
        identifier: item.identifier,
        status: result.result === 'PASS' ? 'PLAYABLE_VERIFIED' : 'FAILED',
        auditedAt: new Date().toISOString(),
        httpStatus: result.httpStatus,
        ...(lastProxyContentType ? { contentType: lastProxyContentType } : {}),
        attempts: 1,
        reason: result.result === 'PASS'
          ? 'real-browser playback advanced with decoded video dimensions'
          : result.reason,
        ...(result.result === 'FAIL' ? { failureBoundary: result.failureBoundary } : {}),
      };
      proxyEvidence.items = replaceEvidence(proxyEvidence.items, auditItem);
    }
    saveProxyEvidence(proxyEvidence);
    writeNker150Projections(catalog, proxyEvidence);
  } finally {
    await browser.close();
    if (fs.existsSync(tempLedgerPath)) {
      const rows = fs.readFileSync(tempLedgerPath, 'utf8').trim().split(/\r?\n/).slice(1);
      if (rows.length) fs.appendFileSync(ledgerPath, `${rows.join('\n')}\n`);
    }
  }

  const previousResultsById = new Map((previousRun?.results ?? []).map((result) => [result.identifier, result]));
  for (const result of results) previousResultsById.set(result.identifier, result);
  const selectedIdentifiers = previousRun?.selectedIdentifiers?.length
    ? previousRun.selectedIdentifiers
    : sample.map((item) => item.identifier);
  const mergedResults = selectedIdentifiers.flatMap((identifier) => {
    const result = previousResultsById.get(identifier);
    return result ? [result] : [];
  });
  const output = {
    runAt: new Date().toISOString(),
    sampledFrom: 'PROXY_VERIFIED',
    selectedIdentifiers,
    results: mergedResults,
    firstFailure: mergedResults.find((item) => item.result === 'FAIL') ?? null,
    blockedExternalHosts: [...blockedHosts],
    blockedExternalRequests,
    blockedThumbnailRequests,
    failedProxyRequests,
    pageErrors,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output, null, 2));
  if (mergedResults.some((item) => item.result === 'FAIL') || mergedResults.length !== 5 ||
      failedProxyRequests.length || pageErrors.length) process.exitCode = 1;
}
