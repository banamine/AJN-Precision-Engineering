import { useEffect, useRef, useState } from 'react';
import { Thumb } from './Thumb';
import type { ThumbInput } from '../utils/thumbnail';

/** Fixed-size thumbnail that only starts loading when its row is near the viewport (300 px margin) and keeps its box
 *  reserved until then, so scrolling never shifts the layout and off-screen rows never touch the network. Reuses Thumb's
 *  fallback chain (episode frame -> Archive item image -> captured frame -> local backup -> initials). */
export function LazyThumb({ input, title, className = 'h-6 w-10' }: { input: ThumbInput; title: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (near || !el) return;
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { setNear(true); io.disconnect(); } }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  return (
    <span ref={ref} data-testid="lazy-thumb" data-loaded={near ? 'true' : 'false'} className={`block shrink-0 overflow-hidden rounded bg-neutral-800 ${className}`}>
      {near && <Thumb input={input} title={title} className="h-full w-full text-[9px]" />}
    </span>
  );
}
