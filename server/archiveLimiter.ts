// One shared budget for Archive *API* traffic (search, metadata, playlist files).
// Guide building can fire 100+ requests at boot; unthrottled, Archive rate-limits
// the server's IP and then the viewer's actual video requests fail too (seen live
// as 'Format error' on NOVA/Fox/documentaries during warm-up, fine afterwards).
// Media streaming through /api/archive/proxy does NOT go through this limiter.
import { parseRetryAfter, sharedArchiveCooldownStore, waitForArchiveCooldown } from './archiveCooldown';

const MAX_CONCURRENT = 3;
const MIN_GAP_MS = 120;
let active = 0;
let last = 0;
const queue: Array<() => void> = [];

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function requestSignal(input: RequestInfo | URL, init?: RequestInit): AbortSignal | undefined {
  if (init?.signal) return init.signal;
  return typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined;
}

function pump() {
  while (active < MAX_CONCURRENT && queue.length) {
    active++;
    const wait = Math.max(0, last + MIN_GAP_MS - Date.now());
    last = Date.now() + wait;
    const next = queue.shift()!;
    setTimeout(next, wait);
  }
}

export const archiveApiFetch: typeof fetch = (input: RequestInfo | URL, init?: RequestInit) =>
  new Promise<Response>((resolve, reject) => {
    queue.push(() => {
      const url = requestUrl(input);
      const host = (() => {
        try { return new URL(url).hostname; } catch { return 'archive.org'; }
      })();
      const signal = requestSignal(input, init);
      void (async () => {
        try {
          if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          await waitForArchiveCooldown(host, signal);
          if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          const response = await fetch(input, init);
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

export function archiveLimiterStats() { return { active, queued: queue.length }; }
