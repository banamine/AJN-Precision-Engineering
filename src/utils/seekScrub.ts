/* Seek-bar scrubbing without a network storm.
 * Dragging the bar fires an input event per pixel; assigning media.currentTime for each one makes the browser abort
 * and re-issue a Range request every ~100 ms, and every request costs Archive 1-19 s to the first byte
 * (measured on the live app). The scrubber keeps the position as a DRAFT while a drag is in progress and commits ONE
 * seek on release. Keyboard/other changes with no drag commit after a short quiet period. */
export interface Scrubber {
  /** pointer went down on the bar: hold commits until end() */
  begin(): void;
  /** the bar moved to this many seconds */
  update(seconds: number): void;
  /** pointer released/cancelled (or focus left): commit the draft now */
  end(): void;
  /** drop any pending draft without seeking (unmount, media change) */
  cancel(): void;
}
export function createScrubber(opts: {
  commit: (seconds: number) => void;
  onDraft?: (seconds: number | null) => void;
  quietMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}): Scrubber {
  const quiet = opts.quietMs ?? 300;
  const setT = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let draft: number | null = null; let dragging = false; let timer: unknown = null;
  const stop = () => { if (timer !== null) { clearT(timer); timer = null; } };
  const flush = () => {
    stop();
    if (draft === null) return;
    const s = draft; draft = null; opts.onDraft?.(null); opts.commit(s);
  };
  return {
    begin() { dragging = true; stop(); },
    update(seconds) {
      if (!Number.isFinite(seconds)) return;
      draft = Math.max(0, seconds); opts.onDraft?.(draft);
      if (!dragging) { stop(); timer = setT(() => { timer = null; flush(); }, quiet); }
    },
    end() { dragging = false; flush(); },
    cancel() { dragging = false; stop(); if (draft !== null) { draft = null; opts.onDraft?.(null); } },
  };
}
