/* Browser-direct copy of the Daily Digest, used ONLY when the app server could not load it (for example its request to GitHub Pages
 * was rate-limited: HTTP 429). Same URL and same parser as the server and the News Cube (that page already reads it from the browser;
 * the file is public and sends access-control-allow-origin: *). Nothing is invented: a failure here is reported as a failure. */
import { useEffect, useState } from 'react';
import { NEWS_CUBE_CONFIG } from '../news-cube/useNewsCubeData';
import { parseNewsDigest, type DigestItem } from '../utils/newsDigest';

export interface DirectDigest { phase: 'idle' | 'loading' | 'ready' | 'error'; items: DigestItem[]; updatedAt: string | null; error: string | null }
const IDLE: DirectDigest = { phase: 'idle', items: [], updatedAt: null, error: null };
const RETRY_MS = 10 * 60_000; const FRESH_MS = 10 * 60_000;
let shared: { at: number; value: DirectDigest } | null = null;
let inflight: Promise<DirectDigest> | null = null;

async function load(): Promise<DirectDigest> {
  try {
    const r = await fetch(NEWS_CUBE_CONFIG.digestUrl, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = parseNewsDigest(await r.json());
    return { phase: 'ready', items: d.top.length ? d.top : d.bySource.flatMap((s) => s.items), updatedAt: d.updatedAt, error: null };
  } catch (e: any) { return { phase: 'error', items: [], updatedAt: null, error: String(e?.message ?? e) }; }
}
function get(): Promise<DirectDigest> {
  if (shared && Date.now() - shared.at < (shared.value.phase === 'ready' ? FRESH_MS : 60_000)) return Promise.resolve(shared.value);
  inflight ??= load().then((v) => { shared = { at: Date.now(), value: v }; return v; }).finally(() => { inflight = null; });
  return inflight;
}

export function useDirectDigest(enabled: boolean): DirectDigest {
  const [state, setState] = useState<DirectDigest>(IDLE);
  useEffect(() => {
    if (!enabled) { setState(IDLE); return; }
    let alive = true;
    const run = () => { setState((s) => (s.phase === 'ready' ? s : { ...IDLE, phase: 'loading' })); get().then((v) => { if (alive) setState(v); }); };
    run();
    const t = window.setInterval(run, RETRY_MS);
    return () => { alive = false; window.clearInterval(t); };
  }, [enabled]);
  return state;
}
