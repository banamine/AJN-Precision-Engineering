/* Build 16: shows the PICTURE of the on-air deck when its file has video, otherwise the fallback (cover art / news slate).
 * The audio decks are never moved or touched: this only mirrors the current video frame onto a canvas (drawImage), so the crossfade,
 * the analyser and the engine behave exactly as before. A file with no video (mp3, radio) has videoWidth 0 and falls back. */
import { useEffect, useRef, useState, type ReactNode } from 'react';

const FRAME_MS = 33; // ~30 fps is plenty for a small corner view

export function containRect(vw: number, vh: number, cw: number, ch: number): { x: number; y: number; w: number; h: number } {
  if (vw <= 0 || vh <= 0 || cw <= 0 || ch <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  const s = Math.min(cw / vw, ch / vh);
  const w = vw * s, h = vh * s;
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
}

export default function DeckPicture({ getEl, fallback, onHasPicture }: { getEl: () => HTMLMediaElement | null; fallback: ReactNode; onHasPicture?: (has: boolean) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [has, setHas] = useState(false);
  const hasRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current; const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return undefined;
    let raf = 0; let last = 0;
    const tick = (t: number): void => {
      raf = window.requestAnimationFrame(tick);
      if (t - last < FRAME_MS) return;
      last = t;
      const el = getEl();
      const v = el instanceof HTMLVideoElement ? el : null;
      const ok = !!v && v.videoWidth > 0 && v.videoHeight > 0 && v.readyState >= 2;
      if (ok !== hasRef.current) { hasRef.current = ok; setHas(ok); onHasPicture?.(ok); }
      if (!ok || !v) return;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(canvas.clientWidth * ratio)), h = Math.max(1, Math.round(canvas.clientHeight * ratio));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
      const r = containRect(v.videoWidth, v.videoHeight, w, h);
      try { ctx.drawImage(v, r.x, r.y, r.w, r.h); } catch { /* frame not drawable yet: keep the last one */ }
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [getEl, onHasPicture]);

  return (
    <div className="dp-wrap" data-testid="deck-picture" data-has-picture={has ? 'yes' : 'no'}>
      <canvas ref={canvasRef} className="dp-canvas" style={{ display: has ? 'block' : 'none' }} aria-hidden="true" />
      {!has && <div className="dp-fallback">{fallback}</div>}
    </div>
  );
}
