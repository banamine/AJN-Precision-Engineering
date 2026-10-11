import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const L = await import('./server/libraryIndex.ts');

const cinema = L.LIBRARY_CATEGORIES.find((c) => c.id === 'classic-cinema')!;
const meta = (y: string, desc?: string) => ({
  metadata: { date: y, description: desc },
  files: [{ name: 'a.mp4', format: 'h.264', length: '420' }],
});

const a = L.recordFromMetadata(
  cinema,
  { identifier: 'item-a', title: 'Mash Years Retrospective', year: '1990' },
  meta('1990')
);

const b = L.recordFromMetadata(
  cinema,
  { identifier: 'item-b', title: 'MASH', year: '1970' },
  meta('1970')
);

const c = L.recordFromMetadata(
  cinema,
  { identifier: 'item-c', title: 'Radio Hour', description: 'A show about mash and other things', year: '1950' },
  meta('1950', 'A show about mash and other things')
);

L.setLibraryIndexForTests([a, b, c]);

const mashResults = L.queryLibrary({ q: 'mash' });
assert.deepEqual(
  mashResults.items.map((i: any) => i.title),
  ['MASH', 'Mash Years Retrospective', 'Radio Hour']
);

const emptyResults = L.queryLibrary({});
assert.deepEqual(
  emptyResults.items.map((i: any) => i.title),
  ['Radio Hour', 'MASH', 'Mash Years Retrospective']
);

console.log('test-library-rank: all passed');
