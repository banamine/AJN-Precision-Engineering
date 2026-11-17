/** Placeholder shown while the TV Guide fetches: same shape as the real grid (header, time ruler, channel column + program blocks), so nothing jumps when the data arrives. */
const ROWS = 8;
const BLOCKS: number[][] = [[38, 24, 30], [52, 40], [26, 34, 32], [60, 30], [30, 30, 28], [44, 46], [22, 38, 30], [56, 34]];

export function GuideSkeleton({ channelColumnPx = 272 }: { channelColumnPx?: number }) {
  const bar = 'rounded bg-neutral-800/80 motion-safe:animate-pulse';
  return (
    <div role="status" aria-busy="true" aria-live="polite" data-testid="guide-skeleton" className="w-full overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950 shadow-2xl">
      <span className="sr-only">Loading the guide…</span>
      <div className="flex items-center gap-2 border-b border-neutral-800 px-3.5 py-3" aria-hidden="true">
        <div className={`h-7 w-40 ${bar}`} /><div className={`h-7 w-20 rounded-full ${bar}`} /><div className={`h-7 w-20 rounded-full ${bar}`} />
      </div>
      <div className="flex border-b border-neutral-800" aria-hidden="true">
        <div className="flex-shrink-0 border-r border-neutral-800 px-3 py-2" style={{ width: channelColumnPx }}><div className={`h-3 w-24 ${bar}`} /></div>
        <div className="flex flex-1 gap-6 overflow-hidden px-3 py-2">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className={`h-3 w-14 shrink-0 ${bar}`} />)}</div>
      </div>
      <div aria-hidden="true">
        {Array.from({ length: ROWS }, (_, r) => (
          <div key={r} className="flex border-b border-neutral-900" style={{ height: 64 }}>
            <div className="flex flex-shrink-0 items-center gap-3 border-r border-neutral-800 px-3" style={{ width: channelColumnPx }}>
              <div className={`h-9 w-9 shrink-0 rounded-md ${bar}`} />
              <div className="min-w-0 flex-1 space-y-1.5"><div className={`h-3 w-3/4 ${bar}`} /><div className={`h-2.5 w-1/2 ${bar}`} /></div>
            </div>
            <div className="flex flex-1 items-center gap-1.5 overflow-hidden px-1.5">
              {BLOCKS[r % BLOCKS.length].map((w, i) => <div key={i} className={`h-11 rounded-md ${bar}`} style={{ width: `${w}%`, flexShrink: 0 }} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
