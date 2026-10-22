/** Resume / Start Over prompt: visible for `visibleMs`, then fades for `fadeMs`, then hides. Returns a cancel function. */
export interface ResumePromptFadeOptions {
  visibleMs: number;
  fadeMs: number;
  onFade: () => void;
  onHide: () => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

export function scheduleResumePromptFade(opts: ResumePromptFadeOptions): () => void {
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let fadeId: unknown = null;
  let hideId: unknown = null;
  let cancelled = false;
  fadeId = setTimer(() => {
    if (cancelled) return;
    opts.onFade();
    hideId = setTimer(() => { if (!cancelled) opts.onHide(); }, opts.fadeMs);
  }, opts.visibleMs);
  return () => {
    cancelled = true;
    if (fadeId !== null) clearTimer(fadeId);
    if (hideId !== null) clearTimer(hideId);
  };
}
