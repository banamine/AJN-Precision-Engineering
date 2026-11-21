/**
 * Daily "Today's podcasts" edition service.
 * Built once per Denver calendar day, only after a feed refresh that STARTED at or after Denver midnight (C) has completed
 * (status "building" until then; the previous edition stays served). If that refresh has not completed by C + 10 min the edition is
 * built from the last good feed data and marked degraded with the list of stale feeds. Memoized by Denver date: a built day never changes.
 */
import { buildEdition, denverDateKey, denverMidnight, feedRevision, showRulesFromSources, type DailySourceConfig, type Edition, type FeedEpisode, type FeedInput } from '../src/utils/dailyEdition';
import { probeMp3Duration } from './mp3Duration';
import { PODCAST_SOURCES, fnv, podcastStates, refreshPodcastSource, stalenessOf, type PodcastSource, type PodcastState } from './podcasts';

export type EditionStatus = 'ok' | 'building' | 'degraded';
export interface EditionResponse {
  editionStatus: EditionStatus; degraded: boolean; staleFeeds: string[]; refreshing: boolean;
  fetchedAt: string | null; feedRevision: string | null; edition: Edition | null;
}
export interface EditionDeps {
  sources: PodcastSource[];
  refresh: (s: PodcastSource, now: Date) => Promise<PodcastState>;
  states: () => PodcastState[];
  probe: (key: string, url: string) => Promise<number | null>;
  attempts: number; attemptTimeoutMs: number; degradedAfterMs: number; probeConcurrency: number;
}
const DEFAULTS: EditionDeps = {
  sources: PODCAST_SOURCES, refresh: refreshPodcastSource, states: podcastStates, probe: (k, u) => probeMp3Duration(k, u),
  attempts: 3, attemptTimeoutMs: 30_000, degradedAfterMs: 10 * 60_000, probeConcurrency: 4,
};

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('timeout')), ms); p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); }); });
}

export function createEditionService(overrides: Partial<EditionDeps> = {}) {
  const d: EditionDeps = { ...DEFAULTS, ...overrides };
  const rules = showRulesFromSources(d.sources.filter((s) => s.enabled) as unknown as DailySourceConfig[]);
  let built: { dateKey: string; edition: Edition; revision: string; fetchedAt: string; degraded: boolean; staleFeeds: string[] } | null = null;
  let refresh: { dateKey: string; startedMs: number; done: boolean; failed: Set<string>; promise: Promise<void> } | null = null;
  const probed = new Map<string, number | null>();

  async function refreshOne(s: PodcastSource, startedMs: number, failed: Set<string>): Promise<void> {
    for (let a = 0; a < d.attempts; a++) {
      try {
        const st = await withTimeout(d.refresh(s, new Date()), d.attemptTimeoutMs);
        if (st.status === 'ok' && Date.parse(st.fetchedAt) >= startedMs) { failed.delete(s.id); return; }
      } catch { /* retry */ }
    }
    failed.add(s.id);
  }
  function startRefresh(dateKey: string, nowMs: number) {
    const failed = new Set<string>(); const list = d.sources.filter((s) => s.enabled); let i = 0;
    const r = { dateKey, startedMs: nowMs, done: false, failed, promise: Promise.resolve() };
    r.promise = Promise.all(Array.from({ length: Math.min(4, list.length) }, async () => { while (i < list.length) await refreshOne(list[i++], nowMs, failed); }))
      .then(() => { r.done = true; });
    refresh = r;
  }

  function feedsFromStates(nowMs: number): FeedInput[] {
    const byId = new Map(d.states().map((s) => [s.source.id, s]));
    return rules.map((rule) => {
      const st = byId.get(rule.id);
      if (!st) return { rule, episodes: [], loading: true };
      const seen = new Set<string>();
      const episodes: FeedEpisode[] = [];
      for (const e of st.episodes) {
        if (seen.has(e.guid)) continue; seen.add(e.guid);
        const fe: FeedEpisode = { guid: e.guid, programId: `pod-${rule.id}-${fnv(e.guid)}`, title: e.title, src: e.url, publishedMs: Number.isFinite(e.publishedAt) ? e.publishedAt : null };
        if (e.durationSeconds) { fe.durationSeconds = e.durationSeconds; fe.durationSource = 'rss'; }
        else if (probed.get(e.guid)) { fe.durationSeconds = probed.get(e.guid)!; fe.durationSource = 'probed'; }
        else fe.durationEstimated = true;
        episodes.push(fe);
      }
      const stale = stalenessOf(st, new Date(nowMs))?.stale ?? false;
      return { rule, episodes, stale, lastPublishedMs: episodes.length ? episodes[0].publishedMs : null };
    });
  }

  /** Probe real durations for episodes in the edition window whose feed gave none. Bounded, cached, SSRF-checked. */
  async function probeMissing(feeds: FeedInput[], nowMs: number): Promise<void> {
    const p2 = denverMidnight(nowMs, -2); const todo: FeedEpisode[] = [];
    for (const f of feeds) for (const e of f.episodes) if (!e.durationSeconds && e.publishedMs !== null && e.publishedMs >= p2 && e.publishedMs <= nowMs && !probed.has(e.guid)) todo.push(e);
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(d.probeConcurrency, todo.length) }, async () => { while (i < todo.length) { const e = todo[i++]; probed.set(e.guid, await d.probe(e.guid, e.src).catch(() => null)); } }));
  }

  const counts = (id: string): boolean => d.sources.find((x) => x.id === id)?.dailyMode !== 'exclude'; // excluded shows never make the edition degraded
  async function build(nowMs: number, degradedIn: boolean, staleIn: string[]) {
    const staleFeeds = staleIn.filter(counts); const degraded = degradedIn && staleFeeds.length > 0;
    let feeds = feedsFromStates(nowMs);
    await probeMissing(feeds, nowMs);
    feeds = feedsFromStates(nowMs);
    const edition = buildEdition(feeds, nowMs);
    built = { dateKey: edition.dateKey, edition, revision: feedRevision(feeds, nowMs), fetchedAt: new Date().toISOString(), degraded, staleFeeds };
  }

  /** The edition for the Denver day containing nowMs. Never throws. */
  async function get(nowMs: number = Date.now()): Promise<EditionResponse> {
    const dateKey = denverDateKey(nowMs); const C = denverMidnight(nowMs, 0);
    if (built && built.dateKey === dateKey) return respond(false);
    if (!refresh || refresh.dateKey !== dateKey) startRefresh(dateKey, Math.max(nowMs, C));
    const r = refresh!;
    if (r.done) { await build(nowMs, r.failed.size > 0, [...r.failed]); return respond(false); }
    if (nowMs - C >= d.degradedAfterMs) {
      const stale = d.sources.filter((s) => s.enabled && (!d.states().find((x) => x.source.id === s.id) || Date.parse(d.states().find((x) => x.source.id === s.id)!.fetchedAt) < C)).map((s) => s.id);
      await build(nowMs, true, stale); return respond(true);
    }
    return respond(true, 'building');
  }
  function respond(refreshing: boolean, forced?: EditionStatus): EditionResponse {
    const b = built;
    const status: EditionStatus = forced ?? (b?.degraded ? 'degraded' : 'ok');
    return { editionStatus: status, degraded: !!b?.degraded && !forced, staleFeeds: b?.staleFeeds ?? [], refreshing, fetchedAt: b?.fetchedAt ?? null, feedRevision: b?.revision ?? null, edition: b?.edition ?? null };
  }
  return { get, _reset() { built = null; refresh = null; probed.clear(); } };
}

export const editionService = createEditionService();
