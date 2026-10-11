import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Play, X } from "lucide-react";
import { createPortal } from "react-dom";
import type { Program, ScheduleChannel, PlayProgramCallback } from "../types";
import type { GridBlock, GridItem } from "./groupProgramsForGrid";
import { windowItems } from "./groupProgramsForGrid";

export function fmtClock(hour: number): string {
  const total = Math.round(Math.max(0, Math.min(24, hour)) * 60);
  const h = Math.floor(total / 60) % 24, m = total % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
export function fmtDur(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function collection(channel: ScheduleChannel): string { return channel.name; }

export function blockLabel(channel: ScheduleChannel, b: GridBlock, live: boolean): string {
  return `${collection(channel)}, ${fmtClock(b.startHour)} to ${fmtClock(b.endHour)}, tracks ${b.first} to ${b.last} of ${b.total}, ${b.trackCount} tracks${live ? ", now playing" : ""}`;
}

export function BlockCell({ channel, block, nowHour, pxPerHour, onOpen }: {
  channel: ScheduleChannel; block: GridBlock; nowHour: number; pxPerHour: number;
  onOpen: (block: GridBlock, opener: HTMLElement) => void;
}) {
  const live = block.liveProgramId !== null;
  const span = block.endHour - block.startHour;
  const frac = live ? Math.min(1, Math.max(0, (nowHour - block.startHour) / span)) : 0;
  return (
    <button
      type="button"
      data-block-live-program-id={block.liveProgramId ?? ""}
      data-live-program-id={block.liveProgramId ?? undefined}
      data-start-hour={block.startHour}
      data-end-hour={block.endHour}
      data-block-id={block.id}
      aria-label={blockLabel(channel, block, live)}
      onClick={(e) => onOpen(block, e.currentTarget)}
      className={`group absolute isolate top-1.5 flex h-[calc(100%-0.75rem)] flex-col justify-center overflow-hidden rounded-lg px-3 text-left text-xs cursor-pointer transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-1 focus-visible:ring-offset-neutral-950 ${
        live ? "border border-amber-500/50 bg-amber-500/15 text-amber-100 shadow-md shadow-amber-500/5"
             : "border border-neutral-800 bg-neutral-900/80 text-neutral-300 hover:border-neutral-700 hover:bg-neutral-800"}`}
      style={{ left: block.startHour * pxPerHour, width: Math.max(span * pxPerHour - 4, 20) }}
    >
      {live && (
        <span className="mb-0.5 inline-flex w-fit items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-amber-400">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse motion-reduce:animate-none" />On Air Now
        </span>
      )}
      <span className="truncate font-semibold text-neutral-100">
        {block.continuesFrom && "… "}{collection(channel)} · tracks {block.first}-{block.last} of {block.total}{block.continuesInto && " …"}
      </span>
      <span className="truncate text-[10px] text-neutral-400">{block.trackCount} tracks · {Math.round(block.minutes)} min</span>
      {live && (
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-amber-950/60">
          <span className="block h-full w-full origin-left bg-amber-400" style={{ transform: `scaleX(${frac})` }} />
        </span>
      )}
    </button>
  );
}

export function NowPlayingLine({ item, nowHour, channelId }: { item: GridItem | null; nowHour: number; channelId?: string }) {
  if (!item) return null;
  const dur = (item.eHour - item.sHour) * 3600;
  const el = Math.min(dur, Math.max(0, (nowHour - item.sHour) * 3600));
  return (
    <div className="mt-0.5 pl-7 min-w-0" data-now-playing-line data-now-channel-id={channelId ?? item.program.channelId} data-now-program-id={item.program.id}>
      <div className="truncate text-[10px] font-semibold text-amber-300" title={item.program.title}>
        <Play className="mr-1 inline h-2.5 w-2.5 fill-current" aria-hidden />{item.program.title}
      </div>
      <div className="text-[10px] font-mono text-neutral-400 tabular-nums" style={{ fontVariantNumeric: "tabular-nums" }}>{fmtDur(el)} / {fmtDur(dur)}</div>
    </div>
  );
}

const ROW_PX = 44;
const OVERSCAN = 6;

export function TrackDrawer({ channel, block, guideId, nowHour, opener, onClose, onSelectProgram }: {
  channel: ScheduleChannel; block: GridBlock; guideId: string; nowHour: number;
  opener: HTMLElement | null; onClose: () => void; onSelectProgram?: PlayProgramCallback;
}) {
  // Keep the entire channel-day available; grouping never hides playable tracks.
  const items = useMemo(() => windowItems(channel), [channel]);
  const liveId = items.find(item => nowHour >= item.sHour && nowHour < item.eHour)?.program.id;
  const listRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(400);
  const [focusIdx, setFocusIdx] = useState(0);

  useLayoutEffect(() => {
    const el = listRef.current; if (!el) return;
    setViewH(el.clientHeight || 400);
    const target = block.liveProgramId ? items.findIndex(i => i.program.id === block.liveProgramId)
      : items.findIndex(i => i.index + 1 === block.first);
    if (target >= 0) { el.scrollTop = Math.max(0, target * ROW_PX - el.clientHeight / 2); setScrollTop(el.scrollTop); setFocusIdx(target); }
  }, [items, block]);
  useEffect(() => {
    closeRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; opener?.focus(); };
  }, [opener]);

  const start = Math.max(0, Math.floor(scrollTop / ROW_PX) - OVERSCAN);
  const end = Math.min(items.length, Math.ceil((scrollTop + viewH) / ROW_PX) + OVERSCAN);
  const slice = useMemo(() => items.slice(start, end), [items, start, end]);

  const play = (p: Program) => {
    onSelectProgram?.(p.archivePath || p.mediaUrl, p.title, channel.name, p.mediaType || channel.mediaType || (guideId === "audio-podcasts" ? "audio" : "video"), channel.id, p.guideId, p.id, p.sourceId ?? p.metadata?.sourceId, p.assetId ?? p.metadata?.assetId);
    onClose();
  };
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
    if (e.key === "Tab") {
      const f = Array.from((e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"])'));
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = Math.max(0, Math.min(items.length - 1, focusIdx + (e.key === "ArrowDown" ? 1 : -1)));
      setFocusIdx(n);
      const el = listRef.current;
      if (el) {
        if (n * ROW_PX < el.scrollTop) el.scrollTop = n * ROW_PX;
        else if ((n + 1) * ROW_PX > el.scrollTop + el.clientHeight) el.scrollTop = (n + 1) * ROW_PX - el.clientHeight;
        setScrollTop(el.scrollTop);
      }
      requestAnimationFrame(() => document.getElementById(`track-play-${channel.id}-${items[n].index}`)?.focus());
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50" onKeyDown={onKey}>
      <div className="absolute inset-0 bg-black/60" onClick={onClose} data-testid="drawer-backdrop" />
      <div role="dialog" aria-modal="true" aria-label={`${channel.name} tracks ${block.first} to ${block.last}`}
        data-testid="track-drawer"
         className="absolute flex flex-col border-neutral-800 bg-neutral-950 text-neutral-200 shadow-2xl bottom-0 inset-x-0 h-[75dvh] rounded-t-xl border-t min-[641px]:inset-x-auto min-[641px]:right-0 min-[641px]:top-0 min-[641px]:h-full min-[641px]:w-[420px] min-[641px]:rounded-none min-[641px]:border-l min-[641px]:border-t-0">
        <div className="flex items-start gap-3 border-b border-neutral-800 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-neutral-100">{channel.name}</div>
             <div className="text-[11px] text-neutral-400">{fmtClock(block.startHour)}–{fmtClock(block.endHour)} · tracks {block.first}-{block.last} of {block.total} · {block.trackCount} tracks · {Math.round(block.minutes)} min</div>
          </div>
          <button ref={closeRef} type="button" aria-label="Close track list" onClick={onClose}
            className="rounded p-1.5 text-neutral-300 hover:bg-neutral-800 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div ref={listRef} className="relative min-h-0 flex-1 overflow-y-auto" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} data-testid="track-list">
          {items.length === 0 && <p className="p-4 text-xs text-neutral-400">No tracks start in this hour. The previous track is still playing.</p>}
          <div style={{ height: items.length * ROW_PX, position: "relative" }} role="list">
            {slice.map((it, k) => {
              const i = start + k;
              const isLive = it.program.id === liveId;
              const { program: p } = it;
              return (
                <div key={`${p.id}-${it.index}`} role="listitem" data-track-id={p.id} data-track-program-id={p.id} aria-current={isLive ? "true" : undefined} data-live={isLive || undefined}
                  className={`absolute inset-x-0 flex items-center gap-2 border-b border-neutral-800/70 px-4 text-xs ${isLive ? "bg-amber-500/10" : ""}`}
                  style={{ top: i * ROW_PX, height: ROW_PX }}>
                  <span className="w-9 shrink-0 text-right font-mono tabular-nums text-neutral-500">{it.index + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate font-semibold ${isLive ? "text-amber-200" : "text-neutral-100"}`}>{p.title}</span>
                    <span className="block text-[10px] font-mono tabular-nums text-neutral-400">{fmtClock(it.sHour)} · {fmtDur((it.eHour - it.sHour) * 3600)}{isLive ? " · now playing" : ""}</span>
                  </span>
                  <button id={`track-play-${channel.id}-${it.index}`} type="button" tabIndex={i === focusIdx ? 0 : -1}
                    aria-label={`Play from here: ${p.title}`} onClick={() => play(p)}
                    className="flex shrink-0 items-center gap-1 rounded border border-neutral-700 px-2 py-1 text-[10px] text-neutral-200 hover:bg-neutral-800 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300">
                    <Play className="h-3 w-3 fill-current" aria-hidden />Play from here
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>, document.body
  );
}
