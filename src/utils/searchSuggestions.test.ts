import assert from 'node:assert/strict';
import { buildEmptySearchSuggestionGroups } from './searchSuggestions';
import type { SuggestCandidate } from './suggest';

const candidates: SuggestCandidate[] = [
  ...['Recent One', 'Recent Two', 'Café News', 'Recent Four', 'Recent Five', 'Recent Six'].map((text) => ({ text, kind: 'recent' as const })),
  { text: 'Recent One', kind: 'topic' },
  { text: 'Cafe News', kind: 'topic' },
  { text: 'Election', kind: 'topic' },
  { text: 'Space', kind: 'topic' },
  { text: 'Election', kind: 'topic' },
  { text: 'Congress', kind: 'topic' },
  { text: 'Technology', kind: 'topic' },
  { text: 'Extra Topic', kind: 'topic' },
];

const groups = buildEmptySearchSuggestionGroups(candidates);
assert.deepEqual(groups.recent.map((item) => item.text), ['Recent One', 'Recent Two', 'Café News', 'Recent Four', 'Recent Five']);
assert.deepEqual(groups.topics.map((item) => item.text), ['Election', 'Space', 'Congress', 'Technology', 'Extra Topic']);
assert.deepEqual(buildEmptySearchSuggestionGroups([]), { recent: [], topics: [] });
assert.deepEqual(
  buildEmptySearchSuggestionGroups([{ text: '   ', kind: 'recent' }, { text: '', kind: 'topic' }]),
  { recent: [], topics: [] },
);

console.log('PASS searchSuggestions: recent cap, topic cap, accent-insensitive de-duplication, and empty state');
