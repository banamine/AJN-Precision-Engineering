import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';
const { loadMusicPools } = await import('./src/utils/musicGenrePools.ts');
const { buildMusicPools } = await import('./src/utils/scheduleCatalog.ts');
const pools = await loadMusicPools();
assert.equal(pools[0].id, 'music-all'); assert.equal(pools[0].label, 'All music');
const genres = pools.slice(1);
assert.ok(genres.length >= 15, 'genre pools: ' + genres.length);
assert.equal(new Set(pools.map((p) => p.id)).size, pools.length, 'unique pool ids');
const channels = buildMusicPools().length;
assert.equal(pools[0].items.length, channels + 301, 'all channels + 301 albums');
assert.equal(genres.reduce((n, p) => n + p.items.length, 0), pools[0].items.length, 'every item is in exactly one genre');
let tracks = 0, real = 0;
for (const it of pools[0].items) for (const t of it.tracks) {
  tracks++; if (t.durationSeconds) real++;
  assert.ok(t.src.startsWith('/download/') && t.programId === `${t.archiveId}::${t.partNo}` && t.bank === 'music', t.programId);
}
assert.ok(real > 0 && real < tracks, 'estimated durations stay undefined');
const hs = genres.find((p) => p.label === 'Hardstyle & Hardcore')!;
assert.ok(hs.items.some((i) => i.id.startsWith('va-defqon')), 'Defqon album is in Hardstyle');
console.log('test-music-genres OK', genres.length, 'genres:', genres.map((p) => `${p.label} ${p.items.length}`).join(', '), '| tracks', tracks, 'real-length', real);
