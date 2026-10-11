import { useEffect, useMemo, useState } from 'react';
import { initialsOf, thumbCandidates, archiveIdentifierFromPath, type ThumbInput } from '../utils/thumbnail';
import { getCaptured, markMissing, THUMB_EVENT } from '../utils/thumbStore';

interface ThumbProps { input: ThumbInput; title?: string; className?: string }

/** Image with an ordered fallback chain (see utils/thumbnail.ts). data-thumb-source names what is actually showing:
 *  episode-frame | item-image | captured | backup | initials. */
export function Thumb({ input, title, className = '' }: ThumbProps) {
  const id = input.identifier ?? archiveIdentifierFromPath(input.path);
  const [tick, setTick] = useState(0);
  const [idx, setIdx] = useState(0);
  useEffect(() => { const on = (e: Event) => { if ((e as CustomEvent).detail?.key === id) setTick((n) => n + 1); }; window.addEventListener(THUMB_EVENT, on); return () => window.removeEventListener(THUMB_EVENT, on); }, [id]);
  const candidates = useMemo(() => thumbCandidates(input, getCaptured(id)), [input.identifier, input.path, input.frameFile, input.guideId, input.category, input.mediaType, input.channelId, id, tick]);
  const sig = candidates.map((c) => c.url).join('|');
  useEffect(() => { setIdx(0); }, [sig]);
  const current = candidates[idx];
  const onError = () => {
    if (current && (current.source === 'episode-frame' || current.source === 'item-image')) {
      // Archive has no usable image for this item: allow a real playback frame to be captured for it.
      if (candidates.slice(idx + 1).every((c) => c.source !== 'item-image')) markMissing(id);
    }
    setIdx((n) => n + 1);
  };
  if (!current) {
    return <div role="img" aria-label={title ?? 'No thumbnail'} data-thumb-source="initials" className={`flex items-center justify-center bg-neutral-800 text-neutral-300 font-semibold ${className}`}>{initialsOf(title)}</div>;
  }
  return <img key={current.url} src={current.url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" data-thumb-source={current.source} onError={onError} className={`object-cover bg-neutral-800 ${className}`} />;
}
