import assert from 'node:assert/strict';
import { GUIDE_CARDS } from './startGuideCards';
import { VALID_DESTINATIONS } from '../nav/lastView';
import {
  loadStartGuidePref,
  saveStartGuidePref,
  shouldAutoOpen,
  START_GUIDE_KEY,
  type StartGuideStorage,
} from './startGuideState';

const DEFAULT = { version: 1, dontAutoOpen: false };

class MemoryStorage implements StartGuideStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  setItem(key: string, value: string): void { this.map.set(key, value); }
}

// a) six cards, unique ids
assert.equal(GUIDE_CARDS.length, 6);
assert.equal(new Set(GUIDE_CARDS.map((c) => c.id)).size, 6);

// b) every destination is a real app destination
for (const card of GUIDE_CARDS) {
  assert.ok((VALID_DESTINATIONS as readonly string[]).includes(card.dest), `${card.id}: "${card.dest}" is not in VALID_DESTINATIONS`);
}

// c) every card is complete
const filled = (v: unknown): boolean => typeof v === 'string' && v.trim().length > 0;
for (const card of GUIDE_CARDS) {
  assert.ok(filled(card.title) && filled(card.blurb) && filled(card.openLabel) && filled(card.emoji), `${card.id}: title/blurb/openLabel/emoji`);
  assert.equal(card.tour.length, 2, `${card.id}: exactly 2 tour steps`);
  for (const step of card.tour) assert.ok(filled(step.title) && filled(step.body), `${card.id}: tour step text`);
  assert.ok(filled(card.explain.title) && filled(card.explain.body), `${card.id}: explain text`);
  assert.ok(card.explain.pills.length >= 2 && card.explain.pills.every(filled), `${card.id}: at least 2 pills`);
}

// d) empty storage gives the default
assert.deepEqual(loadStartGuidePref(new MemoryStorage()), DEFAULT);

// e) save then load round-trips
const store = new MemoryStorage();
saveStartGuidePref({ version: 1, dontAutoOpen: true }, store);
assert.deepEqual(loadStartGuidePref(store), { version: 1, dontAutoOpen: true });

// f) bad data and broken storage all give the default
for (const bad of ['{not json', JSON.stringify({ version: 2, dontAutoOpen: true }), JSON.stringify({ version: 1, dontAutoOpen: 'yes' }), 'null', '[]']) {
  const s = new MemoryStorage();
  s.setItem(START_GUIDE_KEY, bad);
  assert.deepEqual(loadStartGuidePref(s), DEFAULT, `bad value: ${bad}`);
}
const throwing: StartGuideStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
assert.deepEqual(loadStartGuidePref(throwing), DEFAULT);
assert.doesNotThrow(() => saveStartGuidePref({ version: 1, dontAutoOpen: true }, throwing));

// the default is never shared between calls
const a = loadStartGuidePref(new MemoryStorage());
a.dontAutoOpen = true;
assert.deepEqual(loadStartGuidePref(new MemoryStorage()), DEFAULT);

// g) auto-open rule
assert.equal(shouldAutoOpen({ version: 1, dontAutoOpen: false }, false), true);
assert.equal(shouldAutoOpen({ version: 1, dontAutoOpen: true }, false), false);
assert.equal(shouldAutoOpen({ version: 1, dontAutoOpen: false }, true), false);
assert.equal(shouldAutoOpen({ version: 1, dontAutoOpen: true }, true), false);

console.log('start-guide: ok');
