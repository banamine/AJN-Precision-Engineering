// One shared budget for Archive *API* traffic (search, metadata, playlist files).
// Guide building can fire 100+ requests at boot; unthrottled, Archive rate-limits
// the server's IP and then the viewer's actual video requests fail too (seen live
// as 'Format error' on NOVA/Fox/documentaries during warm-up, fine afterwards).
// Media streaming through /api/archive/proxy does NOT go through this limiter
// except in NKER150 audit mode.
import { parseRetryAfter, sharedArchiveCooldownStore, waitForArchiveCooldown } from './archiveCooldown';

const MAX_CONCURRENT = 3;
const MIN_GAP_MS = 120;
const AUDIT_MIN_GAP_MS = 1_500;
let active = 0;
let lastPhysicalStart = 0;
let startGate: Promise<void> = Promise.resolve();
const queue: Array<() => void> = [];

export interface ArchivePhysicalRequestEvent {
  requestId: string | null;
  attempt: number | null;
  maxAttempts: number | null;
  stage: string | null;
  startedAt: string;
  gapMs: number | null;
  waitMs: number;
  host: string;
  path: string;
  status: number;
  retryAfter: string | null;
  errorCode?: string | null;
}

export interface ArchivePhysicalRequestContext {
  requestId?: string;
  attempt?: number;
  maxAttempts?: number;
  stage?: string;
  onPhysicalRequest?: (event: ArchivePhysicalRequestEvent) => void;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function requestSignal(input: RequestInfo | URL, init?: RequestInit): AbortSignal | undefined {
  if (init?.signal) return init.signal;
  return typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined;
}

function minimumGapMs(context?: ArchivePhysicalRequestContext): number {
  const configured = Number(process.env.AJN_ARCHIVE_MIN_GAP_MS);
  const normalFloor = Number.isFinite(configured) && configured > 0
    ? Math.max(MIN_GAP_MS, configured)
    : MIN_GAP_MS;
  return context || process.env.AJN_NKER150_AUDIT_LEDGER === '1'
    ? Math.max(AUDIT_MIN_GAP_MS, normalFloor)
    : normalFloor;
}

function waitAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function reservePhysicalStart(signal?: AbortSignal, context?: ArchivePhysicalRequestContext) {
  const previous = startGate;
  let release!: () => void;
  startGate = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    // A small audit-only cushion avoids setTimeout/Date.now quantization producing
    // a measured 1499 ms gap for a strict 1500 ms floor.
    const auditCushionMs = context || process.env.AJN_NKER150_AUDIT_LEDGER === '1' ? 10 : 0;
    const waitMs = Math.max(0, lastPhysicalStart + minimumGapMs(context) + auditCushionMs - Date.now());
    await waitAbortable(waitMs, signal);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const startedAt = Date.now();
    const gapMs = lastPhysicalStart ? startedAt - lastPhysicalStart : null;
    lastPhysicalStart = startedAt;
    return { startedAt, gapMs, waitMs, release };
  } catch (error) {
    release();
    throw error;
  }
}

function reportPhysicalRequest(context: ArchivePhysicalRequestContext | undefined, event: ArchivePhysicalRequestEvent): void {
  try { context?.onPhysicalRequest?.(event); } catch { /* diagnostics must not affect media requests */ }
}

function pump() {
  while (active < MAX_CONCURRENT && queue.length) {
    active++;
    const next = queue.shift()!;
    next();
  }
}

export function archiveApiFetchWithContext(
  input: RequestInfo | URL,
  init?: RequestInit,
  context?: ArchivePhysicalRequestContext,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    queue.push(() => {
      const url = requestUrl(input);
      const parsed = (() => {
        try { return new URL(url); } catch { return new URL('https://archive.org/'); }
      })();
      const host = parsed.hostname;
      const signal = requestSignal(input, init);
      void (async () => {
        try {
          if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          await waitForArchiveCooldown(host, signal);
          if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          const slot = await reservePhysicalStart(signal, context);
          let pending: Promise<Response>;
          try {
            pending = fetchImpl(input, init);
          } finally {
            slot.release();
          }
          let response: Response;
          try {
            response = await pending;
          } catch (error) {
            reportPhysicalRequest(context, {
              requestId: context?.requestId ?? null,
              attempt: context?.attempt ?? null,
              maxAttempts: context?.maxAttempts ?? null,
              stage: context?.stage ?? null,
              startedAt: new Date(slot.startedAt).toISOString(),
              gapMs: slot.gapMs,
              waitMs: slot.waitMs,
              host,
              path: parsed.pathname,
              status: 0,
              retryAfter: null,
              errorCode: (error as { code?: string; cause?: { code?: string } })?.code
                ?? (error as { cause?: { code?: string } })?.cause?.code
                ?? null,
            });
            throw error;
          }
          reportPhysicalRequest(context, {
            requestId: context?.requestId ?? null,
            attempt: context?.attempt ?? null,
            maxAttempts: context?.maxAttempts ?? null,
            stage: context?.stage ?? null,
            startedAt: new Date(slot.startedAt).toISOString(),
            gapMs: slot.gapMs,
            waitMs: slot.waitMs,
            host,
            path: parsed.pathname,
            status: response.status,
            retryAfter: response.headers.get('retry-after'),
          });
          if (response.status === 429 || response.status === 503) {
            const retryMs = parseRetryAfter(response.headers.get('retry-after'));
            if (retryMs !== null) sharedArchiveCooldownStore.extend(host, retryMs);
          }
          resolve(response);
        } catch (error) {
          reject(error);
        } finally {
          active--;
          pump();
        }
      })();
    });
    pump();
  });
}

export const archiveApiFetch: typeof fetch = (input: RequestInfo | URL, init?: RequestInit) =>
  archiveApiFetchWithContext(input, init);

export function resetArchiveLimiterForTests(): void {
  if (active !== 0 || queue.length !== 0) throw new Error('Cannot reset Archive limiter while requests are active');
  lastPhysicalStart = 0;
  startGate = Promise.resolve();
  sharedArchiveCooldownStore.clear();
}

export function archiveLimiterStats() { return { active, queued: queue.length }; }
