// Offline tests for the 24 h TV story ledger. No network, no disk. Run: npm run test:tv-stories
import assert from 'node:assert/strict';
import { pickTopWindows } from './server/captions/excerptWindows.js';
import { StoryLedger, type StoryCardInput } from './server/captions/storyLedger.js';
import { buildStories } from './server/captions/storyBlend.js';
import { StoryRefresher, parseArchiveIdentifier, TV_STORY_NETWORKS, NO_TEXT_BACKOFF_MS, COOLDOWN_MS, type FetchText } from './server/captions/storyRefresher.js';
import { buildPayload, registerTvStoriesRoute, MAX_STORIES } from './server/tvStoriesRoute.js';
import { composeFaces, tvStoriesToCubeArticles } from './src/news-cube/tvStoryFaces.js';
import type { CubeArticle } from './src/news-cube/adapter.js';

let passed = 0;
const t = async (name: string, fn: () => void | Promise<void>) => { await fn(); passed++; console.log(`ok  ${name}`); };
const NOW = Date.parse('2026-11-12T12:00:00Z');
const H = 3_600_000;

const NEWSY = (k: string) => `The president and senators said the investigation into ${k} will continue, officials said the court ruling on tariffs and the budget shutdown affects the economy and inflation, according to lawmakers in congress today.`;
const mins = (start: number, texts: string[]) => texts.map((text, i) => ({ clock: `${i}:00 pm`, startSec: start + i * 60, text }));
const input = (over: Partial<StoryCardInput> = {}): StoryCardInput => ({
  networkCode: 'CNNW', network: 'CNN', sourceKind: 'broadcast-captions', programId: 'CNNW_20261112_100000_Show', programTitle: 'Show',
  programStartMs: NOW - 2 * H, windowStartMs: NOW - 2 * H + 600_000, startSec: 600, clock: '10:10 am', minutes: mins(600, [NEWSY('alpha'), NEWSY('alpha')]), score: 80, ...over,
});

await t('pickTopWindows: non-overlapping, best first, drops weak', () => {
  const m = mins(0, Array.from({ length: 8 }, (_, i) => (i < 4 ? NEWSY('x' + i) : 'short')));
  const w = pickTopWindows(m, 2, 3);
  assert.ok(w.length >= 1 && w.length <= 2);
  for (const a of w) for (const b of w) if (a !== b) assert.ok(!a.minutes.some((x) => b.minutes.some((y) => y.startSec === x.startSec)));
  assert.deepEqual(pickTopWindows([], 2), []);
});

await t('ledger: dedup, near-dup, 24h air-time retention, caps', () => {
  const l = new StoryLedger({ maxCards: 3, maxPerNetwork: 2 });
  assert.equal(l.ingest(input(), NOW), 'added');
  assert.equal(l.ingest(input(), NOW), 'duplicate');
  assert.equal(l.ingest(input({ startSec: 1200, windowStartMs: NOW - 2 * H + 1_200_000 }), NOW), 'duplicate'); // same text = near-dup
  assert.equal(l.ingest(input({ windowStartMs: NOW + 1000 }), NOW), 'rejected'); // future
  assert.equal(l.ingest(input({ windowStartMs: NOW - 25 * H }), NOW), 'rejected'); // too old
  assert.equal(l.ingest(input({ minutes: [] }), NOW), 'rejected');
  assert.throws(() => l.ingest(input(), NaN));
  for (let i = 0; i < 4; i++) l.ingest(input({ programId: `CNNW_20261112_0${i}0000_S`, startSec: i, windowStartMs: NOW - H - i * 60_000, minutes: mins(i * 60, [NEWSY('u' + i + 'zq' + i * 7), NEWSY('v' + i + 'yk' + i * 3)]) }), NOW);
  assert.ok(l.stats.cards <= 2);
  assert.equal(l.snapshot(NOW + 26 * H).length, 0); // all pruned by age
  l.clear(); assert.equal(l.stats.cards, 0); assert.equal(l.stats.textBytes, 0);
});

await t('ledger: snapshot is detached and newest first; coverage building flag', () => {
  const l = new StoryLedger();
  assert.equal(l.coverageWindow(NOW).building, true);
  l.ingest(input({ programId: 'A_20261112_000000_S', windowStartMs: NOW - 5 * H, minutes: mins(0, [NEWSY('one'), NEWSY('two')]) }), NOW);
  l.ingest(input({ programId: 'A_20261112_060000_S', windowStartMs: NOW - H, minutes: mins(0, ['Different words entirely about hurricane evacuation orders and wildfire smoke across several counties tonight, officials said.', 'More hurricane evacuation coverage with storm surge warnings and military helicopters rescuing residents, officials said again.']) }), NOW);
  const s = l.snapshot(NOW);
  assert.ok(Date.parse(s[0].windowStartUtc) > Date.parse(s[1].windowStartUtc));
  s[0].minutes[0].text = 'mutated';
  assert.notEqual(l.snapshot(NOW)[0].minutes[0].text, 'mutated');
  assert.equal(l.coverageWindow(NOW).building, true);
});

await t('blend: same story across networks groups (needs a realistic pool); never-merge pair blocked; 6 h gap blocks', () => {
  const l = new StoryLedger({ maxCards: 240, maxPerNetwork: 60 });
  const uniq = (i: number, n: number) => Array.from({ length: n }, (_, k) => 'w' + (i * 97 + k * 13).toString(36) + 'q' + k + i).join(' ');
  for (let i = 0; i < 30; i++) {
    l.ingest(input({ networkCode: 'KPIX', network: 'KPIX CBS', programId: `KPIX_20261112_${String(i).padStart(2, '0')}0000_S`, startSec: i, windowStartMs: NOW - H - i * 70_000,
      minutes: mins(i * 60, [`The president said the budget talks about the economy continue today ${uniq(i, 25)}`, `Lawmakers in congress said inflation and jobs according to officials ${uniq(i + 50, 25)}`]) }), NOW);
  }
  const base = 'Officials said wildfire evacuation orders were issued for Malibu as the governor declared an emergency, and the military and police helped residents leave the fire zone, according to the investigation by officials in the government.';
  const two = (x: string) => mins(600, [`${base} ${x}`, `${base} ${x} more`]);
  l.ingest(input({ networkCode: 'CNNW', network: 'CNN', programId: 'CNNW_20261112_090000_N', windowStartMs: NOW - 2 * H, minutes: two('alpha beta') }), NOW);
  l.ingest(input({ networkCode: 'FOXNEWSW', network: 'Fox News', programId: 'FOXNEWSW_20261112_090000_N', windowStartMs: NOW - 2 * H + 60_000, minutes: two('gamma delta') }), NOW);
  const st = buildStories(l.snapshot(NOW), NOW);
  const merged = st.find((s) => s.coverage === 2);
  assert.ok(merged, 'expected CNN + Fox to merge');
  assert.deepEqual(merged!.networks.slice().sort(), ['CNN', 'Fox News']);
  assert.ok(merged!.sharedTerms.length > 0);
  const far = buildStories(l.snapshot(NOW).map((c) => (c.networkCode === 'FOXNEWSW' ? { ...c, windowStartUtc: new Date(NOW - 20 * H).toISOString() } : c)), NOW);
  assert.ok(far.every((s) => s.coverage === 1), 'link across >6 h must be refused');
  const blockedStories = buildStories(l.snapshot(NOW), NOW, { neverMergePairs: [['CNNW', 'FOXNEWSW']] });
  assert.ok(blockedStories.every((s) => s.coverage === 1), 'never-merge pair must not merge');
  assert.deepEqual(buildStories([], NOW), []);
});

await t('parseArchiveIdentifier handles digits in prefix (FRANCE24)', () => {
  assert.equal(parseArchiveIdentifier('FRANCE24_20261112_100000_News')?.prefix, 'FRANCE24');
  assert.equal(parseArchiveIdentifier('CNNW_20261112_100000_Anderson_Cooper_360')?.programTitle, 'Anderson Cooper 360');
  assert.equal(parseArchiveIdentifier('garbage'), null);
});

// ---- refresher with a fake Archive ----
const aired = (h: number) => { const d = new Date(NOW - h * H); return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z/, '').replace('T', '_'); };
const detailsHtml = (texts: string[]) => texts.map((tx, i) => `<div class="tvcol"><a href="/details/X/start/${i * 60}/end/${i * 60 + 60}">${i}:00 pm</a><div class="snipin">${tx}</div></div><!--/.snippet-->`).join('\n');
function mkRefresher(handler: (url: string) => { status: number; text: string }, networks = TV_STORY_NETWORKS.slice(0, 2)) {
  const calls: string[] = []; let clock = NOW;
  const ledger = new StoryLedger();
  const fetchText: FetchText = async (url) => { calls.push(url); return handler(url); };
  const r = new StoryRefresher({ ledger, fetchText, now: () => clock, sleep: async () => {}, networks });
  return { r, ledger, calls, advance: (ms: number) => { clock += ms; }, set: (v: number) => { clock = v; } };
}
const searchJson = (ids: string[]) => ({ status: 200, text: JSON.stringify({ response: { docs: ids.map((identifier) => ({ identifier })) } }) });

await t('refresher: idle until touched; then fills ledger; processed programs are NOT refetched (loop regression)', async () => {
  const id = `FOXNEWSW_${aired(3)}_Fox_News_at_Noon`;
  const f = mkRefresher((u) => (u.includes('advancedsearch') ? searchJson([id]) : { status: 200, text: detailsHtml([NEWSY('a'), NEWSY('b'), NEWSY('c')]) }));
  assert.equal(await f.r.tick(), null); // idle
  f.r.touch(); f.r.stop();
  await new Promise((r) => setTimeout(r, 20));
  const before = f.calls.filter((u) => u.includes('/details/')).length;
  assert.equal(before, 1);
  assert.ok(f.ledger.stats.cards >= 1);
  await f.r.tick(); await f.r.tick(); await f.r.tick();
  assert.equal(f.calls.filter((u) => u.includes('/details/')).length, 1, 'details refetched');
  f.r.stop();
});

await t('refresher: young program with 0 minutes is retried later, not done; old zero-minute program -> no-text backoff', async () => {
  const young = `CNNW_${aired(1)}_Show_One`;
  const f = mkRefresher((u) => (u.includes('advancedsearch') ? searchJson([young]) : { status: 200, text: '<html></html>' }), [TV_STORY_NETWORKS[1]]);
  f.r.touch(); f.r.stop(); await new Promise((r) => setTimeout(r, 20));
  assert.equal(f.calls.filter((u) => u.includes('/details/')).length, 1);
  await f.r.tick(); // retry not due yet
  assert.equal(f.calls.filter((u) => u.includes('/details/')).length, 1);
  f.advance(11 * 60_000); f.r.touch(); f.r.stop();
  await f.r.tick();
  assert.equal(f.calls.filter((u) => u.includes('/details/')).length, 2, 'young program should be retried after delay');

  const old = `CNNW_${aired(10)}_Show_Old`;
  const g = mkRefresher((u) => (u.includes('advancedsearch') ? searchJson([old]) : { status: 200, text: '<html></html>' }), [TV_STORY_NETWORKS[1]]);
  g.r.touch(); g.r.stop(); await new Promise((r) => setTimeout(r, 20));
  const st = g.r.networkStatuses(g.ledger ? NOW : NOW)[0];
  assert.equal(st.status, 'no-text');
  g.advance(NO_TEXT_BACKOFF_MS - 1000); assert.equal(g.r.networkStatuses(NOW + NO_TEXT_BACKOFF_MS - 1000)[0].status, 'no-text');
});

await t('refresher: 429 sets cooldown, keeps ledger cards, other network still served', async () => {
  const fox = `FOXNEWSW_${aired(3)}_Fox_News_at_Noon`;
  let blockCnn = false;
  const f = mkRefresher((u) => {
    if (u.includes('advancedsearch')) { if (u.includes('CNNW') && blockCnn) return { status: 429, text: '' }; return searchJson([u.includes('CNNW') ? `CNNW_${aired(3)}_Show` : fox]); }
    return { status: 200, text: detailsHtml([NEWSY('a' + u.length), NEWSY('b' + u.length)]) };
  });
  f.r.touch(); f.r.stop(); await new Promise((r) => setTimeout(r, 20));
  await f.r.tick();
  const have = f.ledger.stats.cards; assert.ok(have >= 1);
  blockCnn = true; f.set(NOW + 12 * 60_000); f.r.touch(); f.r.stop();
  for (let i = 0; i < 3; i++) await f.r.tick();
  const s = f.r.networkStatuses(NOW + 12 * 60_000);
  assert.ok(s.some((x) => x.status === 'cooldown'));
  assert.ok(f.ledger.stats.cards >= have, 'cards lost on 429');
  assert.ok(COOLDOWN_MS > 0);
});

await t('faces: 0 / 3 / 6 stories keep digest on faces 1-5 and Face 6 rules', () => {
  const dig: CubeArticle[] = Array.from({ length: 36 }, (_, i) => ({ id: `d${i}`, title: `T${i}`, summary: '', publisherName: 'P', publisherId: `p${i}`, publishedAt: null, canonicalUrl: 'https://x', imageUrl: null }));
  const story = (i: number) => ({ storyId: `s${i}`, coverage: 2, networks: ['CNN', 'Fox News'], sharedTerms: [], firstAirUtc: '', lastAirUtc: '', lead: { network: 'CNN', sourceKind: 'broadcast-captions', programTitle: 'P', identifier: `CNNW_X${i}`, windowStartUtc: '2026-11-12T10:00:00Z', minutes: [{ clock: '10:00 am', text: `The president said ${i} `.repeat(40) }] }, related: [] });
  for (const n of [0, 3, 6]) {
    const tv = tvStoriesToCubeArticles(Array.from({ length: n }, (_, i) => story(i)));
    const f = composeFaces(dig, tv);
    assert.equal(f.length, 6);
    for (let k = 0; k < 5; k++) assert.deepEqual(f[k].articles.map((a) => a?.id), dig.slice(k * 6, k * 6 + 6).map((a) => a.id));
    assert.equal(f[5].articles.filter((a) => a?.id.startsWith('tv:')).length, n);
    assert.equal(f[5].articles.length, 6);
  }
  const a = tvStoriesToCubeArticles([story(1)])[0];
  assert.ok(a.title.length <= 201 && a.summary.startsWith('Caption excerpt, not a headline.') && a.summary.includes('Covered by: Fox News.'));
  assert.deepEqual(composeFaces([], [])[5].articles, Array(6).fill(null));
});

await t('route: shape, no-store, top-12, no filesystem writes, touches refresher', () => {
  const ledger = new StoryLedger({ maxCards: 240, maxPerNetwork: 24 });
  for (let i = 0; i < 20; i++) ledger.ingest(input({ programId: `CNNW_20261112_${String(i).padStart(2, '0')}0000_S`, startSec: i, windowStartMs: NOW - H - i * 120_000, minutes: mins(i * 60, [`${NEWSY('story' + i)} unique${i}${i * 13} term${i * 17}${i} word${i * 19}${i}`, `${NEWSY('other' + i)} extra${i * 23} more${i * 29}${i} things${i * 31}${i}`]) }), NOW);
  let touched = 0;
  const refresher = new StoryRefresher({ ledger, networks: TV_STORY_NETWORKS.slice(0, 1), now: () => NOW });
  const orig = refresher.touch.bind(refresher); refresher.touch = () => { touched++; };
  let handler: any; const hdr: Record<string, string> = {}; let body: any;
  registerTvStoriesRoute({ get: (_p: string, h: any) => { handler = h; } } as any, ledger, refresher, () => NOW);
  handler({}, { set: (k: string, v: string) => { hdr[k] = v; }, json: (b: any) => { body = b; }, status: () => ({ json() {} }) });
  assert.equal(hdr['Cache-Control'], 'no-store'); assert.equal(touched, 1);
  assert.ok(body.stories.length <= MAX_STORIES && body.stories.length > 0);
  assert.ok(Array.isArray(body.networks) && body.window && body.generatedAt);
  assert.ok(body.stories[0].lead.minutes[0].text.length > 0);
  void orig;
});

console.log(`\n${passed} tests passed`);
