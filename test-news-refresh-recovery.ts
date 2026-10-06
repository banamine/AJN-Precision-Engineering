// S2 regression: the cable-news refresh must recover from slow/hung Archive requests,
// retry failed networks, and never show news older than 48 h as current.
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { archiveNewsContract } from './server/sources/archiveNews.ts';
import { runSources } from './server/sources/runner.ts';
import type { SourceContract } from './server/sources/contract.ts';
import { getScheduleForGuide, setCableNewsFetchForTests, refreshCableNews, newsRetryStateForTests } from './guideRegistry.ts';

// AbortSignal.timeout() timers are unref'd, so a pending hang would let the process exit early; keep the loop alive.
const keepAlive = setInterval(() => {}, 1000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stamp = (hoursAgo: number, base = Date.now()) => {
  const d = new Date(base - hoursAgo * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}_${p(d.getUTCHours())}0000`;
};
const hang = (init: any) => new Promise<Response>((_, reject) => {
  init.signal.addEventListener('abort', () => reject(init.signal.reason ?? new DOMException('aborted', 'AbortError')), { once: true });
});
const json = (status: number, body?: unknown) => new Response(body ? JSON.stringify(body) : '', { status });
const metaOk = (id: string) => json(200, { metadata: { title: `Show ${id}` }, files: [{ name: `${id}.mp4`, source: 'derivative', length: '3600' }] });

type Behavior = 'ok' | 'hang' | number;
/** Fetch stub for the FOXNEWSW network only; other networks return empty search results. */
function foxFetch(opts: { ids: string[]; search?: () => Behavior; meta?: (id: string) => Behavior; calls?: { search: Record<string, number> } }): typeof fetch {
  return (async (input: any, init: any) => {
    const url = decodeURIComponent(String(input));
    if (url.includes('advancedsearch')) {
      const net = /collection:([A-Z]+) /.exec(url)?.[1] ?? 'other';
      if (opts.calls) opts.calls.search[net] = (opts.calls.search[net] ?? 0) + 1;
      if (net !== 'FOXNEWSW') return json(200, { response: { docs: [] } });
      const b = opts.search?.() ?? 'ok';
      if (b === 'hang') return hang(init);
      if (typeof b === 'number') return json(b);
      return json(200, { response: { docs: opts.ids.map((identifier) => ({ identifier })) } });
    }
    const id = /metadata\/([^/?]+)/.exec(url)?.[1] ?? '';
    const b = opts.meta?.(id) ?? 'ok';
    if (b === 'hang') return hang(init);
    if (typeof b === 'number') return json(b);
    return metaOk(id);
  }) as typeof fetch;
}
const ctx = (signal = new AbortController().signal) => ({ now: new Date(), signal });
const input = (fetchImpl: typeof fetch, extra: object = {}) => ({ network: 'FOXNEWSW', channelId: 'fox-news', channelName: 'Fox News', guideId: 'cable-tv', windowDays: 2, rows: 12, fetchImpl, ...extra });

// ── 1. One hung metadata request: the others still arrive, status partial ─────────────
{
  const a = `FOXNEWSW_${stamp(5)}_Show_A`, b = `FOXNEWSW_${stamp(6)}_Show_B`, c = `FOXNEWSW_${stamp(7)}_Show_C`;
  const t = Date.now();
  const r = await archiveNewsContract.hook(input(foxFetch({ ids: [a, b, c], meta: (id) => (id === b ? 'hang' : 'ok') }), { requestTimeoutMs: 150 }), ctx());
  assert.ok(Date.now() - t < 3000, 'a hung request is cut at its own timeout, not at the outer deadline');
  assert.equal(r.status, 'partial');
  assert.equal(r.programs.length, 2, 'the two good items survive');
  assert.deepEqual(r.rejected.map((x) => [x.id, x.reason]), [[b, 'metadata timeout']]);
  console.log('PASS hung metadata request -> partial');
}

// ── 2. The metadata budget is real: in-flight requests are cancelled at the deadline ──
{
  const ids = [1, 2, 3, 4].map((n) => `FOXNEWSW_${stamp(n + 4)}_Show_${n}`);
  const t = Date.now();
  const r = await archiveNewsContract.hook(input(foxFetch({ ids, meta: () => 'hang' }), { requestTimeoutMs: 60_000, metadataBudgetMs: 200 }), ctx());
  assert.ok(Date.now() - t < 2500, 'returns at the budget, not after 60 s');
  assert.equal(r.status, 'partial');
  assert.equal(r.programs.length, 0);
  assert.ok(r.rejected.length === 4 && r.rejected.every((x) => x.reason === 'skipped: metadata time budget used'), JSON.stringify(r.rejected));
  console.log('PASS metadata budget cancels in-flight requests');
}

// ── 3. A hung search is an explicit upstream_error, not a silent empty channel ───────
{
  const r = await archiveNewsContract.hook(input(foxFetch({ ids: [], search: () => 'hang' }), { requestTimeoutMs: 100 }), ctx());
  assert.equal(r.status, 'upstream_error');
  assert.match(r.error ?? '', /advancedsearch timed out after 100ms/);
  console.log('PASS hung search -> upstream_error');
}

// ── 4. Runner: abort returns partial results; a hook that ignores the signal is still offline ──
{
  const partialHook: SourceContract<null> = {
    sourceClass: 'archive_news', priority: 3,
    async hook(_i, c) {
      await new Promise((r) => c.signal.addEventListener('abort', r, { once: true }));
      return { sourceClass: 'archive_news', status: 'ok', programs: [{ id: 'p1' } as any], rejected: [], fetchedAt: c.now.toISOString() };
    },
  };
  const stubborn: SourceContract<null> = { sourceClass: 'archive_news', priority: 3, hook: () => new Promise(() => {}) };
  const [p] = await runSources([{ contract: partialHook, input: null }], { timeoutMs: 100, graceMs: 500 });
  assert.equal(p.status, 'partial');
  assert.equal(p.programs.length, 1, 'collected programs are kept on abort');
  assert.match(p.error ?? '', /timed out after 100ms/);
  const [s] = await runSources([{ contract: stubborn, input: null }], { timeoutMs: 100, graceMs: 50 });
  assert.equal(s.status, 'offline');
  assert.match(s.error ?? '', /timed out after 100ms/);
  console.log('PASS runner partial-on-abort');
}

// ── 5. Registry: a network that hits the 90 s (here 300 ms) budget keeps what it gathered ──
{
  const good = `FOXNEWSW_${stamp(5)}_Good`, slow = `FOXNEWSW_${stamp(6)}_Slow`;
  setCableNewsFetchForTests(foxFetch({ ids: [good, slow], meta: (id) => (id === slow ? 'hang' : 'ok') }), { networkTimeoutMs: 300, requestTimeoutMs: 60_000, retryMs: 3_600_000 });
  const fox = (await getScheduleForGuide('cable-tv')).find((c) => c.id === 'fox-news')!;
  assert.equal(fox.sourceStatus, 'partial');
  assert.match(fox.sourceError ?? '', /timed out after 300ms/);
  assert.ok(fox.programs.some((p) => p.title === `Show ${good}`), 'items gathered before the timeout are shown');
  console.log('PASS network timeout keeps gathered items');
}

// ── 6. 48 h bound by real air time; older shows stay playable only when nothing newer exists ──
{
  const t0 = Date.now();
  mock.timers.enable({ apis: ['Date'], now: t0 });
  try {
    const young = `FOXNEWSW_${stamp(20, t0)}_Young`, old = `FOXNEWSW_${stamp(46, t0)}_Old`;
    setCableNewsFetchForTests(foxFetch({ ids: [young, old] }), { retryMs: 3_600_000 });
    const titles = async () => {
      const fox = (await getScheduleForGuide('cable-tv')).find((c) => c.id === 'fox-news')!;
      return { fox, titles: new Set(fox.programs.map((p) => p.title)) };
    };
    let r = await titles();
    assert.deepEqual([...r.titles].sort(), [`Show ${old}`, `Show ${young}`].sort(), 'both shows are inside 48 h at first');
    mock.timers.setTime(t0 + 5 * 3600_000); // Old is now 51 h, Young 25 h
    r = await titles();
    assert.deepEqual([...r.titles], [`Show ${young}`], 'a show older than 48 h is dropped once something newer exists');
    mock.timers.setTime(t0 + 40 * 3600_000); // Young is now 60 h: nothing is inside 48 h
    r = await titles();
    assert.deepEqual([...r.titles].sort(), [`Show ${old}`, `Show ${young}`].sort(), 'cold-start behaviour: the older shows stay visible and playable, not an empty channel');
    assert.ok(r.fox.programs.length > 0);
    assert.equal(r.fox.sourceStatus, 'stale', 'but it is explicitly marked stale');
    assert.match(r.fox.sourceError ?? '', /^Showing older recordings \(latest aired \d{4}-\d{2}-\d{2}T[^)]*more than 48 h ago\); newer news will be announced when ready/);
  } finally { mock.timers.reset(); }
  console.log('PASS 48 h bound');
}

// ── 7. A failed network is retried alone, then replaced when the retry succeeds ───────
{
  let foxFails = true;
  const calls = { search: {} as Record<string, number> };
  const id = `FOXNEWSW_${stamp(5)}_Retry`;
  setCableNewsFetchForTests(foxFetch({ ids: [id], search: () => (foxFails ? 503 : 'ok'), calls }), { retryMs: 60 });
  let fox = (await getScheduleForGuide('cable-tv')).find((c) => c.id === 'fox-news')!;
  assert.equal(fox.sourceStatus, 'upstream_error');
  assert.deepEqual(newsRetryStateForTests(), { retries: 1, scheduled: true });
  const cnnBefore = calls.search['CNNW'];
  foxFails = false;
  await sleep(500);
  fox = (await getScheduleForGuide('cable-tv')).find((c) => c.id === 'fox-news')!;
  assert.equal(fox.sourceStatus, 'ok', 'the retry replaced the failed result');
  assert.ok(fox.programs.length > 0);
  assert.equal(calls.search['CNNW'], cnnBefore, 'only the failed network was retried');
  assert.equal(newsRetryStateForTests().retries, 0, 'a healthy refresh resets the retry counter');
  console.log('PASS retry replaces failed network');
}

// ── 8. Retries are bounded (5), then it waits for the next 6 h tick ───────────────────
{
  setCableNewsFetchForTests(foxFetch({ ids: [], search: () => 503 }), { retryMs: 20 });
  await getScheduleForGuide('cable-tv');
  await sleep(900);
  assert.deepEqual(newsRetryStateForTests(), { retries: 5, scheduled: false });
  console.log('PASS retries bounded at 5');
}

setCableNewsFetchForTests(undefined);
clearInterval(keepAlive);
console.log('news refresh recovery regression: all passed');
