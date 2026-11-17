/* One fetch helper for the Weather page. A bare network failure (the browser's "Failed to fetch") is retried once after 2.5 s;
 * an HTTP error is reported with its status and never retried. Throws on abort so callers can ignore stale requests. */
export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = 'HttpError'; }
}
export async function fetchJson(url: string, signal: AbortSignal, init?: RequestInit): Promise<unknown> {
  let res: Response;
  try { res = await fetch(url, { ...init, signal }); }
  catch (first) {
    if (signal.aborted || !(first instanceof TypeError)) throw first;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 2500));
    if (signal.aborted) throw first;
    res = await fetch(url, { ...init, signal });
  }
  if (!res.ok) throw new HttpError(res.status, `Service answered HTTP ${res.status}`);
  return res.json();
}

/** State of one data source on the Weather page. Each source loads and fails on its own; "na" means the source does not cover this place. */
export type Src<T> = { kind: 'idle' } | { kind: 'loading' } | { kind: 'ok'; data: T; at: number } | { kind: 'na'; note: string } | { kind: 'error'; message: string };
