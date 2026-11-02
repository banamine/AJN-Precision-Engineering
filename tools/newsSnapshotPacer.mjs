const MIN_START_GAP_MS = 1_500;
const MAX_REDIRECTS = 10;

function retryAfterMs(value, nowMs) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - nowMs) : 0;
}

/**
 * Serial fetch wrapper for the manually-run news snapshot refresh.
 * Redirect hops are explicit requests, so each physical start passes through
 * the same global 1.5-second gate.
 */
export function createPacedArchiveFetch({
  fetchImpl = globalThis.fetch,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  let lastStartAt = null;
  let cooldownUntil = 0;
  let starts = 0;
  let gate = Promise.resolve();

  const pacedFetch = async (input, init = {}) => {
    const previous = gate;
    let release;
    gate = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      let url = input instanceof URL ? new URL(input.href) : new URL(typeof input === 'string' ? input : input.url);
      if (url.protocol !== 'https:' || !(url.hostname === 'archive.org' || url.hostname.endsWith('.archive.org'))) {
        throw new Error(`Archive request host is not allowed: ${url.hostname}`);
      }
      const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
      for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
        const waitUntil = Math.max(lastStartAt === null ? now() : lastStartAt + MIN_START_GAP_MS, cooldownUntil);
        const waitMs = Math.max(0, waitUntil - now());
        if (waitMs) await sleep(waitMs);

        const startedAt = now();
        lastStartAt = startedAt;
        starts += 1;
        const response = await fetchImpl(url, { ...init, headers, redirect: 'manual' });
        if (response.status === 429 || response.status === 503) {
          cooldownUntil = Math.max(cooldownUntil, startedAt + retryAfterMs(response.headers.get('retry-after'), startedAt));
        }

        const location = response.headers.get('location');
        if (![301, 302, 303, 307, 308].includes(response.status) || !location) return response;
        if (redirectCount === MAX_REDIRECTS) throw new Error(`Archive redirect limit exceeded for ${url.pathname}`);
        await response.body?.cancel();
        const redirected = new URL(location, url);
        if (redirected.protocol !== 'https:' || !(redirected.hostname === 'archive.org' || redirected.hostname.endsWith('.archive.org'))) {
          throw new Error(`Archive redirect host is not allowed: ${redirected.hostname}`);
        }
        url = redirected;
      }
      throw new Error('Archive redirect loop ended unexpectedly');
    } finally {
      release();
    }
  };

  pacedFetch.stats = () => ({ starts, lastStartAt, cooldownUntil });
  return pacedFetch;
}

export const NEWS_SNAPSHOT_MIN_GAP_MS = MIN_START_GAP_MS;
