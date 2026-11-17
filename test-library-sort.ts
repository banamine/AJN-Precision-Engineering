import { sortLibraryResults } from './server/libraryIndex';
let fails = 0; const ok = (c: boolean, m: string) => { console.log(`${c ? 'ok' : 'FAIL'} - ${m}`); if (!c) fails++; };
const rows = [
  { id: 'c', title: 'Zebra', categoryIds: ['classic-cinema'], indexedAt: '2026-10-01T00:00:00Z' },
  { id: 'a', title: 'apple', categoryIds: ['apollo'], indexedAt: '2026-11-01T00:00:00Z' },
  { id: 'b', title: 'Mango 10', categoryIds: ['silent-films'] },
  { id: 'd', title: 'Mango 2', categoryIds: ['apollo'], indexedAt: '2026-11-01T00:00:00Z' },
  { id: 's', title: 'Series', categoryIds: ['classic-cinema'], episodes: [{ indexedAt: '2026-11-10T00:00:00Z' }] },
];
const ids = (s?: string) => sortLibraryResults(rows, s).map((r) => r.id).join('');
ok(ids() === 'cabds', 'no sort keeps the original order');
ok(ids('bogus') === 'cabds', 'unknown sort keeps the original order');
ok(ids('name') === 'adbsc', 'name: case-insensitive, natural numbers (Mango 2 before Mango 10)');
ok(ids('added').startsWith('s') && ids('added').endsWith('b'), 'added: newest first (series = newest episode), undated last');
ok(ids('genre').slice(0, 2) === 'ad', 'genre: grouped by category label, then name');
process.exit(fails ? 1 : 0);
