import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';
const { musicAlbumRecords } = await import('./server/library/musicAlbumRecords.ts');
const L = await import('./server/libraryIndex.ts');
const recs = musicAlbumRecords();
assert.equal(recs.length, 301);
assert.equal(new Set(recs.map((r) => r.id)).size, 301, 'unique ids');
assert.ok(!recs.some((r) => /sound ?bible/i.test(r.title)), 'sound effects excluded');
let tracks = 0;
for (const r of recs) {
  assert.ok(r.title.startsWith('VA - ') && r.mediaType === 'audio' && r.parts!.length > 0, r.id);
  assert.ok(!r.guideId && !r.channelId && !r.programId, `${r.id} is not a channel record`);
  for (const p of r.parts!) { assert.ok(p.path.startsWith('/download/') && p.durationSeconds > 0 && p.file.endsWith('.opus'), p.id); tracks++; }
}
assert.equal(tracks, 19567);
assert.ok(recs.some((r) => r.durEst), 'estimates are flagged');
L.setLibraryIndexForTests([]); L.setMusicAlbumsForTests(true);
const song = L.queryLibrary({ q: 'chasing cars', limit: 48, page: 1 }) as any;
assert.ok(song.items.some((i: any) => /^VA - /.test(i.title)), 'a song name finds its album');
const cat = L.queryLibrary({ category: 'music-albums', limit: 48, page: 1 }) as any;
assert.ok(cat.items.length > 0, 'category lists albums');
L.setLibraryIndexForTests([]);
assert.equal((L.queryLibrary({ q: 'chasing cars', limit: 48, page: 1 }) as any).items.length, 0, 'fixture tests do not see albums');
console.log('test-music-albums OK', recs.length, 'albums', tracks, 'songs');
