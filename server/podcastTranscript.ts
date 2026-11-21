/* Episode transcript for the live captions. GET /api/podcast/transcript?url=<episode enclosure>
 *
 * The feed's <podcast:transcript> link (SRT or WebVTT) is fetched by THIS server, never by the browser: every redirect hop is host
 * checked (server/safeFetch.ts), the body is capped, and only an episode the app itself published can be asked for. The reply is
 * the parsed cues on the clean show's clock. Nothing is invented: an episode with no transcript says so (available:false) and an
 * unreadable one is a 502 with the reason. The transcript is cached briefly (6 h) and not stored anywhere else. Ads differ per
 * download, so nothing about ad positions is computed or cached here. */
import type { Express } from 'express';
import { anyPublicHost, readTextCapped, safeFetch } from './safeFetch';
import { findEpisodeByUrl } from './podcasts';
import { parseTranscript, type Cue } from '../src/utils/transcriptParse';

export const TRANSCRIPT_MAX_BYTES = 1_500_000; // real files are 25-290 KB
export interface TranscriptResponse { available: boolean; reason?: 'no-transcript' | 'empty'; cues: Cue[]; hasSpeakers: boolean; endsAt: number | null; feedSeconds: number | null }

const TTL_MS = 6 * 3600_000; const FAIL_TTL_MS = 2 * 60_000; const MAX_CACHE = 120;
const cache = new Map<string, { at: number; ok: boolean; value: TranscriptResponse | string }>();

async function episodeOf(url: string): Promise<{ found: boolean; transcriptUrl?: string; seconds: number | null }> {
  const hit = await findEpisodeByUrl(url);
  if (!hit) return { found: false, seconds: null };
  const e = hit.episode;
  return { found: true, transcriptUrl: e.transcriptUrl, seconds: Number.isFinite(e.durationSeconds) && (e.durationSeconds as number) > 0 ? (e.durationSeconds as number) : null };
}

export async function transcriptFor(url: string, fetchImpl?: typeof fetch): Promise<{ status: 200; body: TranscriptResponse } | { status: 404 | 502; error: string }> {
  const ep = await episodeOf(url);
  if (!ep.found) return { status: 404, error: 'Not a known podcast enclosure (the server has not listed this episode)' };
  if (!ep.transcriptUrl) return { status: 200, body: { available: false, reason: 'no-transcript', cues: [], hasSpeakers: false, endsAt: null, feedSeconds: ep.seconds } };
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < (hit.ok ? TTL_MS : FAIL_TTL_MS)) {
    return hit.ok ? { status: 200, body: hit.value as TranscriptResponse } : { status: 502, error: hit.value as string };
  }
  try {
    const { res } = await safeFetch(ep.transcriptUrl, { allow: anyPublicHost, timeoutMs: 15_000, maxRedirects: 5, fetchImpl, headers: { 'User-Agent': 'AJN-Precision-Engineering/1.0 (podcast captions)', Accept: 'application/x-subrip, text/vtt, text/plain, */*' } });
    if (!res.ok) { await res.body?.cancel().catch(() => {}); throw new Error(`transcript answered HTTP ${res.status}`); }
    const parsed = parseTranscript(await readTextCapped(res, TRANSCRIPT_MAX_BYTES));
    const body: TranscriptResponse = parsed.cues.length
      ? { available: true, cues: parsed.cues, hasSpeakers: parsed.hasSpeakers, endsAt: parsed.cues[parsed.cues.length - 1].e, feedSeconds: ep.seconds }
      : { available: false, reason: 'empty', cues: [], hasSpeakers: false, endsAt: null, feedSeconds: ep.seconds };
    if (cache.size >= MAX_CACHE) cache.clear();
    cache.set(url, { at: Date.now(), ok: true, value: body });
    return { status: 200, body };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (cache.size >= MAX_CACHE) cache.clear();
    cache.set(url, { at: Date.now(), ok: false, value: msg });
    return { status: 502, error: msg };
  }
}

export function registerPodcastTranscriptRoute(app: Express): void {
  app.get('/api/podcast/transcript', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const r = await transcriptFor(String(req.query.url ?? ''));
    if (r.status === 200) return res.json(r.body);
    return res.status(r.status).json({ error: r.error });
  });
}
