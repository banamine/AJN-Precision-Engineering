/* The 3D map. Spheres = parts of the app, lines = which part feeds which. Brightness comes from real readings only;
 * a dot (with its payload tag) travels a line only while the part at its start has a live signal. */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { EDGES, LOBES, NEURONS, layout } from '../neural/topology';
import type { Reading } from '../neural/telemetry';

interface Props { readings: Reading[]; selected: string | null; onSelect: (id: string | null) => void }
const lobeColor = new Map(LOBES.map((l) => [l.id, l.color]));

export function NeuralScene({ readings, selected, onSelect }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef({ readings, selected });
  live.current = { readings, selected };
  const pick = useRef(onSelect); pick.current = onSelect;

  useEffect(() => {
    const el = host.current; if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch { el.textContent = '3D view unavailable: this browser could not create a WebGL context. The list below has the same readings.'; return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    el.appendChild(renderer.domElement); renderer.domElement.style.display = 'block';
    const overlay = document.createElement('div'); overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
    el.appendChild(overlay);

    const scene = new THREE.Scene(); const root = new THREE.Group(); scene.add(root);
    const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 200); cam.position.set(0, 5, 21); cam.lookAt(0, 0, 0);
    const pos = layout(); const P = (id: string) => new THREE.Vector3(...pos[id]);

    const meshes = new Map<string, THREE.Mesh>();
    for (const n of NEURONS) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 16), new THREE.MeshBasicMaterial({ color: lobeColor.get(n.lobe), transparent: true, opacity: 0.35 }));
      m.position.copy(P(n.id)); m.userData.id = n.id; root.add(m); meshes.set(n.id, m);
    }
    const lines = EDGES.map((e) => {
      const g = new THREE.BufferGeometry().setFromPoints([P(e.from), P(e.to)]);
      const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.25 })); root.add(l); return l;
    });
    const dots = EDGES.map(() => { const d = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff })); d.visible = false; root.add(d); return d; });
    const tags = EDGES.map(() => { const t = document.createElement('div'); t.style.cssText = 'position:absolute;display:none;white-space:nowrap;font:600 10px ui-monospace,monospace;padding:2px 6px;border-radius:6px;background:rgba(2,6,23,.85);border:1px solid #334155;color:#e2e8f0'; overlay.appendChild(t); return t; });

    const resize = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h, false); renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%'; cam.aspect = w / Math.max(h, 1); cam.updateProjectionMatrix(); };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();

    // drag to rotate, click to select
    let down: { x: number; y: number } | null = null; let moved = 0;
    const dom = renderer.domElement;
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; moved = 0; dom.setPointerCapture(e.pointerId); };
    const onMove = (e: PointerEvent) => { if (!down) return; const dx = e.clientX - down.x, dy = e.clientY - down.y; moved += Math.abs(dx) + Math.abs(dy); root.rotation.y += dx * 0.005; root.rotation.x = Math.max(-0.9, Math.min(0.9, root.rotation.x + dy * 0.003)); down = { x: e.clientX, y: e.clientY }; };
    const ray = new THREE.Raycaster();
    const onUp = (e: PointerEvent) => {
      down = null; if (moved > 4) return;
      const r = dom.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), cam);
      const hit = ray.intersectObjects([...meshes.values()])[0];
      pick.current(hit ? (hit.object.userData.id as string) : null);
    };
    dom.addEventListener('pointerdown', onDown); dom.addEventListener('pointermove', onMove); dom.addEventListener('pointerup', onUp);

    let raf = 0; const v = new THREE.Vector3();
    const frame = (ms: number) => {
      raf = requestAnimationFrame(frame);
      const { readings: rs, selected: sel } = live.current;
      const by = new Map(rs.map((r) => [r.id, r]));
      for (const [id, m] of meshes) {
        const st = by.get(id)?.state; const mat = m.material as THREE.MeshBasicMaterial;
        mat.opacity = st === 'live' ? 1 : st === 'static' ? 0.7 : st === 'idle' ? 0.45 : 0.22;
        m.scale.setScalar(id === sel ? 1.7 : st === 'live' ? 1.25 : 1);
      }
      EDGES.forEach((e, i) => {
        const src = by.get(e.from); const isLive = src?.state === 'live' && !!src.payload;
        const touches = !!sel && (e.from === sel || e.to === sel);
        const lm = lines[i].material as THREE.LineBasicMaterial; lm.opacity = touches ? 0.9 : isLive ? 0.55 : 0.18; lm.color.set(touches ? 0xfde68a : 0x64748b);
        dots[i].visible = isLive;
        if (isLive) {
          const t = ((ms / 2600) + i * 0.137) % 1; dots[i].position.lerpVectors(P(e.from), P(e.to), t);
          v.copy(dots[i].position); root.localToWorld(v); v.project(cam);
          const tag = tags[i]; tag.style.display = v.z < 1 ? 'block' : 'none'; tag.textContent = src!.payload!;
          tag.style.transform = `translate(${((v.x + 1) / 2) * el.clientWidth + 8}px, ${((1 - v.y) / 2) * el.clientHeight - 8}px)`;
        } else tags[i].style.display = 'none';
      });
      renderer.render(scene, cam);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      dom.removeEventListener('pointerdown', onDown); dom.removeEventListener('pointermove', onMove); dom.removeEventListener('pointerup', onUp);
      scene.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); const mt = m.material as THREE.Material | undefined; mt?.dispose?.(); });
      renderer.dispose(); el.replaceChildren();
    };
  }, []);

  return <div ref={host} data-testid="neural-scene" className="relative h-[340px] w-full overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950" role="img" aria-label="3D map of the app. The list below has the same readings." />;
}
