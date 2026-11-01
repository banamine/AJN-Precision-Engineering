import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getScheduleForGuide, refreshCableNews, setCableNewsClockForTests, setCableNewsFetchForTests } from './guideRegistry';
import { NEWS_NETWORKS } from './server/sources/archiveNews';
import { getNewsFreshness, newsFreshnessBanner, newsTimelineLabel } from './src/guide/newsFreshness';
import { describeNewsStatus } from './src/utils/serviceStatus';

const NOW = Date.parse('2026-11-01T08:00:00.000Z');

function program(airedAt) {
  return {
    id: 'synthetic-news',
    title: 'Synthetic News',
    startTime: 0,
    endTime: 3600,
    mediaType: 'video',
    archivePath: '/download/synthetic-news/synthetic-news.mp4',
    mediaUrl: '/download/synthetic-news/synthetic-news.mp4',
    metadata: { airedUtc: airedAt },
  };
}

test('25-day news is stale and not labeled On Air Now; 10-hour news is unchanged', () => {
  const oldProgram = program(new Date(NOW - 25 * 24 * 60 * 60 * 1000).toISOString());
  const recentProgram = program(new Date(NOW - 10 * 60 * 60 * 1000).toISOString());

  assert.equal(getNewsFreshness([oldProgram], NOW).state, 'stale');
  assert.match(newsFreshnessBanner(getNewsFreshness([oldProgram], NOW)), /newer news not loaded yet/);
  assert.equal(newsTimelineLabel(oldProgram, true, NOW), 'In Rotation');

  assert.equal(getNewsFreshness([recentProgram], NOW).state, 'fresh');
  assert.equal(newsFreshnessBanner(getNewsFreshness([recentProgram], NOW)), null);
  assert.equal(newsTimelineLabel(recentProgram, true, NOW), 'On Air Now');
});

test('stale Cable TV freshness cannot be presented as News ready', () => {
  const status = describeNewsStatus({
    phase: 'ready',
    version: 4,
    newShows: [{ channelId: 'cnn', channelName: 'CNN', title: 'Synthetic', programId: 'p1' }],
    fetchedAt: new Date(NOW).toISOString(),
    latestAiredAt: new Date(NOW - 25 * 24 * 60 * 60 * 1000).toISOString(),
    staleChannelCount: 1,
    unknownChannelCount: 0,
    refreshing: false,
    checkedAt: NOW,
  }, 5, NOW);
  assert.equal(status.label, 'News stale');
  assert.equal(status.tone, 'warn');
});

test('refresh metadata is real; empty keeps last-good rows stale and timeout is explicit', async () => {
  let nowMs = NOW;
  let mode = 'current';
  const calls = [];
  const airedAt = new Date(NOW - 10 * 60 * 60 * 1000);
  const id = `CNNW_${airedAt.toISOString().slice(0, 10).replaceAll('-', '')}_${airedAt.toISOString().slice(11, 19).replaceAll(':', '')}_Synthetic_News`;

  const fetchImpl = async (input) => {
    const url = new URL(String(input));
    calls.push(url.href);
    if (url.pathname.startsWith('/metadata/')) {
      return new Response(JSON.stringify({
        metadata: { title: 'Synthetic CNN News' },
        files: [{ name: `${id}.mp4`, source: 'derivative', length: '3600' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const query = url.searchParams.get('q') ?? '';
    if (mode === 'timeout' && query.includes('collection:FOXNEWSW')) {
      throw new Error('synthetic request timeout');
    }
    if (mode === 'current' && query.includes('collection:CNNW')) {
      return new Response(JSON.stringify({
        response: { numFound: 1, docs: [{ identifier: id, title: 'Synthetic CNN News' }] },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ response: { numFound: 0, docs: [] } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };

  setCableNewsFetchForTests(fetchImpl);
  setCableNewsClockForTests(() => new Date(nowMs));
  try {
    const initial = await getScheduleForGuide('cable-tv');
    const cnnId = NEWS_NETWORKS.find(([network]) => network.includes('CNN'))?.[1];
    assert.ok(cnnId);
    const cnn = initial.find((channel) => channel.id === cnnId);
    assert.ok(cnn?.programs.length);
    assert.ok(cnn.dataFetchedAt, 'dataFetchedAt is present after a successful source response');
    assert.ok(cnn.lastRefreshAttemptAt, 'refresh attempt time is from the source runner');
    assert.equal(cnn.lastRefreshOutcome, 'ok');
    assert.ok(typeof cnn.lastRefreshMs === 'number');
    assert.equal(cnn.lastRefreshQuery, 'collection:CNNW');
    assert.equal(cnn.lastRefreshNumFound, 1);
    const originalDataFetchedAt = cnn.dataFetchedAt;

    nowMs += 49 * 60 * 60 * 1000;
    mode = 'empty';
    const emptySummary = await refreshCableNews();
    assert.equal(emptySummary.find((result) => result.network === 'CNNW')?.outcome, 'empty');
    const afterEmpty = await getScheduleForGuide('cable-tv');
    const kept = afterEmpty.find((channel) => channel.id === cnnId);
    assert.ok(kept?.programs.length, 'empty refresh retains the last-good programs');
    assert.equal(kept.sourceStatus, 'stale');
    assert.equal(kept.lastRefreshOutcome, 'empty');
    assert.equal(kept.dataFetchedAt, originalDataFetchedAt);
    assert.ok(Date.parse(kept.lastRefreshAttemptAt) > Date.parse(originalDataFetchedAt));
    assert.equal(getNewsFreshness(kept.programs, nowMs).state, 'stale');

    mode = 'timeout';
    const timeoutSummary = await refreshCableNews();
    assert.equal(timeoutSummary.find((result) => result.network === 'FOXNEWSW')?.outcome, 'timeout');
    const afterTimeout = await getScheduleForGuide('cable-tv');
    const foxId = NEWS_NETWORKS.find(([network]) => network.includes('FOX'))?.[1];
    const fox = afterTimeout.find((channel) => channel.id === foxId);
    assert.equal(fox?.lastRefreshOutcome, 'timeout');
    assert.ok(calls.every((requestUrl) => new URL(requestUrl).hostname === 'archive.org'), 'all Archive-shaped requests were intercepted by the in-memory fetch');
  } finally {
    setCableNewsFetchForTests(undefined);
    setCableNewsClockForTests(undefined);
  }
});
