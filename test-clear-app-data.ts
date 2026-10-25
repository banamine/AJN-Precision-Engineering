import { clearAppData } from './src/components/DevModeView';
// clearAppData removes only AJN-owned keys (prefix "ajn", case-insensitive) via key()/removeItem().
const data = new Map<string, string>([
  ['ajn.recentlyPlayed.v1', '[]'],
  ['ajn.recentSearches.v1', '[]'],
  ['ajn-playback-position:x', '5'],
  ['firebase:authUser', 'keep-me'],
]);
const fake = {
  get length() { return data.size; },
  key(i: number) { return [...data.keys()][i] ?? null; },
  removeItem(k: string) { data.delete(k); },
};
let fail = 0; const ok = (c: boolean, m: string) => { if (!c) { fail++; console.error('FAIL', m); } else console.log('ok', m); };
ok(clearAppData(fake) === 3, 'returns count removed');
ok(data.size === 1 && data.has('firebase:authUser'), 'only AJN keys removed; other apps keys kept');
ok(clearAppData(null) === null, 'null storage -> null');
ok(clearAppData({ length: 1, key() { throw new Error('x'); }, removeItem() {} }) === null, 'throwing storage -> null');
process.exit(fail ? 1 : 0);
