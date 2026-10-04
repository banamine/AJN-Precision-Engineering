// Pure hourly audio<->video pairing. Never guesses: ambiguity yields video=null with a reason.
// Precedence: stable identity (shared file key) -> date+show+hour -> date+title -> none.
import { classifyAjnMedia, type AjnClassified } from './ajnClassify.ts';

export interface AjnPairable { url: string; title?: string | null; id?: string | null }
export type AjnMatchReason = 'file-key' | 'date-show-hour' | 'date-title' | 'none' | 'ambiguous';
export interface AjnPair<A extends AjnPairable, V extends AjnPairable> {
  audio: A;
  video: V | null;
  matchReason: AjnMatchReason;
}

interface Indexed<V extends AjnPairable> { item: V; c: AjnClassified }

const norm = (s: string | null | undefined) => String(s ?? '').trim().normalize('NFKC').replace(/\s+/g, ' ').toLowerCase();

/** Returns the unique match, or 'ambiguous' when several candidates qualify, or null when none do. */
function unique<V extends AjnPairable>(candidates: Indexed<V>[]): Indexed<V> | null | 'ambiguous' {
  if (candidates.length === 0) return null;
  // Two entries pointing at the very same video URL are one candidate, not an ambiguity.
  const urls = new Set(candidates.map(x => x.item.url));
  return urls.size === 1 ? candidates[0] : 'ambiguous';
}

export function pairAjnMedia<A extends AjnPairable, V extends AjnPairable>(audios: readonly A[], videos: readonly V[]): AjnPair<A, V>[] {
  const vids: Indexed<V>[] = videos.filter(v => classifyAjnMedia(v).kind !== 'audio').map(item => ({ item, c: classifyAjnMedia(item) }));
  return audios.map(audio => {
    const a = classifyAjnMedia(audio);
    if (a.kind !== 'audio') return { audio, video: null, matchReason: 'none' as const };
    const steps: Array<[AjnMatchReason, (v: Indexed<V>) => boolean]> = [];
    if (a.fileKey) steps.push(['file-key', v => v.c.fileKey === a.fileKey]);
    if (a.airDate && a.showSlug) {
      steps.push(['date-show-hour', v => v.c.airDate === a.airDate && v.c.showSlug === a.showSlug && v.c.hourNumber === a.hourNumber && v.c.variant === a.variant]);
    }
    if (a.airDate && audio.title) {
      steps.push(['date-title', v => v.c.airDate === a.airDate && !!v.item.title && norm(v.item.title) === norm(audio.title)]);
    }
    for (const [reason, test] of steps) {
      const hit = unique(vids.filter(test));
      if (hit === 'ambiguous') return { audio, video: null, matchReason: 'ambiguous' as const };
      if (hit) return { audio, video: hit.item, matchReason: reason };
    }
    return { audio, video: null, matchReason: 'none' as const };
  });
}
