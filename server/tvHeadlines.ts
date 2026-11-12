// TV channel excerpts for the News Cube. Source: Internet Archive TV News details pages,
// which render one caption "snippet" per minute. Text is retained only in the bounded in-memory CaptionPool
// (age/item/byte limits, no application-level persistence). Failures are explicit `unavailable`/`stale` states;
// a failed refresh never makes older captions look newly fresh (their broadcast times are unchanged).
import type { Express } from 'express';
import { archiveApiFetch } from './archiveLimiter.js';
import { readTextCapped } from './safeFetch.js';
import { createCaptionPool } from './captions/captionPool.js';
import { pickExcerptWindow } from './captions/excerptScore.js';
import { groupStories } from './captions/storyGrouping.js';
import { isNewsProgramTitle } from './captions/programFilter.js';

export const TV_NETWORKS = [
  { network: 'FOX News', prefix: 'FOXNEWSW', collection: 'TV-FOXNEWSW' },
  { network: 'CNN', prefix: 'CNNW', collection: 'TV-CNNW' },
  { network: 'MS NOW', prefix: 'MSNOW', collection: 'TV-MSNOW' },
  { network: 'BBC News', prefix: 'BBCNEWS', collection: 'TV-BBCNEWS' },
] as const;

export type TvHeadline =
  | { network: string; state: 'ok'; programTitle: string; identifier: string; airedUtc: string; excerptMinutes: { clock: string; startSec: number; text: string }[]; stale?: boolean; staleReason?: string; lowSignal?: boolean; sameTopicAs?: string[]; sharedTerms?: string[] }
  | { network: string; state: 'unavailable'; reason: string };

const REFRESH_MS = 20 * 60_000;
const GAP_MS = 1800;
export const tvCaptionPool = createCaptionPool();
const lastOkFetch = new Map<string, number>(); // timestamps only, no text

const decode = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

export function parseIdentifier(id: string): { airedUtc: string; programTitle: string } | null {
  const m = /^[A-Z]+_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_(.+)$/.exec(id);
  if (!m) return null;
  return { airedUtc: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`, programTitle: m[7].replace(/_/g, ' ') };
}

/** Parse minute columns from an Archive TV details page. */
export function parseMinuteColumns(html: string): { clock: string; startSec: number; text: string }[] {
  const out: { clock: string; startSec: number; text: string }[] = [];
  const colRe = /<div class="tvcol[\s\S]*?(?=<div class="tvcol|$)/g;
  for (const col of html.match(colRe) ?? []) {
    const body = /<div class="snipin[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div><!--\/\.snippet-->/.exec(col);
    if (!body) continue;
    const clock = /(\d{1,2}:\d{2}\s*[ap]m)/i.exec(col)?.[1] ?? '';
    const start = /\/start\/(\d+)\/end\/\d+/.exec(col)?.[1];
    const text = decode(body[1]);
    out.push({ clock, startSec: start ? Number(start) : 0, text });
  }
  return out;
}

export function pickExcerpt(cols: { clock: string; startSec: number; text: string }[]) {
  return cols.filter((c) => c.text.length >= 40).slice(0, 2);
}

async function candidates(prefix: string, collection: string, nowMs: number): Promise<string[]> {
  const days = [0, 1].map((d) => new Date(nowMs - d * 86_400_000).toISOString().slice(0, 10).replace(/-/g, ''));
  const q = `collection:${collection} AND (${days.map((d) => `identifier:${prefix}_${d}_*`).join(' OR ')})`;
  const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier&sort[]=${encodeURIComponent('identifier desc')}&rows=14&output=json`;
  const res = await archiveApiFetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`search HTTP ${res.status}`);
  const j = JSON.parse(await readTextCapped(res, 256 * 1024));
  const ids: string[] = (j?.response?.docs ?? []).map((d: { identifier: string }) => d.identifier);
  // skip items that started <35 min ago (still airing, captions incomplete)
  return ids.filter((id) => { const p = parseIdentifier(id); return p && nowMs - Date.parse(p.airedUtc) > 35 * 60_000; });
}

// Plain shape (not a discriminated union): the repo tsconfig is not strict, so unions on `ok` would not narrow.
type FetchOutcome = { ok: boolean; reason: string };

/** Fetch the newest captioned program and ingest ALL its minute columns into the pool. */
async function refreshChannel(n: (typeof TV_NETWORKS)[number], nowMs: number): Promise<FetchOutcome> {
  try {
    const ids = await candidates(n.prefix, n.collection, nowMs);
    if (!ids.length) return { ok: false, reason: 'no completed program found' };
    // Skip non-news genres (see captions/programFilter.ts) without fetching them.
    const newsIds = ids.filter((id) => isNewsProgramTitle(parseIdentifier(id)!.programTitle));
    if (!newsIds.length) return { ok: false, reason: 'only non-news programs in the recent window' };
    // Newest items are often not caption-indexed yet; walk back up to 3 news programs until one has text.
    for (const id of newsIds.slice(0, 3)) {
      const meta = parseIdentifier(id)!;
      await new Promise((r) => setTimeout(r, GAP_MS));
      const res = await archiveApiFetch(`https://archive.org/details/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return { ok: false, reason: `details HTTP ${res.status}` };
      const cols = parseMinuteColumns(await readTextCapped(res, 3 * 1024 * 1024));
      if (!cols.length) continue;
      const startMs = Date.parse(meta.airedUtc);
      let kept = 0;
      for (const c of cols) {
        // airTime = program start (from the identifier) + Archive's own per-minute offset. Nothing is invented.
        const r = tvCaptionPool.ingest({ channel: n.prefix, programId: id, programTitle: meta.programTitle, startSec: c.startSec, clock: c.clock, airTimeMs: startMs + c.startSec * 1000, text: c.text }, nowMs);
        if (r !== 'rejected') kept++;
      }
      if (kept > 0) return { ok: true, reason: '' };
      return { ok: false, reason: 'newest captioned program is outside the 6 h retention window' };
    }
    return { ok: false, reason: 'no caption text on the 3 newest news programs' };
  } catch (e) {
    return { ok: false, reason: String((e as Error)?.message ?? e).slice(0, 120) };
  }
}

function cardFromPool(n: (typeof TV_NETWORKS)[number], nowMs: number, staleReason?: string): TvHeadline | null {
  const minutes = tvCaptionPool.newestProgram(n.prefix, 200, nowMs);
  const pick = pickExcerptWindow(minutes.map((m) => ({ clock: m.clock, startSec: m.startSec, text: m.text })), 2);
  if (!minutes.length || !pick) return null;
  const excerptMinutes = pick.minutes;
  const first = minutes[0];
  const card: TvHeadline = { network: n.network, state: 'ok', programTitle: first.programTitle, identifier: first.programId, airedUtc: new Date(first.airTimeMs - first.startSec * 1000).toISOString().replace('.000Z', 'Z'), excerptMinutes, ...(pick.lowSignal ? { lowSignal: true } : {}) };
  return staleReason ? { ...card, stale: true, staleReason } : card;
}

let inflight: Promise<TvHeadline[]> | null = null;

export async function getTvHeadlines(nowMs = Date.now()): Promise<TvHeadline[]> {
  const results: TvHeadline[] = [];
  let limited = false;
  for (const n of TV_NETWORKS) {
    if (limited) { const kept = cardFromPool(n, nowMs, 'refresh skipped: archive.org rate-limited'); results.push(kept ?? { network: n.network, state: 'unavailable', reason: 'skipped: archive.org rate-limited' }); continue; }
    const last = lastOkFetch.get(n.prefix);
    if (last !== undefined && nowMs - last < REFRESH_MS) {
      const c = cardFromPool(n, nowMs);
      if (c) { results.push(c); continue; }
    }
    const out = await refreshChannel(n, nowMs);
    if (out.ok) lastOkFetch.set(n.prefix, nowMs);
    const card = cardFromPool(n, nowMs, out.ok ? undefined : out.reason);
    results.push(card ?? { network: n.network, state: 'unavailable', reason: out.ok ? 'no usable caption text' : out.reason });
    if (!out.ok && /HTTP (429|403|503)/.test(out.reason)) limited = true;
    await new Promise((r) => setTimeout(r, GAP_MS));
  }
  return annotateSameTopic(results, nowMs);
}

/** Adds sameTopicAs/sharedTerms to cards whose excerpts look like the same story. A vocabulary match, not verification. */
function annotateSameTopic(results: TvHeadline[], nowMs: number): TvHeadline[] {
  const oks = results.filter((r): r is Extract<TvHeadline, { state: 'ok' }> => r.state === 'ok');
  if (oks.length < 2) return results;
  const { groups } = groupStories(oks.map((r) => ({ id: r.network, text: r.excerptMinutes.map((m) => m.text).join(' ') })), tvCaptionPool.texts(nowMs));
  if (!groups.length) return results;
  return results.map((r) => {
    if (r.state !== 'ok') return r;
    const g = groups.find((x) => x.members.includes(r.network));
    return g ? { ...r, sameTopicAs: g.members.filter((m) => m !== r.network), sharedTerms: g.sharedTerms } : r;
  });
}

/** Drop all retained caption text (tests, and any explicit shutdown hook). */
export function clearTvCaptionPool() { tvCaptionPool.clear(); lastOkFetch.clear(); }

export function resetTvHeadlinesForTests() { clearTvCaptionPool(); inflight = null; }

export function registerTvHeadlinesRoute(app: Express): void {
  app.get('/api/tv-headlines', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      inflight ??= getTvHeadlines().finally(() => { inflight = null; });
      res.json({ generatedAt: new Date().toISOString(), items: await inflight });
    } catch (e) {
      res.status(502).json({ error: String((e as Error)?.message ?? e) });
    }
  });
}

