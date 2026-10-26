import path from 'node:path';
import ownerApprovals from './owner-approvals.json';
import { classifyShow } from './classify';
import { appendPhysicalEvents, decodePhysicalEvents } from './ledger';
import {
  readNkerCatalog,
  readProxyEvidence,
  saveProxyEvidence,
  writeNker150Projections,
  type ProxyEvidenceItem,
} from './owner-approval-data';

function localBase(): URL {
  const url = new URL(process.env.AJN_TEST_URL ?? 'http://127.0.0.1:3110');
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error('AJN_TEST_URL must be a loopback server; audit.ts makes no direct Archive calls');
  }
  return url;
}

const isBrowserSafeFormat = (format: string | null | undefined, filename: string): boolean =>
  /(?:mpeg[\s-]?4|h[.\s-]?264|avc)/i.test(format ?? '') && /\.mp4$/i.test(filename);

function replaceEvidence(items: ProxyEvidenceItem[], next: ProxyEvidenceItem): ProxyEvidenceItem[] {
  return [...items.filter((item) => item.identifier !== next.identifier), next];
}

function appAttempts(events: ReturnType<typeof decodePhysicalEvents>): number {
  return new Set(events.map((event) => event.attempt).filter((attempt): attempt is number => attempt !== null)).size;
}

async function main() {
  if (process.env.AJN_NKER150_AUDIT_LEDGER !== '1') throw new Error('Set AJN_NKER150_AUDIT_LEDGER=1 for the paced audit ledger');
  if (process.env.AJN_NKER150_AUDIT_MODE === '1') throw new Error('Unset AJN_NKER150_AUDIT_MODE; the owner review must use normal exposure rules');
  const base = localBase();
  const root = path.resolve('tools/nker150');
  const requestsPath = path.join(root, 'nker150_requests.csv');
  const catalog = readNkerCatalog();
  const evidence = readProxyEvidence();
  const approvedIds = ownerApprovals.approvals.map((approval) => approval.identifier);
  const alexItems = catalog.items.filter((item) => classifyShow({
    identifier: item.identifier,
    title: item.title,
    creator: item.originalCreator ?? '',
  }).showId === 'alex-jones-show');
  if (approvedIds.length !== 90 || alexItems.length !== 90) {
    throw new Error(`Expected exactly 90 approvals and classified items; approvals=${approvedIds.length}; classified=${alexItems.length}; ids=${alexItems.map((item) => item.identifier).join(', ')}`);
  }
  const classifiedIds = new Set(alexItems.map((item) => item.identifier));
  if (approvedIds.some((identifier) => !classifiedIds.has(identifier)) || classifiedIds.size !== approvedIds.length) {
    throw new Error('Owner approvals do not exactly match the Alex Jones Show classification');
  }

  writeNker150Projections(catalog, evidence);
  const prior = new Map(evidence.items.map((item) => [item.identifier, item]));
  const physicalStarts: Array<{ startedAt: string; gapMs: number | null; status: number | null }> = [];
  let requestedItems = 0;
  let consecutiveSystemFailures = 0;
  let stoppedForSustainedFailure = false;

  for (const item of alexItems) {
    const previous = prior.get(item.identifier);
    if (previous) continue;

    if (item.technicalStatus === 'RESTRICTED' || item.file?.isPrivate) {
      const skipped: ProxyEvidenceItem = {
        identifier: item.identifier, status: 'RESTRICTED', auditedAt: new Date().toISOString(),
        httpStatus: null, attempts: 0, reason: 'restricted item or file; no request made',
      };
      evidence.items = replaceEvidence(evidence.items, skipped);
      prior.set(item.identifier, skipped);
      saveProxyEvidence(evidence);
      writeNker150Projections(catalog, evidence);
      console.log(JSON.stringify({ identifier: item.identifier, status: skipped.status, requests: 0 }));
      continue;
    }
    if (!item.file || !isBrowserSafeFormat(item.file.format, item.file.filename)) {
      const skipped: ProxyEvidenceItem = {
        identifier: item.identifier, status: 'NO_SUPPORTED_VIDEO', auditedAt: new Date().toISOString(),
        httpStatus: null, attempts: 0, reason: 'no selected browser-safe MPEG4 or H.264 MP4 file; no request made',
      };
      evidence.items = replaceEvidence(evidence.items, skipped);
      prior.set(item.identifier, skipped);
      saveProxyEvidence(evidence);
      writeNker150Projections(catalog, evidence);
      console.log(JSON.stringify({ identifier: item.identifier, status: skipped.status, requests: 0 }));
      continue;
    }
    if (item.technicalStatus === 'VERIFIED') {
      const alreadyPlayable: ProxyEvidenceItem = {
        identifier: item.identifier, status: 'PLAYABLE_VERIFIED', auditedAt: new Date().toISOString(),
        httpStatus: null, attempts: 0, reason: 'existing browser playback evidence retained; no request made',
      };
      evidence.items = replaceEvidence(evidence.items, alreadyPlayable);
      prior.set(item.identifier, alreadyPlayable);
      saveProxyEvidence(evidence);
      writeNker150Projections(catalog, evidence);
      console.log(JSON.stringify({ identifier: item.identifier, status: alreadyPlayable.status, requests: 0 }));
      continue;
    }

    const proxyUrl = new URL('/api/archive/proxy', base);
    proxyUrl.searchParams.set('path', item.file.path);
    const requestId = `nker150-owner-audit-${item.identifier}-${Date.now()}`;
    let status: number | null = null;
    let contentType: string | null = null;
    let contentRange: string | null = null;
    let bytes = 0;
    let events: ReturnType<typeof decodePhysicalEvents> = [];
    let requestError: string | undefined;
    try {
      const response = await fetch(proxyUrl, {
        headers: {
          Range: 'bytes=0-1023',
          'User-Agent': 'AJN-NKER150-Owner-Audit/1.0 (local verification; no metadata refetch)',
          'X-Request-ID': requestId,
        },
        signal: AbortSignal.timeout(45_000),
      });
      status = response.status;
      contentType = response.headers.get('content-type');
      contentRange = response.headers.get('content-range');
      const physicalHeader = response.headers.get('x-ajn-archive-physical');
      if (!physicalHeader) throw new Error('physical audit header missing; confirm AJN_NKER150_AUDIT_LEDGER=1');
      events = decodePhysicalEvents(physicalHeader);
      appendPhysicalEvents(requestsPath, `owner-audit:${item.identifier}`, response.headers.get('x-proxy-request-id'), events);
      physicalStarts.push(...events.map((event) => ({ startedAt: event.startedAt, gapMs: event.gapMs, status: event.status })));
      bytes = (await response.arrayBuffer()).byteLength;
    } catch (error) {
      requestError = (error as Error).message;
    }

    requestedItems += 1;
    const validContentRange = Boolean(contentRange && /^bytes 0-\d+\/(?:\d+|\*)$/i.test(contentRange));
    const passed = status === 206 && /^video\//i.test(contentType ?? '') && validContentRange && bytes <= 1024;
    const result: ProxyEvidenceItem = {
      identifier: item.identifier,
      status: passed ? 'PROXY_VERIFIED' : 'FAILED',
      auditedAt: new Date().toISOString(),
      httpStatus: status,
      contentType,
      contentRange,
      attempts: appAttempts(events),
      reason: passed
        ? 'bounded Archive proxy range verified; browser playback not yet confirmed'
        : requestError ?? `range verification failed: HTTP ${status ?? 'no response'}, content-type=${contentType ?? 'missing'}, content-range=${contentRange ?? 'missing'}, bytes=${bytes}`,
      ...(!passed ? { failureBoundary: requestError ? 'proxy-request' : 'bounded-range-response' } : {}),
    };
    evidence.items = replaceEvidence(evidence.items, result);
    prior.set(item.identifier, result);
    saveProxyEvidence(evidence);
    writeNker150Projections(catalog, evidence);
    console.log(JSON.stringify({
      identifier: item.identifier,
      status: result.status,
      httpStatus: result.httpStatus,
      contentType: result.contentType,
      contentRange: result.contentRange,
      bytes,
      attempts: result.attempts,
      physicalStarts: events.length,
      error: requestError,
    }));

    if (status === 429 || (status !== null && status >= 500)) consecutiveSystemFailures += 1;
    else consecutiveSystemFailures = 0;
    if (consecutiveSystemFailures >= 3) {
      stoppedForSustainedFailure = true;
      break;
    }
  }

  const approvedResults = alexItems.map((item) => evidence.items.find((result) => result.identifier === item.identifier)).filter((result): result is ProxyEvidenceItem => Boolean(result));
  const gaps = physicalStarts.map((event) => event.gapMs).filter((gap): gap is number => gap !== null);
  const summary = {
    approvalCount: approvedIds.length,
    requestedItems,
    proxyVerified: approvedResults.filter((item) => item.status === 'PROXY_VERIFIED').length,
    failed: approvedResults.filter((item) => item.status === 'FAILED').map((item) => ({ identifier: item.identifier, status: item.httpStatus, reason: item.reason })),
    skippedNoSupportedVideo: approvedResults.filter((item) => item.status === 'NO_SUPPORTED_VIDEO').map((item) => item.identifier),
    skippedRestricted: approvedResults.filter((item) => item.status === 'RESTRICTED').map((item) => item.identifier),
    alreadyPlayable: approvedResults.filter((item) => item.status === 'PLAYABLE_VERIFIED').map((item) => item.identifier),
    physicalStarts: physicalStarts.length,
    physicalStartTimes: physicalStarts.map((event) => event.startedAt),
    minimumGapMs: gaps.length ? Math.min(...gaps) : null,
    any429: physicalStarts.some((event) => event.status === 429),
    any5xx: physicalStarts.some((event) => event.status !== null && event.status >= 500),
    stoppedForSustainedFailure,
    requestLedger: requestsPath,
  };
  console.log(JSON.stringify({ event: 'owner-approval-audit-summary', ...summary }));
  if (gaps.some((gap) => gap < 1500)) throw new Error(`Archive physical start gap below 1500 ms: ${Math.min(...gaps)}`);
  if (stoppedForSustainedFailure) process.exitCode = 75;
  else if (summary.failed.length || summary.proxyVerified + summary.alreadyPlayable.length + summary.skippedNoSupportedVideo.length + summary.skippedRestricted.length < 90) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`audit failed: ${(error as Error).message}`);
  process.exitCode = 1;
});
