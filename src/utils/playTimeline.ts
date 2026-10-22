// Read-only diagnostics for "why did the last-played station take so long to start?". Changes no behaviour.
// In the browser console after a cold start:   __ajnTimeline()   -> every audio event with ms since the element was created
//                                              __ajnSlow()       -> what the browser downloaded meanwhile (slowest first)
interface Mark { ms: number; ev: string; ct: number; rs: number; ns: number; note?: string }
const MEDIA_EVENTS = ['loadstart', 'loadedmetadata', 'canplay', 'playing', 'waiting', 'stalled', 'seeking', 'seeked', 'suspend', 'error', 'abort', 'emptied', 'ended'] as const;
type W = Window & { __ajnTimelines?: Array<{ restored: boolean; src: string; startedAtMs: number; marks: Mark[] }> };

export function attachPlayTimeline(el: HTMLMediaElement, info: { restored: boolean; src: string; startAtSeconds?: number }): void {
  try {
    const w = window as W;
    const t0 = performance.now();
    const rec = { restored: info.restored, src: info.src.slice(0, 120), startedAtMs: Math.round(t0), marks: [] as Mark[] };
    (w.__ajnTimelines ??= []).push(rec);
    if (w.__ajnTimelines.length > 8) w.__ajnTimelines.shift();
    const mark = (ev: string, note?: string): void => { rec.marks.push({ ms: Math.round(performance.now() - t0), ev, ct: Math.round(el.currentTime * 10) / 10, rs: el.readyState, ns: el.networkState, ...(note ? { note } : {}) }); };
    mark('element-created', `restored=${info.restored} startAt=${info.startAtSeconds ?? '-'} preload=${el.preload} crossOrigin=${el.crossOrigin ?? '-'}`);
    el.addEventListener('play', () => mark('play'));
    el.addEventListener('pause', () => mark('pause'));
    for (const n of MEDIA_EVENTS) el.addEventListener(n, () => mark(n, n === 'error' ? `code=${el.error?.code ?? '?'} ${el.error?.message ?? ''}`.trim() : n === 'loadedmetadata' ? `duration=${el.duration}` : undefined));
    el.addEventListener('playing', () => { try { console.info(`[AJN timeline] playing after ${Math.round(performance.now() - t0)} ms (restored=${info.restored})`); } catch { /* console unavailable */ } }, { once: true });
    (w as unknown as Record<string, unknown>).__ajnTimeline = () => { console.table(w.__ajnTimelines?.map((r) => ({ restored: r.restored, src: r.src, marks: r.marks.length })) ?? []); const last = w.__ajnTimelines?.[w.__ajnTimelines.length - 1]; if (last) console.table(last.marks); return last; };
    (w as unknown as Record<string, unknown>).__ajnSlow = () => {
      const rows = (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).map((r) => ({ startMs: Math.round(r.startTime), durMs: Math.round(r.duration), kb: Math.round((r.transferSize || 0) / 1024), type: r.initiatorType, url: r.name.replace(location.origin, '').slice(0, 110) })).sort((a, b) => b.durMs - a.durMs).slice(0, 15);
      console.table(rows); return rows;
    };
  } catch { /* diagnostics must never break playback */ }
}
