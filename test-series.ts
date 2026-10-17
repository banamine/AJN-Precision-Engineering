// Regression: multi-season series channels (Taxi, Hogan's Heroes) built from src/data/seriesManifests.json.
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';
const P = await import('./collections/series-parse.ts');
const C = await import('./collections/series-channel.ts');
const S = await import('./server/archive/mediaSelector.ts');
const R = await import('./server/catalog/rules.ts');
const G = await import('./guideRegistry.ts');
const CFG = await import('./collections/series-config.ts');

// --- parsing the four naming schemes found on Archive
assert.deepEqual(P.parseEpisodeName('Taxi 1x01 Like Father Like Daughter.mp4'), { season: 1, episode: 1, title: 'Like Father Like Daughter' });
assert.deepEqual(P.parseEpisodeName('Taxi S02E01 Louie and the Nice Girl.mp4'), { season: 2, episode: 1, title: 'Louie and the Nice Girl' });
assert.deepEqual(P.parseEpisodeName('Taxi - S04E02 - Vienna Waits.mp4'), { season: 4, episode: 2, title: 'Vienna Waits' });
assert.deepEqual(P.parseEpisodeName("Hogan's Heroes_S06E24_Is There a Traitor in the House.mp4"), { season: 6, episode: 24, title: 'Is There a Traitor in the House' });
assert.deepEqual(P.parseEpisodeName('Episode 10 elaine and the monk.mp4'), { episode: 10, title: 'elaine and the monk' });
assert.equal(P.parseEpisodeName('Taxi_Episodes_Compilation.mp4'), null, 'a compilation is not an episode');

// --- manifest building: derivative preferred, .avi never chosen, gaps and duplicates reported
const f = (name: string, format: string, length = '1400') => ({ name, format, size: '1000', length });
const items = [
  { cfg: { identifier: 'itemA', seasonHint: 1 }, meta: { metadata: {}, files: [
    f('Show 1x01 One.avi', 'Cinepack'), f('Show 1x01 One.mp4', 'h.264'), f('Show 1x01 One.ia.mp4', 'h.264 IA'),
    f('Show 1x03 Three.mp4', 'MPEG4'), f('Show 1x03 Three.avi', 'Cinepack'), f('notes.txt', 'Text'), f('x.thumbs/Show_000001.jpg', 'Thumbnail'),
  ] } },
  { cfg: { identifier: 'itemB', seasonHint: 1 }, meta: { metadata: {}, files: [f('Show 1x01 One again.mp4', 'h.264')] } },
];
const m = P.buildManifest({ key: 't', channelId: 'c', name: 'T', series: 'Show', group: 'G', items: [] }, items as any, { ...P, parseEpisodeName: P.parseEpisodeName, groupEpisodes: P.groupEpisodes, selectPlayableFile: S.selectPlayableFile, findSexWord: R.findSexWord });
assert.deepEqual(m.episodes.map((e) => `${e.season}x${e.episode}:${e.format}`), ['1x1:h.264', '1x3:MPEG4']);
assert.ok(m.episodes.every((e) => !/\.avi$/i.test(e.fileName)), 'never .avi');
assert.ok(m.issues.some((i) => /episode number\(s\) 2 not found/.test(i)), 'gap in numbering reported');
assert.ok(m.issues.some((i) => /S1E1 appears in itemA and itemB/.test(i)), 'duplicate reported');
const bad = P.buildManifest({ key: 't', channelId: 'c', name: 'T', series: 'Show', group: 'G', items: [] }, [{ cfg: { identifier: 'z' }, error: 'metadata unavailable: boom' }] as any, { ...P, selectPlayableFile: S.selectPlayableFile, findSexWord: R.findSexWord } as any);
assert.equal(bad.episodes.length, 0); assert.ok(bad.issues[0].includes('boom'), 'a failed item is reported, not dropped silently');

// --- the generated manifest
const taxi = C.getSeriesManifest('taxi')!;
assert.ok(taxi && taxi.episodes.length >= 100, 'Taxi has all seasons, not just season 1');
assert.deepEqual([...new Set(taxi.episodes.map((e) => e.season))], [1, 2, 3, 4, 5], 'five seasons');
assert.equal(new Set(taxi.episodes.map((e) => `${e.season}x${e.episode}`)).size, taxi.episodes.length, 'no duplicate episode');
for (const e of taxi.episodes) { assert.ok(!/\.avi$/i.test(e.path), e.path); assert.ok(e.path.startsWith('/download/'), e.path); assert.ok(!/%25/.test(e.path), 'no double encoding'); assert.ok(e.durationSeconds > 600, `${e.fileName} has a real length`); }
const sorted = [...taxi.episodes].sort((a, b) => a.season - b.season || a.episode - b.episode);
assert.deepEqual(taxi.episodes.map((e) => e.path), sorted.map((e) => e.path), 'season/episode order');
const hh = C.getSeriesManifest('hogans-heroes')!;
assert.ok(hh.episodes.length > 100 && new Set(hh.episodes.map((e) => e.season)).size === 6);
assert.ok(hh.issues.some((i) => /not found in the source/.test(i)), "Hogan's gaps are listed, not hidden");

// --- wiring: listed once in Classic TV, in order, laid out so every episode airs
for (let n = 0; n < 2; n++) for (const sc of CFG.SERIES_CONFIG) {
  const ch = G.getChannelsByGuide('classic-tv').filter((c: any) => c.id === sc.channelId);
  assert.equal(ch.length, 1, `${sc.key} listed once`); assert.equal(ch[0].guideId, 'classic-tv');
  assert.equal(G.getChannelById(sc.channelId)?.name, sc.name);
}
const base = C.seriesBasePrograms(CFG.SERIES_CONFIG[0]);
assert.equal(base.length, taxi.episodes.length);
const day = G.layoutDailySchedule(base, 24, new Date('2026-10-05T12:00:00Z'), 600);
assert.ok(day.length >= base.length, 'every episode airs at least once');
assert.equal(day[0].title.startsWith('Taxi S01E01'), true);
for (let i = 1; i < day.length; i++) assert.ok(day[i].startHour === day[i - 1].endHour || Math.abs(day[i].startHour! - day[i - 1].endHour!) < 1e-6, `no gap before slot ${i}`);
assert.equal(new Set(day.slice(0, base.length).map((p) => p.assetId)).size, base.length, 'each episode is its own asset');
assert.equal(G.getChannelsByGuide('classic-tv').some((c: any) => c.id === 'honeymooners'), true, 'Honeymooners untouched');
console.log('series channels: ok');

// numbering 'sxx' (The Protectors): opt-in only
{
  const { parseSxxName, groupEpisodes } = await import('./collections/series-parse');
  assert.deepEqual(parseSxxName('the.protectors.108..mp4'), { season: 1, episode: 8, title: '' });
  assert.deepEqual(parseSxxName('the.protectors.120.mp4'), { season: 1, episode: 20, title: '' });
  assert.equal(parseSxxName('no number.mp4'), null);
  const files = [{ name: 'p.101.mp4' }, { name: 'p.101.avi' }, { name: 'p.102.mp4' }];
  assert.equal(groupEpisodes(files).groups.size, 0, 'without the option nothing is guessed');
  assert.equal(groupEpisodes(files, undefined, 'sxx').groups.size, 2);
  console.log('series sxx numbering: ok');
}
