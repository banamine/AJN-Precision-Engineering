// Loads /api/digest (Daily News Digest, headlines and links only) and refreshes it every 15 minutes.
// A failed refresh keeps the last good digest and says so; it never hides the failure.
import { useEffect, useState } from 'react';
import type { Digest } from '../utils/newsDigest';

export interface DigestResponse { digest: Digest; fetchedAt: string | null; status: 'ok' | 'error' | 'pending'; error: string | null }
export interface DigestView { phase: 'loading' | 'ready' | 'error'; data: DigestResponse | null; error: string | null }

export const DIGEST_POLL_MS = 15 * 60_000;

export function useDigest(): DigestView {
  const [view, setView] = useState<DigestView>({ phase: 'loading', data: null, error: null });
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch('/api/digest', { signal: controller.signal });
        if (!response.ok) {
          const body = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(body?.error ?? `HTTP ${response.status}`);
        }
        const data = await response.json() as DigestResponse;
        if (!controller.signal.aborted) setView({ phase: 'ready', data, error: null });
      } catch (error) {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        setView(current => ({ phase: current.data ? 'ready' : 'error', data: current.data, error: message }));
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), DIGEST_POLL_MS);
    return () => { window.clearInterval(timer); controller.abort(); };
  }, []);
  return view;
}
