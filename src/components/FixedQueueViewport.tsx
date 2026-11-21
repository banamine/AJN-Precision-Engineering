import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

interface FixedQueueViewportProps {
  as?: "ul" | "ol";
  label: string;
  children: ReactNode;
  testId?: string;
  /** Extra utility classes, e.g. "ajn-queue-scroll--side". */
  className?: string;
}

/**
 * Fixed-height scroll viewport for track lists. Height comes from the --ajn-queue-* tokens in index.css,
 * so the card is the same size whether the list has 1 or 20 rows. The fade shows only while more rows
 * are below.
 */
export default function FixedQueueViewport({ as: Tag = "ul", label, children, testId, className = "" }: FixedQueueViewportProps) {
  const ref = useRef<HTMLUListElement & HTMLOListElement>(null);
  const [more, setMore] = useState(false);
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  }, []);
  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, children]);
  return (
    <div className="relative">
      <Tag
        ref={ref}
        role="list"
        aria-label={label}
        data-testid={testId}
        onScroll={measure}
        className={`ajn-queue-scroll space-y-1 ${className}`}
      >
        {children}
      </Tag>
      {more && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-slate-900 to-transparent" />}
    </div>
  );
}
