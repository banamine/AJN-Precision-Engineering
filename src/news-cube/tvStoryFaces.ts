// Turns /api/tv-stories into CubeArticle cards and puts them on Face 6 (slots 30-35).
// Text is the verbatim caption excerpt; the summary line labels it honestly. No rewording, no AI.
import type { CubeArticle, CubeFaceAllocation } from './adapter';
import type { TvStoryDto } from './useTvStories';

export const TV_FACE_INDEX = 5;
export const TV_SLOT_START = 30;
export const TV_SLOT_COUNT = 6;
export const TITLE_MAX = 200;

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

export function tvStoriesToCubeArticles(stories: readonly TvStoryDto[]): CubeArticle[] {
  const out: CubeArticle[] = [];
  for (const s of stories) {
    const first = s.lead.minutes[0];
    if (!first || !first.text.trim()) continue;
    const others = s.networks.filter((n) => n !== s.lead.network);
    const label = s.lead.sourceKind === 'broadcast-captions' ? 'Caption excerpt, not a headline.' : 'Page text excerpt, not a headline.';
    const parts = [`${label} ${s.lead.network}, ${first.clock || 'time n/a'}.`];
    if (others.length) parts.push(`Covered by: ${others.join(', ')}.`);
    out.push({
      id: `tv:${s.storyId}`,
      title: clip(first.text, TITLE_MAX),
      summary: parts.join(' '),
      publisherName: s.lead.network,
      publisherId: `tv-${s.lead.network.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      publishedAt: s.lead.windowStartUtc,
      canonicalUrl: `https://archive.org/details/${encodeURIComponent(s.lead.identifier)}`,
      imageUrl: null,
    });
    if (out.length >= TV_SLOT_COUNT) break;
  }
  return out;
}

/** Digest articles keep slots 0-29. Face 6 gets the TV cards first; leftover Face 6 slots take overflow digest articles, then null. */
export function composeFaces(digest: readonly CubeArticle[], tv: readonly CubeArticle[]): CubeFaceAllocation[] {
  const slots: (CubeArticle | null)[] = Array.from({ length: 36 }, () => null);
  for (let i = 0; i < TV_SLOT_START; i++) slots[i] = digest[i] ?? null;
  const tvUsed = tv.slice(0, TV_SLOT_COUNT);
  const overflow = digest.slice(TV_SLOT_START);
  for (let k = 0; k < TV_SLOT_COUNT; k++) slots[TV_SLOT_START + k] = tvUsed[k] ?? overflow[k - tvUsed.length] ?? null;
  return Array.from({ length: 6 }, (_, faceIndex) => ({
    faceIndex, faceLabel: `Face ${faceIndex + 1}`, articles: slots.slice(faceIndex * 6, faceIndex * 6 + 6),
  }));
}
