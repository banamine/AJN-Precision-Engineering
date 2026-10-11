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
