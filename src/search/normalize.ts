export function joinedKey(s: string): string {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['"’‘“”`]/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

export function matchesQuery(fields: readonly string[], query: string): boolean {
  // a. q = query.trim(); if empty return true.
  const q = query.trim();
  if (!q) {
    return true;
  }

  // b. hay = fields.map(joinedKey).join('|'); qj = joinedKey(q); if qj is empty (punctuation-only query) return false.
  const hay = fields.map(joinedKey).join('|');
  const qj = joinedKey(q);
  if (!qj) {
    return false;
  }

  // c. Return true if hay.includes(qj) (covers "mash", "MAS*H", "m.a.s.h", "m a s h", "mash 1970").
  if (hay.includes(qj)) {
    return true;
  }

  // d. Otherwise split q on whitespace; if there are 2+ tokens and EVERY token's joinedKey has length >= 2, return true when every token's key is included in hay (any word order, e.g. "zone twilight"). Otherwise false.
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    const tokenKeys = tokens.map(joinedKey);
    if (tokenKeys.every((k) => k.length >= 2)) {
      return tokenKeys.every((k) => hay.includes(k));
    }
  }

  return false;
}

/** 0 = no match. Higher is better. Title beats description/identifier. */
export function scoreMatch(f: { title: string; description?: string; identifier?: string }, query: string): number {
  const qj = joinedKey(query); if (!qj) return 0;
  const t = joinedKey(f.title);
  if (t === qj) return 100;
  if (t.startsWith(qj)) return 80;
  if (t.includes(qj)) return 60;
  const toks = query.trim().split(/\s+/).map(joinedKey).filter((k) => k.length >= 2);
  if (toks.length >= 2 && toks.every((k) => t.includes(k))) return 50;
  if (joinedKey(f.description ?? '').includes(qj) || joinedKey(f.identifier ?? '').includes(qj)) return 20;
  return matchesQuery([f.title, f.description ?? '', f.identifier ?? ''], query) ? 10 : 0;
}
