import assert from 'node:assert/strict';
import { LOBES, NEURONS, EDGES, layout } from './src/neural/topology';
import { readAll, readNeuron, aheadSeconds, probeDigest, captureFrame, type TelemetryEnv } from './src/neural/telemetry';

// topology integrity
assert.equal(LOBES.length, 7); assert.equal(NEURONS.length, 32, 'Entry 050: 32 neurons');
const ids = new Set(NEURONS.map((x) => x.id)); assert.equal(ids.size, 32, 'unique ids');
for (const l of LOBES) assert.ok(NEURONS.some((x) => x.lobe === l.id), l.id);
const per = (l: string) => NEURONS.filter((x) => x.lobe === l).length;
assert.deepEqual(LOBES.map((l) => per(l.id)), [5, 5, 6, 4, 5, 3, 4], 'neurons per lobe match Entry 050');
for (const e of EDGES) assert.ok(ids.has(e.from) && ids.has(e.to), `${e.from}->${e.to}`);
assert.equal(new Set(EDGES.map((e) => `${e.from}>${e.to}`)).size, EDGES.length, 'no duplicate edges');
const pos = layout(); assert.ok(NEURONS.every((x) => pos[x.id]?.every(Number.isFinite)));
for (const x of NEURONS) if (x.probe === 'unwired') assert.ok(x.emptyNote, `${x.id} says why it is unwired`);

const buffered = (s: number, e: number) => ({ length: 1, start: () => s, end: () => e }) as unknown as TimeRanges;
const media = (paused: boolean, t = 10, ahead = 20, reconnect?: string) => ({ paused, currentTime: t, readyState: 4, buffered: buffered(0, t + ahead), dataset: reconnect ? { reconnect } : {} });
const env = (o: Partial<TelemetryEnv> = {}): TelemetryEnv => ({ audio: null, video: null, jingle: { supported: false, playing: false, on: true }, sharedQuery: '', counts: { concerts: 1410, fm: 346, rssFeeds: 19, rssCollected: 11, podcastFeeds: 16 }, digest: null, frame: null, now: 1_000_000, ...o });
const get = (id: string, e: TelemetryEnv) => readNeuron(NEURONS.find((x) => x.id === id)!, e);

assert.equal(aheadSeconds(media(false) as never), 20);
assert.equal(get('minimal-player', env()).state, 'idle'); assert.match(get('minimal-player', env()).headline, /No audio element/);
const live = get('minimal-player', env({ audio: media(false, 10, 20, '2') as never }));
assert.equal(live.state, 'live'); assert.ok(live.details.some((d) => d.includes('buffered ahead 20.0')) && live.details.some((d) => d.includes('reconnect attempt 2')));
assert.equal(get('minimal-player', env({ audio: media(true) as never })).state, 'idle');
assert.equal(get('buffer-jingle', env({ jingle: { supported: true, playing: true, on: true } })).state, 'live');
assert.equal(get('shared-search', env({ sharedQuery: 'jazz' })).payload, 'Query · "jazz"');
assert.match(get('concert-manifest', env()).headline, /1,410/); assert.match(get('fm-manifest', env()).headline, /346/);
assert.match(get('news-rss-sources', env()).headline, /19 RSS feeds listed, 11 collected/);
assert.equal(get('concert-manifest', env({ counts: { concerts: null, fm: null, rssFeeds: null, rssCollected: null, podcastFeeds: null } })).state, 'unwired', 'no count, no claim');

// honesty: with nothing live, no neuron reports a payload or 'live'
const idle = readAll(env()); assert.equal(idle.length, 32);
assert.ok(idle.every((r) => r.state !== 'live' && !r.payload), 'nothing live without real signals');
assert.ok(get('actor-director-graph', env()).details[0].includes('invented'));
assert.equal(get('status-cache-payload', env()).state, 'unwired');
assert.equal(get('github-repo-sync', env()).state, 'unwired');

// digest: real fetch result is passed through, failure is reported
(async () => {
  let t = 0; const perf = () => (t += 120);
  const ok = await probeDigest((async () => ({ ok: true, status: 200, json: async () => ({ last_updated: '2026-11-11T15:21:48+00:00', stories_count: 8 }) })) as never, () => 5, perf);
  assert.deepEqual([ok.ok, ok.rttMs, ok.stories], [true, 120, 8]);
  const down = await probeDigest((async () => { throw new Error('offline'); }) as never, () => 5, perf);
  assert.deepEqual([down.ok, down.error], [false, 'offline']);
  const bad = await probeDigest((async () => ({ ok: false, status: 503 })) as never, () => 5, perf); assert.equal(bad.error, 'HTTP 503');
  const age = get('daily-digest-json', env({ digest: { ...ok, checkedAt: 1_000_000 - 30_000, lastUpdated: new Date(1_000_000 - 20 * 60_000).toISOString() } }));
  assert.equal(age.state, 'live'); assert.match(age.headline, /updated 20 min ago/);
  assert.equal(get('daily-digest-json', env({ digest: down })).state, 'idle');
  // frame capture: a tainted canvas is reported, not faked
  const blocked = captureFrame({} as never, () => ({ width: 0, height: 0, getContext: () => ({ drawImage: () => { const e = new Error('tainted'); e.name = 'SecurityError'; throw e; } }) }) as never, () => 9);
  assert.equal(blocked.probe.ok, false); assert.match(blocked.probe.error!, /CORS/);
  assert.equal(get('tracker-tv', env({ video: media(true) as never })).headline, 'No video playing');
  console.log('neural twin ok', NEURONS.length, 'neurons', EDGES.length, 'pathways');
})();
