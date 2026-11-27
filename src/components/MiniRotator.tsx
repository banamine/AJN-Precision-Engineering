/* A small box that shows ONE mini panel at a time. Left/right (buttons, swipe, arrow keys while focus is inside) moves to the next one, like the News Cube.
 * Presentational only: the panels' content comes from the caller. Sits inside the deck card, under the playlist drop-down. */
import { useCallback, useRef, useState, type ReactElement, type ReactNode } from 'react';

export interface MiniPanel { key: string; label: string; content: ReactNode; /** Gold ring on the dot (e.g. a new alert hit). */ badge?: boolean }

export function MiniRotator({ panels, initial = 0 }: { panels: readonly MiniPanel[]; initial?: number }): ReactElement | null {
  const [i, setI] = useState(initial);
  const drag = useRef<number | null>(null);
  const n = panels.length;
  const idx = Math.min(i, Math.max(0, n - 1));
  const go = useCallback((d: 1 | -1) => setI((c) => (n <= 0 ? 0 : (Math.min(c, n - 1) + d + n) % n)), [n]);
  if (n === 0) return null;
  const cur = panels[idx]!;
  return (
    <section data-testid="mini-rotator" aria-roledescription="carousel" aria-label="Deck panels" className="rounded-xl border border-[#d4af37]/30 bg-black/30 p-1.5"
      onKeyDown={(e) => { const t = e.target as HTMLElement; if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return; if (e.key === 'ArrowLeft') { go(-1); e.preventDefault(); } else if (e.key === 'ArrowRight') { go(1); e.preventDefault(); } }}
      onPointerDown={(e) => { drag.current = (e.target as HTMLElement).closest('button, a, input, select') ? null : e.clientX; }}
      onPointerUp={(e) => { const s = drag.current; drag.current = null; if (s === null) return; const dx = e.clientX - s; if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1); }}>
      <div className="mb-1 flex items-center gap-1">
        <button type="button" data-testid="mini-prev" aria-label="Previous panel" onClick={() => go(-1)} className="ck-key ck-key--sm min-h-[34px] min-w-[34px]">‹</button>
        <h3 data-testid="mini-title" className="m-0 min-w-0 flex-1 truncate text-center font-serif text-[13px] font-bold text-[#e9c964]" aria-live="polite">{cur.label}</h3>
        <button type="button" data-testid="mini-next" aria-label="Next panel" onClick={() => go(1)} className="ck-key ck-key--sm min-h-[34px] min-w-[34px]">›</button>
      </div>
      <div key={cur.key} data-testid={`mini-panel-${cur.key}`} role="group" aria-roledescription="slide" aria-label={`${idx + 1} of ${n}: ${cur.label}`} className="mini-slide h-[132px] overflow-hidden text-xs text-slate-200">{cur.content}</div>
      <nav aria-label="Panel dots" className="flex justify-center">
        {panels.map((p, k) => (
          <button key={p.key} type="button" data-testid={`mini-dot-${p.key}`} aria-label={`${p.label}${p.badge ? ' (new alert)' : ''}`} aria-current={k === idx ? 'step' : undefined} onClick={() => setI(k)} className="flex min-h-[28px] min-w-[36px] items-center justify-center bg-transparent">
            <i aria-hidden="true" className={`block h-2 rounded-full border border-[#d4af37]/40 transition-[width] motion-reduce:transition-none ${k === idx ? 'w-5 bg-[#e9c964]' : 'w-2 bg-slate-400/40'} ${p.badge ? 'ring-2 ring-[#e9c964]/70' : ''}`} />
          </button>
        ))}
      </nav>
    </section>
  );
}
