import * as THREE from 'three';
import type { CubeArticle } from './adapter';

export interface CubePick {
  faceIndex: number;
  slotIndex: number;
}

export interface CubeRendererPort {
  render(): void;
  resize(width: number, height: number, pixelRatio: number): void;
  setFaceArticles(faceIndex: number, articles: readonly (CubeArticle | null)[]): void;
  prepareFace(faceIndex: number): void;
  getQuaternion(): THREE.Quaternion;
  targetQuaternion(faceIndex: number): THREE.Quaternion;
  setQuaternion(quaternion: THREE.Quaternion): void;
  rotateBy(deltaX: number, deltaY: number): void;
  nearestFace(): number;
  pick(clientX: number, clientY: number): CubePick | null;
  dispose(): void;
}

export type CubeRendererFactory = (canvas: HTMLCanvasElement) => CubeRendererPort;

const FACE_NORMALS = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1),
];

export function wrapText(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, width: number, lineHeight: number, maxLines: number): void {
  const words = value.split(/\s+/).filter(Boolean);
  let line = '';
  let lines = 0;
  outer: for (const word of words) {
    const pieces: string[] = [];
    let piece = '';
    for (const character of Array.from(word)) {
      if (piece && ctx.measureText(piece + character).width > width) {
        pieces.push(piece);
        piece = character;
      } else piece += character;
    }
    if (piece) pieces.push(piece);

    for (const part of pieces) {
      const next = line ? `${line} ${part}` : part;
      if (line && ctx.measureText(next).width > width) {
        ctx.fillText(line, x, y + lines * lineHeight, width);
        lines += 1;
        line = part;
        if (lines >= maxLines) break outer;
      } else line = next;
    }
  }
  if (lines < maxLines && line) ctx.fillText(line, x, y + lines * lineHeight, width);
}

function drawFaceCanvas(
  canvas: HTMLCanvasElement,
  faceIndex: number,
  articles: readonly (CubeArticle | null)[],
  images: Map<string, HTMLImageElement>,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#10151f';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#dbeafe';
  ctx.font = '600 26px system-ui, sans-serif';
  ctx.fillText(`FACE ${faceIndex + 1} · LATEST MATCHING`, 26, 36);
  const gap = 12;
  const header = 48;
  const cardWidth = (width - 4 * gap) / 3;
  const cardHeight = (height - header - 3 * gap) / 2;
  for (let slotIndex = 0; slotIndex < 6; slotIndex += 1) {
    const article = articles[slotIndex] ?? null;
    const col = slotIndex % 3;
    const row = Math.floor(slotIndex / 3);
    const x = gap + col * (cardWidth + gap);
    const y = header + gap + row * (cardHeight + gap);
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(x, y, cardWidth, cardHeight);
    ctx.strokeStyle = article ? '#475569' : '#334155';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, cardWidth, cardHeight);
    if (!article) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '500 20px system-ui, sans-serif';
      ctx.fillText('No article in this slot', x + 12, y + 30, cardWidth - 24);
      continue;
    }
    const image = images.get(article.id);
    let textTop = y + 22;
    if (image?.complete && image.naturalWidth > 0) {
      const imageHeight = cardHeight * 0.32;
      ctx.drawImage(image, x + 8, y + 8, cardWidth - 16, imageHeight);
      textTop += imageHeight;
    }
    ctx.fillStyle = '#93c5fd';
    ctx.font = '500 15px system-ui, sans-serif';
    wrapText(ctx, article.publisherName, x + 12, textTop, cardWidth - 24, 18, 2);
    ctx.fillStyle = '#f8fafc';
    ctx.font = '600 19px system-ui, sans-serif';
    wrapText(ctx, article.title, x + 12, textTop + 42, cardWidth - 24, 23, 3);
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '400 15px system-ui, sans-serif';
    wrapText(ctx, article.summary, x + 12, textTop + 116, cardWidth - 24, 18, 3);
  }
}

export function createThreeCubeRenderer(canvas: HTMLCanvasElement): CubeRendererPort {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#090d14');
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  camera.position.set(0, 0, 6.0); // face half-height 1.2 must fit: (6.0-1.2)*tan(17deg)=1.47
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor('#090d14', 1);
  const geometry = new THREE.BoxGeometry(2.4, 2.4, 2.4);
  const materials = Array.from({ length: 6 }, () => new THREE.MeshBasicMaterial({ color: '#243043' }));
  const cube = new THREE.Mesh(geometry, materials);
  scene.add(cube);
  const ambient = new THREE.AmbientLight('#ffffff', 1.15);
  scene.add(ambient);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const canvases = new Map<number, HTMLCanvasElement>();
  const textures = new Map<number, THREE.CanvasTexture>();
  const faceArticles = new Map<number, readonly (CubeArticle | null)[]>();
  const images = new Map<string, HTMLImageElement>();
  const imageUrls = new Map<string, string>();
  const prepared = new Set<number>();
  let disposed = false;

  const redraw = (faceIndex: number) => {
    if (disposed || !prepared.has(faceIndex)) return;
    let panel = canvases.get(faceIndex);
    if (!panel) {
      panel = document.createElement('canvas');
      panel.width = 768;
      panel.height = 768;
      canvases.set(faceIndex, panel);
    }
    const articles = faceArticles.get(faceIndex) ?? [];
    drawFaceCanvas(panel, faceIndex, articles, images);
    let texture = textures.get(faceIndex);
    if (!texture) {
      texture = new THREE.CanvasTexture(panel);
      texture.colorSpace = THREE.SRGBColorSpace;
      textures.set(faceIndex, texture);
    } else texture.needsUpdate = true;
    const material = materials[faceIndex];
    material.map = texture;
    material.color.set('#ffffff');
    material.needsUpdate = true;

    for (const article of articles) {
      if (!article?.imageUrl || imageUrls.get(article.id) === article.imageUrl) continue;
      imageUrls.set(article.id, article.imageUrl);
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => redraw(faceIndex);
      image.onerror = () => { images.delete(article.id); };
      images.set(article.id, image);
      image.src = article.imageUrl;
    }
  };

  return {
    render() {
      if (!disposed) renderer.render(scene, camera);
    },
    resize(width, height, pixelRatio) {
      if (disposed || width <= 0 || height <= 0) return;
      renderer.setPixelRatio(Math.min(2, Math.max(1, pixelRatio || 1)));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    setFaceArticles(faceIndex, articles) {
      faceArticles.set(faceIndex, articles.slice(0, 6));
      if (prepared.has(faceIndex)) redraw(faceIndex);
    },
    prepareFace(faceIndex) {
      if (faceIndex < 0 || faceIndex > 5 || prepared.has(faceIndex)) return;
      prepared.add(faceIndex);
      redraw(faceIndex);
    },
    getQuaternion() {
      return cube.quaternion.clone();
    },
    targetQuaternion(faceIndex) {
      return new THREE.Quaternion().setFromUnitVectors(FACE_NORMALS[faceIndex] ?? FACE_NORMALS[4], new THREE.Vector3(0, 0, 1));
    },
    setQuaternion(quaternion) {
      cube.quaternion.copy(quaternion);
    },
    rotateBy(deltaX, deltaY) {
      cube.rotation.y += deltaX;
      cube.rotation.x += deltaY;
    },
    nearestFace() {
      let bestFace = 4;
      let bestDot = -Infinity;
      FACE_NORMALS.forEach((normal, index) => {
        const transformed = normal.clone().applyQuaternion(cube.quaternion);
        if (transformed.z > bestDot) {
          bestDot = transformed.z;
          bestFace = index;
        }
      });
      return bestFace;
    },
    pick(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(cube, false)[0];
      if (!hit || hit.face?.materialIndex === undefined || !hit.uv) return null;
      const col = Math.min(2, Math.max(0, Math.floor(hit.uv.x * 3)));
      const row = Math.min(1, Math.max(0, Math.floor((1 - hit.uv.y) * 2)));
      return { faceIndex: hit.face.materialIndex, slotIndex: row * 3 + col };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const texture of textures.values()) texture.dispose();
      textures.clear();
      canvases.clear();
      for (const image of images.values()) {
        image.onload = null;
        image.onerror = null;
        image.src = '';
      }
      images.clear();
      imageUrls.clear();
      geometry.dispose();
      materials.forEach((material) => material.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      scene.clear();
    },
  };
}
