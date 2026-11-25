/* Archive.org metadata sometimes carries HTML character codes ("&#039;", "&amp;") inside titles and text. The page shows text, not markup,
 * so the codes are turned back into the characters they stand for. Pure function, no DOM. */
const NAMED: Record<string, string> = { quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…' };
export function decodeEntities(s: string): string {
  if (!s || s.indexOf('&') < 0) return s;
  return s
    .replace(/&#(\d{1,6});/g, (m, n: string) => { const c = Number(n); return c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : m; })
    .replace(/&#x([0-9a-fA-F]{1,6});/g, (m, h: string) => { const c = parseInt(h, 16); return c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : m; })
    .replace(/&([a-zA-Z]{2,8});/g, (m, n: string) => NAMED[n.toLowerCase()] ?? m)
    .replace(/&amp;/g, '&');
}
export function decodeDeskItem<T extends { headline?: string | null; lead?: string | null; source?: string | null; excerpt?: string | null }>(it: T): T {
  const out = { ...it };
  for (const k of ['headline', 'lead', 'source', 'excerpt'] as const) { const v = out[k]; if (typeof v === 'string') (out as Record<string, unknown>)[k] = decodeEntities(v); }
  return out;
}
