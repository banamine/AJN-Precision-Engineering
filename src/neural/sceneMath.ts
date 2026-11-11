/* Neural Twin scene math. Pure functions: no three.js, no DOM, no telemetry, nothing random.
 * The scene feeds these real positions and real readings; they only measure and select. */
import type { Edge, LobeId, Neuron } from './topology';
import type { Reading } from './telemetry';

export type Vec3 = [number, number, number];

/** The camera sits at target + d * CAM_DIR, looking at the target (a slight look-down). Keep scene and math on the same direction. */
export const CAM_DIR: Vec3 = (() => { const y = 0.22, n = Math.hypot(y, 1); return [0, y / n, 1 / n] as Vec3; })();

/** Camera distance so the points, as the camera actually sees them (width and height separately), fill the view with `pad` breathing room.
 *  Exact for a camera at c + d*CAM_DIR looking at c, with c the centre of the points' bounding box. */
export function fitDistance(points: Vec3[], fovDeg: number, aspect: number, pad = 1.15): number {
  if (!points.length) return 40;
  const c = centerOf(points);
  const tv = Math.tan((fovDeg * Math.PI) / 360), th = tv * Math.max(aspect, 0.1);
  const u = CAM_DIR, up: Vec3 = [0, u[2], -u[1]]; // camera right = +x
  let d = 0;
  for (const p of points) {
    const q: Vec3 = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    const x = Math.abs(q[0]), y = Math.abs(q[1] * up[1] + q[2] * up[2]), along = q[0] * u[0] + q[1] * u[1] + q[2] * u[2];
    d = Math.max(d, (x * pad) / th + along, (y * pad) / tv + along);
  }
  return Math.max(d, (2.2 * pad) / Math.min(tv, th)); // a lone node still gets a sensible frame
}

export function centerOf(points: Vec3[]): Vec3 {
  if (!points.length) return [0, 0, 0];
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points) for (let i = 0; i < 3; i += 1) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
  return [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
}

export function clampZoom(d: number, min: number, max: number): number { return Math.min(max, Math.max(min, d)); }

/** One { id, payload } per node whose reading is live AND carries a payload. One tag per node, never per edge or dot. */
export function liveTagSources(readings: Pick<Reading, 'id' | 'state' | 'payload'>[]): { id: string; payload: string }[] {
  return readings.filter((r) => r.state === 'live' && !!r.payload).map((r) => ({ id: r.id, payload: r.payload as string }));
}

export interface NodeEdge { otherId: string; isSource: boolean; kind: string }
/** Every edge that touches a node: where it goes or comes from, and its kind. */
export function nodeEdges(nodeId: string, edges: Edge[]): NodeEdge[] {
  const out: NodeEdge[] = [];
  for (const e of edges) {
    if (e.from === nodeId) out.push({ otherId: e.to, isSource: true, kind: e.kind });
    else if (e.to === nodeId) out.push({ otherId: e.from, isSource: false, kind: e.kind });
  }
  return out;
}

/** The neurons in a lobe; every neuron for 'all'. */
export function lobeNodes(lobeId: LobeId | 'all', nodes: Neuron[]): Neuron[] {
  return lobeId === 'all' ? nodes : nodes.filter((n) => n.lobe === lobeId);
}

/** Positions of a node and its direct neighbours, for framing the camera on them. */
export function selectionBoundingPoints(nodeId: string, edges: Edge[], pos: Record<string, Vec3>): Vec3[] {
  const ids = new Set<string>([nodeId]);
  for (const e of nodeEdges(nodeId, edges)) ids.add(e.otherId);
  return [...ids].map((id) => pos[id]).filter((p): p is Vec3 => !!p);
}

/** Depth 0 (nearest) .. 1 (farthest) of a point's distance from the camera, within a sphere of radius r at distance d. */
export function depthT(dist: number, d: number, r: number): number {
  return clampZoom((dist - (d - r)) / (2 * r || 1), 0, 1);
}
