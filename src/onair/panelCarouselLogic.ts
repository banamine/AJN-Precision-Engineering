/* Build 13 logic (pure, testable): one full item at a time for text panels (Headlines, Digest). No ellipsis, no line cut-off.
 * Pure function of nowMs (no state, no timers of its own): dwell = max(6 s, 70 ms per character); text steps down in size for long items,
 * and anything over PAGE_CHARS is split into pages at word boundaries so every word is shown. */
export const MIN_DWELL_MS = 6000;
export const MS_PER_CHAR = 70;
export const PAGE_CHARS = 220;

export function pageText(text: string): string[] {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= PAGE_CHARS) return t ? [t] : [];
  const out: string[] = [];
  let rest = t;
  while (rest.length > PAGE_CHARS) {
    let cut = rest.lastIndexOf(' ', PAGE_CHARS);
    if (cut < PAGE_CHARS * 0.5) cut = PAGE_CHARS;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}
export const dwellFor = (s: string): number => Math.max(MIN_DWELL_MS, MS_PER_CHAR * s.length);
export const sizeClass = (s: string): string => (s.length <= 90 ? 'pc-s0' : s.length <= 150 ? 'pc-s1' : s.length <= 210 ? 'pc-s2' : 'pc-s3');

/** Which page is on screen at nowMs. Exported for tests. */
export function pickPage(items: string[], nowMs: number): { text: string; n: number; total: number; part: string } | null {
  const pages: { text: string; part: string }[] = [];
  items.forEach((it) => { const p = pageText(it); p.forEach((x, k) => pages.push({ text: x, part: p.length > 1 ? ` (${k + 1}/${p.length})` : '' })); });
  if (pages.length === 0) return null;
  const cycle = pages.reduce((a, p) => a + dwellFor(p.text), 0);
  let pos = ((nowMs % cycle) + cycle) % cycle;
  for (let i = 0; i < pages.length; i++) {
    const d = dwellFor(pages[i].text);
    if (pos < d) return { text: pages[i].text, n: i + 1, total: pages.length, part: pages[i].part };
    pos -= d;
  }
  return { text: pages[0].text, n: 1, total: pages.length, part: pages[0].part };
}

