import { normalizeQuery, type SuggestCandidate } from './suggest';

export interface EmptySearchSuggestionGroups {
  recent: SuggestCandidate[];
  topics: SuggestCandidate[];
}

/**
 * Suggestions shown before typing: the five newest recents, followed by up to
 * five unique topic seeds that are not already represented by a recent search.
 */
export function buildEmptySearchSuggestionGroups(candidates: SuggestCandidate[]): EmptySearchSuggestionGroups {
  const recent: SuggestCandidate[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    if (candidate.kind !== 'recent' || !candidate.text?.trim()) continue;
    const key = normalizeQuery(candidate.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    recent.push({ ...candidate, text: candidate.text.trim() });
    if (recent.length === 5) break;
  }

  const topics: SuggestCandidate[] = [];
  const seenTopics = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.kind !== 'topic' || !candidate.text?.trim()) continue;
    const text = candidate.text.trim();
    const key = normalizeQuery(text);
    if (!key || seen.has(key) || seenTopics.has(key)) continue;
    seenTopics.add(key);
    topics.push({ ...candidate, text });
    if (topics.length === 5) break;
  }

  return { recent, topics };
}
