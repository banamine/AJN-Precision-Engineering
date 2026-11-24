/* The stage fills its box edge to edge at any shape. Layout runs in a virtual space that has the same shape as the box and
 * a short side of 1080 (tall boxes: 1920 wide) so fonts keep their 16:9 proportions; CSS --u = min(width/1920, height/1080) scales it to pixels. */
export interface StageSize { w: number; h: number }
const WIDE = 16 / 9;
export function stageVirtualSize(boxW: number, boxH: number): StageSize {
  if (!(boxW > 0) || !(boxH > 0)) return { w: 1920, h: 1080 };
  const aspect = Math.min(4, Math.max(0.9, boxW / boxH));         // clamp absurd shapes
  return aspect >= WIDE ? { w: Math.round(1080 * aspect), h: 1080 } : { w: 1920, h: Math.round(1920 / aspect) };
}
