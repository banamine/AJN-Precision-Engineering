// One shared budget for Archive *API* traffic (search, metadata, playlist files).
// Guide building can fire 100+ requests at boot; unthrottled, Archive rate-limits
// the server's IP and then the viewer's actual video requests fail too (seen live
// as 'Format error' on NOVA/Fox/documentaries during warm-up, fine afterwards).
// Media streaming through /api/archive/proxy does NOT go through this limiter.
const MAX_CONCURRENT = 3;
const MIN_GAP_MS = 120;
let active = 0;
let last = 0;
const queue: Array<() => void> = [];

function pump() {
  while (active < MAX_CONCURRENT && queue.length) {
    active++;
    const wait = Math.max(0, last + MIN_GAP_MS - Date.now());
    last = Date.now() + wait;
    const next = queue.shift()!;
    setTimeout(next, wait);
  }
}

export const archiveApiFetch: typeof fetch = (input: any, init?: any) =>
  new Promise<Response>((resolve, reject) => {
    queue.push(() => {
      fetch(input, init).then(resolve, reject).finally(() => { active--; pump(); });
    });
    pump();
  });

export function archiveLimiterStats() { return { active, queued: queue.length }; }
