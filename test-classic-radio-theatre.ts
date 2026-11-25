import assert from 'node:assert/strict';
import { classicRadioEmptyMessage } from './src/components/ClassicRadioTheatreShelf';
import {
  buildClassicRadioArchiveQuery,
  CLASSIC_RADIO_PAGE_MAX,
  createClassicRadioService,
  dedupeAndMarkClassicRadioAlternates,
  findClassicRadioShow,
  getClassicRadioGenres,
  normalizeClassicRadioAlias,
  selectPublicAudioPath,
  type ClassicRadioResult,
} from './server/classicRadioTheatre';

function response(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function archiveUrl(input: RequestInfo | URL): URL {
  return new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
}

async function run() {
  assert.equal(normalizeClassicRadioAlias('  LUX Radio-Theater! '), 'lux radio theater');
  assert.equal(findClassicRadioShow('Lux Radio Theater')?.id, findClassicRadioShow('Lux Radio Theatre')?.id);
  assert.equal(findClassicRadioShow('The Mercury Theater on the Air')?.id, 'mercury');

  const groups = getClassicRadioGenres();
  assert.equal(groups.length, 4);
  assert.equal(groups.reduce((n, group) => n + group.shows.length, 0), 17);
  assert.equal(groups.reduce((n, group) => n + group.shows.filter((show) => !show.measured).length, 0), 6);

  const lux = findClassicRadioShow('lux theater');
  assert.ok(lux);
  const query = buildClassicRadioArchiveQuery(lux, '1954-04-05');
  assert.match(query, /mediatype:audio/);
  assert.match(query, /date:/);
  assert.match(query, /collection:/);

  assert.equal(
    selectPublicAudioPath('show_1', [
      { name: 'private.mp3', private: 'true', size: '100' },
      { name: 'photo.jpg', size: '100' },
      { name: 'episode.ogg', size: '100' },
      { name: 'episode.mp3', size: '200' },
    ]),
    '/download/show_1/episode.mp3',
  );
  assert.equal(selectPublicAudioPath('show_1', [{ name: 'locked.mp3', private: true, size: '100' }]), null);
  assert.equal(selectPublicAudioPath('show_1', [{ name: '../outside.mp3', size: '100' }]), null);

  const base = (identifier: string, title: string, date: string | null, path = `/download/${identifier}/a.mp3`): ClassicRadioResult => ({
    showId: 'dimension-x',
    genre: 'sci-fi',
    identifier,
    title,
    creator: null,
    date,
    path,
    mediaType: 'audio',
  });
  const deduped = dedupeAndMarkClassicRadioAlternates([
    base('item-a', 'The Pilot!', '1950-01-02'),
    base('item-a', 'The Pilot!', '1950-01-02', '/download/item-a/b.mp3'),
    base('item-b', 'Pilot', '1950-01-02'),
    base('item-c', 'Pilot', null),
  ]);
  assert.equal(deduped.length, 3);
  assert.ok(deduped[0].alternateGroup);
  assert.equal(deduped[0].alternateGroup, deduped[1].alternateGroup);
  assert.equal(deduped[2].alternateGroup, undefined);

  let fixtureFetchCalls = 0;
  let lastRows = '';
  const fixtureService = createClassicRadioService({
    fetchImpl: async (input) => {
      fixtureFetchCalls += 1;
      const url = archiveUrl(input);
      if (url.pathname.endsWith('/advancedsearch.php')) {
        lastRows = url.searchParams.get('rows') ?? '';
        return response({
          response: {
            numFound: 1,
            docs: [{ identifier: 'fixture-item', title: 'Fixture episode', creator: 'Fixture creator', date: '1955-01-02', mediatype: 'audio' }],
          },
        });
      }
      if (url.pathname === '/metadata/fixture-item') {
        return response({
          metadata: { mediatype: 'audio' },
          files: [{ name: 'fixture.mp3', size: '1000' }, { name: 'hidden.asr.srt', size: '20', private: true }],
        });
      }
      throw new Error('Unexpected fixture route');
    },
    now: () => 1000,
  });
  const first = await fixtureService.search({ show: 'dimension-x', limit: 1 });
  assert.equal(first.results.length, 1);
  assert.equal(first.results[0].path, '/download/fixture-item/fixture.mp3');
  await fixtureService.search({ show: 'dimension-x', limit: 1 });
  assert.equal(fixtureFetchCalls, 2);
  assert.equal(lastRows, '1');

  const privateService = createClassicRadioService({
    fetchImpl: async (input) => {
      const url = archiveUrl(input);
      if (url.pathname.endsWith('/advancedsearch.php')) {
        return response({ response: { numFound: 1, docs: [{ identifier: 'private-item', title: 'Private', mediatype: 'audio' }] } });
      }
      return response({ metadata: { mediatype: 'audio', private: 'true' }, files: [{ name: 'private.mp3', size: '100' }] });
    },
  });
  const privateResult = await privateService.search({ show: 'dimension-x' });
  assert.equal(privateResult.results.length, 0);
  assert.equal(privateResult.unavailableCount, 1);

  let boundedFetches = 0;
  const boundedService = createClassicRadioService({
    fetchImpl: async (input) => {
      boundedFetches += 1;
      assert.equal(archiveUrl(input).searchParams.get('rows'), String(CLASSIC_RADIO_PAGE_MAX));
      return response({ response: { numFound: 0, docs: [] } });
    },
  });
  await boundedService.search({ show: 'dimension-x', limit: 999 });
  assert.equal(boundedService.cacheSize(), 0);

  const unmeasuredShow = findClassicRadioShow('Johnny Dollar');
  assert.ok(unmeasuredShow);
  assert.equal(unmeasuredShow.measured, false);
  let emptyFetches = 0;
  const emptyService = createClassicRadioService({
    fetchImpl: async () => {
      emptyFetches += 1;
      return response({ response: { numFound: 0, docs: [] } });
    },
  });
  const emptyResult = await emptyService.search({ show: unmeasuredShow.id });
  assert.equal(classicRadioEmptyMessage(emptyResult), 'No public episodes found for this show');
  await emptyService.search({ show: unmeasuredShow.id });
  assert.equal(emptyFetches, 2);
  assert.equal(emptyService.cacheSize(), 0);

  let errorFetches = 0;
  const errorService = createClassicRadioService({
    fetchImpl: async () => {
      errorFetches += 1;
      return response({ error: 'fixture status only' }, 503);
    },
  });
  await assert.rejects(errorService.search({ show: 'dimension-x' }), /Archive HTTP 503/);
  await assert.rejects(errorService.search({ show: 'dimension-x' }), /Archive HTTP 503/);
  assert.equal(errorFetches, 2);
  assert.equal(errorService.cacheSize(), 0);

  await assert.rejects(fixtureService.search({ show: 'not-a-show' }), /unknown_show/);
  console.log('PASS: registry 17 shows / 4 genres / 6 unmeasured; alias, public-file, alternate, bounded-query, cache, empty/error, and fixture-only search checks');
  console.log(`PASS: fixture fetch calls=${fixtureFetchCalls + boundedFetches + emptyFetches + errorFetches}; live Archive calls=0`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack : 'test failed');
  process.exitCode = 1;
});
