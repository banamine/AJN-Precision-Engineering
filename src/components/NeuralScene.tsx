/* The 3D map. Each part of the app is a badge (ring + glyph + name) on a sphere hit-target; lines = which part feeds which.
 * Brightness comes from real readings only. A payload tag sits under the name of a part that has a live signal (one per part);
 * a dot travels a line only while the part at its start has a live signal. Controls: wheel/pinch zoom, drag to orbit,
 * double-click or Reset to refit, Fit selection, Clear selection. Lobe filter and auto-orbit come in as props. */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { EDGES, LOBES, NEURONS, layout, type LobeId } from '../neural/topology';
import type { Reading } from '../neural/telemetry';
import { iconSvg } from '../neural/icons';
import { CAM_DIR, centerOf, clampZoom, depthT, fitDistance, liveTagSources, selectionBoundingPoints, type Vec3 } from '../neural/sceneMath';

interface Props { readings: Reading[]; selected: string | null; onSelect: (id: string | null) => void; lobe?: LobeId | 'all'; autoOrbit?: boolean }
const lobeColor = new Map(LOBES.map((l) => [l.id, l.color]));
const lobeOf = new Map(NEURONS.map((n) => [n.id, n.lobe]));
const ZOOM_MIN = 0.35, ZOOM_MAX = 2.5, FIT_PAD = 1.25; // room on the right for names

export function NeuralScene({ readings, selected, onSelect, lobe = 'all', autoOrbit = false }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef({ readings, selected, lobe, autoOrbit });
  live.current = { readings, selected, lobe, autoOrbit };
  const pick = useRef(onSelect); pick.current = onSelect;

  useEffect(() => {
    const el = host.current; if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch { el.textContent = '3D view unavailable: this browser could not create a WebGL context. The list below has the same readings.'; return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    el.appendChild(renderer.domElement);
    const dom = renderer.domElement; dom.style.display = 'block'; dom.style.touchAction = 'none';
    const overlay = document.createElement('div'); overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
    el.appendChild(overlay);

    const scene = new THREE.Scene(); const root = new THREE.Group(); scene.add(root);
    const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
    const pos = layout() as Record<string, Vec3>;
    const P = (id: string) => new THREE.Vector3(...pos[id]);
    const allPts = NEURONS.map((n) => pos[n.id]);
    const sphereR = Math.max(...allPts.map((p) => Math.hypot(...p)));

    // camera state: where it looks (target) and how far (dist); both ease toward their goals
    let fitted = fitDistance(allPts, cam.fov, 1, FIT_PAD);
    const goal = { target: new THREE.Vector3(...centerOf(allPts)), dist: fitted };
    const curT = goal.target.clone(); let curD = goal.dist;
    const home = () => { root.rotation.set(0, 0, 0); goal.target.set(...centerOf(allPts)); goal.dist = fitted; };

    // hit targets only: the badge is the picture
    const meshes = new Map<string, THREE.Mesh>();
    for (const n of NEURONS) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 10), new THREE.MeshBasicMaterial({ color: lobeColor.get(n.lobe), transparent: true, opacity: 0, depthWrite: false }));
      m.position.copy(P(n.id)); m.userData.id = n.id; root.add(m); meshes.set(n.id, m);
    }
    const lines = EDGES.map((e) => {
      const g = new THREE.BufferGeometry().setFromPoints([P(e.from), P(e.to)]);
      const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.25 })); root.add(l); return l;
    });
    const dots = EDGES.map(() => { const d = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff })); d.visible = false; root.add(d); return d; });

    // badges: ring + glyph + name (+ payload tag when live)
    const badges = new Map<string, { box: HTMLDivElement; ring: HTMLDivElement; label: HTMLSpanElement; tag: HTMLSpanElement }>();
    for (const n of NEURONS) {
      const col = lobeColor.get(n.lobe) ?? '#38bdf8';
      const box = document.createElement('div'); box.style.cssText = 'position:absolute;left:0;top:0;display:flex;align-items:center;gap:5px;transform-origin:left center;will-change:transform';
      const ring = document.createElement('div');
      ring.style.cssText = `width:26px;height:26px;border-radius:9999px;display:flex;align-items:center;justify-content:center;flex:none;border:1.5px solid ${col};color:${col};background:rgba(7,9,14,.88)`;
      ring.innerHTML = iconSvg(n.id, 14);
      const stack = document.createElement('div'); stack.style.cssText = 'display:flex;flex-direction:column;align-items:flex-start';
      const label = document.createElement('span'); label.textContent = n.label;
      label.style.cssText = `font:600 10px ui-sans-serif,system-ui,sans-serif;white-space:nowrap;color:${col};text-shadow:0 1px 4px rgba(0,0,0,.95)`;
      const tag = document.createElement('span');
      tag.style.cssText = 'display:none;margin-top:2px;white-space:nowrap;font:600 9px ui-monospace,monospace;padding:1px 5px;border-radius:5px;background:rgba(2,6,23,.9);border:1px solid rgba(56,189,248,.45);color:#e0f2fe';
      stack.append(label, tag); box.append(ring, stack); overlay.appendChild(box); badges.set(n.id, { box, ring, label, tag });
    }

    // view controls (bottom right)
    const bar = document.createElement('div'); bar.style.cssText = 'position:absolute;right:10px;bottom:10px;display:flex;gap:6px;pointer-events:auto';
    const mk = (text: string, label: string, run: () => void) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.setAttribute('aria-label', label); b.title = label;
      b.style.cssText = 'min-width:28px;height:28px;padding:0 8px;border-radius:6px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;font:600 11px ui-monospace,monospace;cursor:pointer';
      b.addEventListener('click', (ev) => { ev.stopPropagation(); run(); }); bar.appendChild(b); return b;
    };
    const zoomBy = (f: number) => { goal.dist = clampZoom(goal.dist * f, fitted * ZOOM_MIN, fitted * ZOOM_MAX); };
    mk('+', 'Zoom in', () => zoomBy(0.8)); mk('−', 'Zoom out', () => zoomBy(1.25));
    const fitBtn = mk('Fit', 'Fit selection', () => {
      const sel = live.current.selected; if (!sel) return;
      root.updateMatrixWorld(true);
      const w = selectionBoundingPoints(sel, EDGES, pos).map((p) => { const q = new THREE.Vector3(...p); root.localToWorld(q); return [q.x, q.y, q.z] as Vec3; });
      goal.target.set(...centerOf(w)); goal.dist = clampZoom(fitDistance(w, cam.fov, cam.aspect, 1.9), fitted * ZOOM_MIN, fitted * ZOOM_MAX);
    });
    mk('Reset', 'Reset view', home);
    const clearBtn = mk('Clear', 'Clear selection', () => { pick.current(null); home(); });
    overlay.appendChild(bar);

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight; if (!w || !h) return;
      renderer.setSize(w, h, false); dom.style.width = '100%'; dom.style.height = '100%'; cam.aspect = w / h; cam.updateProjectionMatrix();
      const f = fitDistance(allPts, cam.fov, cam.aspect, FIT_PAD); const ratio = f / fitted;
      goal.dist = clampZoom(goal.dist * ratio, f * ZOOM_MIN, f * ZOOM_MAX); curD *= ratio; fitted = f;
    };
    const ro = new ResizeObserver(resize); resize(); ro.observe(el);

    // pointers: one = orbit/select, two = pinch zoom
    const ptrs = new Map<number, { x: number; y: number }>(); let moved = 0; let pinch0 = 0; let zoom0 = 0; let dragging = false;
    const ray = new THREE.Raycaster();
    const onDown = (e: PointerEvent) => {
      dom.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0; dragging = true;
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); zoom0 = goal.dist; }
    };
    const onMove = (e: PointerEvent) => {
      const p = ptrs.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      if (ptrs.size >= 2) {
        const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); moved += 99;
        if (pinch0 > 10 && d > 10) goal.dist = clampZoom(zoom0 * (pinch0 / d), fitted * ZOOM_MIN, fitted * ZOOM_MAX);
        return;
      }
      moved += Math.abs(dx) + Math.abs(dy);
      root.rotation.y += dx * 0.005; root.rotation.x = Math.max(-0.9, Math.min(0.9, root.rotation.x + dy * 0.003));
    };
    const onUp = (e: PointerEvent) => {
      const wasOne = ptrs.size === 1; ptrs.delete(e.pointerId); if (!ptrs.size) dragging = false; if (ptrs.size < 2) pinch0 = 0;
      if (!wasOne || moved > 4) return;
      const r = dom.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), cam);
      const hit = ray.intersectObjects([...meshes.values()])[0];
      pick.current(hit ? (hit.object.userData.id as string) : null);
    };
    const onWheel = (e: WheelEvent) => { e.preventDefault(); zoomBy(1 + Math.max(-60, Math.min(60, e.deltaY)) * 0.0015); };
    dom.addEventListener('pointerdown', onDown); dom.addEventListener('pointermove', onMove); dom.addEventListener('pointerup', onUp); dom.addEventListener('pointercancel', onUp);
    dom.addEventListener('wheel', onWheel, { passive: false }); dom.addEventListener('dblclick', home);

    let raf = 0; let last = 0; let lastSel: string | null | undefined; const v = new THREE.Vector3(); const wv = new THREE.Vector3();
    const inLobe = (id: string, lb: LobeId | 'all') => lb === 'all' || lobeOf.get(id) === lb;
    const frame = (ms: number) => {
      raf = requestAnimationFrame(frame);
      const dt = last ? Math.min(ms - last, 64) : 16; last = ms;
      const { readings: rs, selected: sel, lobe: lb, autoOrbit: orbit } = live.current;
      const by = new Map(rs.map((r) => [r.id, r]));
      const tags = new Map(liveTagSources(rs).map((t) => [t.id, t.payload]));

      if (orbit && !dragging) root.rotation.y += 0.00012 * dt;
      const k = 1 - Math.pow(0.0025, dt / 1000);
      curT.lerp(goal.target, k); curD += (goal.dist - curD) * k;
      cam.position.set(curT.x + curD * CAM_DIR[0], curT.y + curD * CAM_DIR[1], curT.z + curD * CAM_DIR[2]); cam.lookAt(curT); cam.updateMatrixWorld();
      if (sel !== lastSel) { lastSel = sel; for (const b of [fitBtn, clearBtn]) { b.disabled = !sel; b.style.opacity = sel ? '1' : '0.4'; } }

      const cw = el.clientWidth, ch = el.clientHeight;
      for (const n of NEURONS) {
        const b = badges.get(n.id)!; const st = by.get(n.id)?.state; const isSel = n.id === sel; const dim = inLobe(n.id, lb) ? 1 : 0.15;
        wv.set(...pos[n.id]); root.localToWorld(wv); const dist = wv.distanceTo(cam.position); v.copy(wv).project(cam);
        if (v.z >= 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) { b.box.style.display = 'none'; continue; }
        const depth = 1 - 0.55 * depthT(dist, curD, sphereR);
        const focus = lb !== 'all' && dim === 1; // a focused group stays readable even where a part has no signal
        const stateOp = st === 'live' ? 1 : st === 'static' ? 0.8 : st === 'idle' ? 0.6 : focus ? 0.75 : 0.34;
        b.box.style.display = 'flex';
        b.box.style.transform = `translate(${((v.x + 1) / 2) * cw - 13}px, ${((1 - v.y) / 2) * ch - 13}px) scale(${isSel ? 1.25 : 0.8 + 0.2 * depth})`;
        b.box.style.opacity = String(Math.max(0.12, (isSel ? 1 : focus ? Math.max(0.75, stateOp) : stateOp * Math.max(0.45, depth)) * dim));
        b.box.style.zIndex = String(Math.round(depth * 100) + (isSel ? 200 : 0));
        b.ring.style.borderStyle = st === 'unwired' ? 'dashed' : 'solid'; b.ring.style.boxShadow = st === 'live' ? `0 0 10px ${lobeColor.get(n.lobe)}` : 'none';
        b.label.style.display = isSel || focus || st === 'live' || depth > 0.62 ? 'block' : 'none';
        const payload = tags.get(n.id); b.tag.style.display = payload ? 'block' : 'none'; if (payload && b.tag.textContent !== payload) b.tag.textContent = payload;
      }
      EDGES.forEach((e, i) => {
        const src = by.get(e.from); const isLive = src?.state === 'live' && !!src.payload;
        const touches = !!sel && (e.from === sel || e.to === sel);
        const near = inLobe(e.from, lb) || inLobe(e.to, lb);
        const lm = lines[i].material as THREE.LineBasicMaterial; lm.opacity = (touches ? 0.9 : isLive ? 0.55 : 0.18) * (near ? 1 : 0.15); lm.color.set(touches ? 0xfde68a : 0x64748b);
        dots[i].visible = isLive && near;
        if (isLive) dots[i].position.lerpVectors(P(e.from), P(e.to), ((ms / 2600) + i * 0.137) % 1);
      });
      renderer.render(scene, cam);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      dom.removeEventListener('pointerdown', onDown); dom.removeEventListener('pointermove', onMove); dom.removeEventListener('pointerup', onUp); dom.removeEventListener('pointercancel', onUp);
      dom.removeEventListener('wheel', onWheel); dom.removeEventListener('dblclick', home);
      scene.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); const mt = m.material as THREE.Material | undefined; mt?.dispose?.(); });
      renderer.dispose(); el.replaceChildren();
    };
  }, []);

  return <div ref={host} data-testid="neural-scene" className="relative h-[460px] w-full overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950 md:h-[580px]" role="img" aria-label="3D map of the app. The list below has the same readings." />;
}
