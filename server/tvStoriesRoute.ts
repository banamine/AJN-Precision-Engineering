// GET /api/tv-stories : top blended TV caption stories from the 24 h in-memory ledger.
// Read-only for the client: it never fetches Archive itself (the refresher does that in the background, politely).
import type { Express } from 'express';
import { buildStories } from './captions/storyBlend.js';
import { tvStoryLedger, tvStoryRefresher, type StoryRefresher } from './captions/storyRefresher.js';
import type { StoryLedger, StoryCard } from './captions/storyLedger.js';

export const MAX_STORIES = 12;
export const PAYLOAD_CACHE_MS = 30_000;

export interface TvStoryDto {
  storyId: string;
  coverage: number;
  networks: string[];
  sharedTerms: string[];
  firstAirUtc: string;
  lastAirUtc: string;
  lead: { network: string; sourceKind: string; programTitle: string; identifier: string; windowStartUtc: string; minutes: { clock: string; text: string }[] };
  related: { network: string; programTitle: string; windowStartUtc: string }[];
}
export interface TvStoriesPayload {
  generatedAt: string;
  window: { requestedHours: number; coveredFromUtc: string | null; coveredToUtc: string | null; building: boolean };
  networks: Array<{ code: string; network: string; sourceKind: string; status: string; reason: string; cards: number }>;
  stories: TvStoryDto[];
}

export function buildPayload(ledger: StoryLedger, refresher: StoryRefresher, nowMs: number): TvStoriesPayload {
  const cards = ledger.snapshot(nowMs);
  const byId = new Map<string, StoryCard>(cards.map((c) => [c.id, c]));
  const stories = buildStories(cards, nowMs).slice(0, MAX_STORIES).map((s): TvStoryDto => {
    const lead = byId.get(s.leadCardId)!;
    return {
      storyId: s.storyId, coverage: s.coverage, networks: s.networks, sharedTerms: s.sharedTerms, firstAirUtc: s.firstAirUtc, lastAirUtc: s.lastAirUtc,
      lead: { network: lead.network, sourceKind: lead.sourceKind, programTitle: lead.programTitle, identifier: lead.programId, windowStartUtc: lead.windowStartUtc, minutes: lead.minutes.map((m) => ({ clock: m.clock, text: m.text })) },
      related: s.cardIds.filter((id) => id !== s.leadCardId).map((id) => byId.get(id)!).filter(Boolean).slice(0, 5)
        .map((c) => ({ network: c.network, programTitle: c.programTitle, windowStartUtc: c.windowStartUtc })),
    };
  });
  return { generatedAt: new Date(nowMs).toISOString(), window: ledger.coverageWindow(nowMs), networks: refresher.networkStatuses(nowMs), stories };
}

export function registerTvStoriesRoute(app: Express, ledger: StoryLedger = tvStoryLedger, refresher: StoryRefresher = tvStoryRefresher, now: () => number = Date.now): void {
  let cache: { atMs: number; body: TvStoriesPayload } | null = null;
  app.get('/api/tv-stories', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      refresher.touch();
      const t = now();
      if (!cache || t - cache.atMs > PAYLOAD_CACHE_MS) cache = { atMs: t, body: buildPayload(ledger, refresher, t) };
      res.json(cache.body);
    } catch (e) {
      res.status(500).json({ error: String((e as Error)?.message ?? e) });
    }
  });
}
