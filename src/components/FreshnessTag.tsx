import type { ReactElement } from 'react';
import { freshness } from '../utils/listenCatalog';

/** Today's drop gets a gold TODAY badge; older episodes show how old they are. Renders nothing for undated items (never guesses). */
export function FreshnessTag({ publishedAt }: { publishedAt?: number }): ReactElement | null {
  const f = freshness(publishedAt);
  if (!f) return null;
  return f.today
    ? <span data-testid="freshness-today" className="shrink-0 rounded bg-[#FACC15] px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-[#0F1117]">Today · {f.age}</span>
    : <span data-testid="freshness-age" className="shrink-0 text-[11px] text-neutral-400">{f.age}</span>;
}
