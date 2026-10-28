import assert from 'node:assert/strict';
import {
  createInfowarsRadioStore, INFOWARS_COLLECTION, INFOWARS_WINDOW_SECONDS,
  infowarsSeedIndex, parseInfowarsUtcId, sortInfowarsIds,
} from './server/infowarsRadio.ts';

const ids = [
  'The_Alex_Jones_Radio_Show_20240101_000000',
  'The_Alex_Jones_Radio_Show_20240230_000000',
  'The_Alex_Jones_Radio_Show_20240203_140000',
];
assert.equal(parseInfowarsUtcId(ids[0]), Date.UTC(2024, 0, 1));
assert.equal(parseInfowarsUtcId(ids[1]), null, 'invalid UTC calendar date is rejected');
assert.deepEqual(sortInfowarsIds(ids), [ids[0], ids[2], ids[1]], 'invalid dates sort after valid dates by name');
for (const day of ['2026-10-20', '2026-10-21']) {
  assert.equal(infowarsSeedIndex(ids, day), infowarsSeedIndex(ids, day), 'same day has a stable seed index');
}

let searchCount = 0;
const metadataCalls: string[] = [];
const fetchImpl: typeof fetch = async (input) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.pathname.endsWith('/advancedsearch.php')) {
    searchCount++;
    assert.equal(url.searchParams.get('q'), `collection:${INFOWARS_COLLECTION}`);
    assert.equal(url.searchParams.get('fl[]'), 'identifier');
    assert.equal(url.searchParams.get('sort[]'), 'identifier asc');
    assert.equal(url.searchParams.get('rows'), '10000');
    return new Response(JSON.stringify({ response: { numFound: ids.length, docs: ids.map((identifier) => ({ identifier })) } }), { status: 200 });
  }
  const id = decodeURIComponent(url.pathname.split('/').pop() ?? '');
  metadataCalls.push(id);
  const files = id === ids[0]
    ? [{ name: 'private.m4a', private: 'true', length: '10800', source: 'original' }]
    : id === ids[2]
      ? [{ name: 'zero.m4a', length: '0', source: 'original' }]
      : [{ name: 'good.m4a', length: '10800', source: 'original' }, { name: 'fallback.aac', length: '10800', source: 'original' }];
  return new Response(JSON.stringify({ metadata: {}, files }), { status: 200 });
};

const store = createInfowarsRadioStore({ fetchImpl, cacheDir: null, now: () => Date.UTC(2026, 10, 20) });
const snapshot = await store.getCandidateSnapshot();
assert.equal(snapshot.numFound, 3);
assert.equal(snapshot.pages, 1);
assert.equal(searchCount, 1);
const lineup = await store.buildChannel('audio-podcasts', new Date('2026-10-20T12:00:00Z'));
const diagnostics = store.getDiagnostics();
assert.ok(lineup.length >= 1);
assert.ok(lineup.every((p) => p.channelId === 'archive-infowars-radio' && p.sourceId?.startsWith('The_Alex_Jones_Radio_Show_')));
assert.ok(lineup.every((p) => p.archivePath?.startsWith('/download/') && Number(p.metadata?.durationSeconds) === 10800));
assert.equal(diagnostics.skippedCount, 2);
assert.equal(diagnostics.skippedByReason.audio_private_only, 1);
assert.equal(diagnostics.skippedByReason.audio_length_zero_or_missing, 1);
assert.equal(diagnostics.windowSeconds, INFOWARS_WINDOW_SECONDS);
assert.equal(metadataCalls.length, 3);
assert.ok(diagnostics.metadataRequests <= 12);
console.log('infowars radio offline resolver, UTC sorting, daily seed and skip diagnostics: all passed');
