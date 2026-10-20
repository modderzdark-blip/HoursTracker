import type { BufferGeometry } from 'three';
import {
  BufferAttribute,
  CylinderGeometry,
  IcosahedronGeometry,
  LatheGeometry,
  Vector2,
  Vector3,
} from 'three';
import { ImprovedNoise } from 'three/examples/jsm/math/ImprovedNoise.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mulberry32 } from '../../core/random';

/**
 * Sculpted environment shapes, built once per arena at load: noise-displaced rocks and cliffs,
 * chipped masonry blocks, fluted columns, stalagmites. Every shape carries a vertex `color`
 * that holds baked ambient occlusion (crevices and the ground contact are darker), so props sit
 * in the scene without a screen-space AO pass. Materials sample textures triplanar in world
 * space, so these geometries need no UVs.
 */

const perlin = new ImprovedNoise();

/** Fractal noise in about −1..1. */
export function fbm(x: number, y: number, z: number, octaves = 4, lac = 2.03, gain = 0.5): number {
  let a = 1;
  let f = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += a * perlin.noise(x * f, y * f, z * f);
    norm += a;
    a *= gain;
    f *= lac;
  }
  return sum / norm;
}

/** Ridged noise in 0..1 (sharp crests: rock strata, cliff ridges). */
export function ridged(x: number, y: number, z: number, octaves = 4): number {
  let a = 0.5;
  let f = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(perlin.noise(x * f, y * f, z * f) * 2);
    sum += a * n * n;
    norm += a;
    a *= 0.5;
    f *= 2.1;
  }
  return sum / norm;
}

function setAo(g: BufferGeometry, ao: Float32Array): void {
  const colors = new Float32Array(ao.length * 3);
  for (let i = 0; i < ao.length; i++) {
    const v = ao[i] ?? 1;
    colors[i * 3] = v;
    colors[i * 3 + 1] = v;
    colors[i * 3 + 2] = v;
  }
  g.setAttribute('color', new BufferAttribute(colors, 3));
}

/** Drops UVs so differently built parts can be merged (materials are triplanar). */
function stripToPositionNormal(g: BufferGeometry): BufferGeometry {
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'color') g.deleteAttribute(name);
  }
  return g;
}

/**
 * A boulder: icosphere displaced by fractal + ridged noise, flattened where it meets the ground,
 * with crevice AO. Unit size (about 1 m radius); scale per instance.
 */
export function rockGeometry(seed: number, detail = 4, sharpness = 1): BufferGeometry {
  const base = new IcosahedronGeometry(1, detail);
  base.deleteAttribute('uv');
  const g = mergeVertices(base);
  base.dispose();
  const pos = g.getAttribute('position');
  const ao = new Float32Array(pos.count);
  const v = new Vector3();
  const o = seed * 17.31;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const big = fbm(v.x * 1.1 + o, v.y * 1.1, v.z * 1.1 - o, 3);
    const strata = ridged(v.x * 2.4 + o, v.y * 5.5, v.z * 2.4, 3);
    const fine = fbm(v.x * 6 - o, v.y * 6, v.z * 6 + o, 2);
    const r = 1 + big * 0.32 + (strata - 0.5) * 0.22 * sharpness + fine * 0.05;
    // Squat, wide stones read as heavier.
    v.multiplyScalar(r);
    v.y *= 0.78;
    if (v.y < -0.35) v.y = -0.35 - (v.y + 0.35) * 0.15;
    pos.setXYZ(i, v.x, v.y, v.z);
    // Crevices (below the local average) and the base are darker.
    const crevice = Math.min(1, Math.max(0, 0.5 + (r - 1) * 2.2));
    const ground = Math.min(1, Math.max(0, (v.y + 0.4) / 0.6));
    ao[i] = 0.35 + 0.65 * Math.min(1, 0.45 + crevice * 0.55) * (0.55 + 0.45 * ground);
  }
  setAo(g, ao);
  g.computeVertexNormals();
  return g;
}

/**
 * A masonry block with rounded, chipped edges and a weathered face. Unit cube (1×1×1); scale
 * per instance. `seed` changes the chips.
 */
export function stoneBlockGeometry(seed: number): BufferGeometry {
  const box = new RoundedBoxGeometry(1, 1, 1, 2, 0.06);
  box.deleteAttribute('uv');
  const g = mergeVertices(box);
  box.dispose();
  const pos = g.getAttribute('position');
  const ao = new Float32Array(pos.count);
  const v = new Vector3();
  const o = seed * 9.7;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // Chip corners and edges more than faces.
    const corner =
      (Math.abs(v.x) > 0.42 ? 1 : 0) +
      (Math.abs(v.y) > 0.42 ? 1 : 0) +
      (Math.abs(v.z) > 0.42 ? 1 : 0);
    const n = fbm(v.x * 3 + o, v.y * 3, v.z * 3 - o, 3);
    const chip = corner >= 2 ? Math.max(0, n) * 0.11 : Math.max(0, n) * 0.025;
    const len = v.length() || 1;
    v.multiplyScalar(1 - chip / len);
    pos.setXYZ(i, v.x, v.y, v.z);
    ao[i] = 0.62 + 0.38 * Math.min(1, (v.y + 0.5) * 1.2) - (corner >= 2 ? chip * 2 : 0);
  }
  setAo(g, ao);
  g.computeVertexNormals();
  return g;
}

/**
 * A fluted column on a stepped base with a capital, in metres: `height` overall, shaft radius
 * `radius`. Base and capital keep their proportions at any height. `broken` snaps the shaft off
 * at a jagged angle (no capital).
 */
export function columnGeometry(
  seed: number,
  broken: boolean,
  height = 6,
  radius = 0.9,
): BufferGeometry {
  const rand = mulberry32(seed);
  const flutes = 16;
  const radial = flutes * 3;
  const baseH = radius * 0.34;
  const capH = broken ? 0 : radius * 0.3;
  const shaftH = Math.max(0.3, height - baseH - capH);
  const rings = Math.max(4, Math.round(shaftH * 1.5));
  const shaft = new CylinderGeometry(radius * 0.9, radius, shaftH, radial, rings, true);
  shaft.deleteAttribute('uv');
  shaft.translate(0, baseH + shaftH / 2, 0);
  const pos = shaft.getAttribute('position');
  const v = new Vector3();
  const ao = new Float32Array(pos.count);
  const top = baseH + shaftH;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const a = Math.atan2(v.z, v.x);
    const flute = Math.pow(Math.abs(Math.cos((a * flutes) / 2)), 0.6);
    const wear = fbm(v.x * 2 + seed, v.y * 1.5, v.z * 2, 3);
    const r = Math.hypot(v.x, v.z) * (0.95 + 0.05 * flute) * (1 + wear * 0.05);
    let y = v.y;
    if (broken && v.y > top - 0.01)
      y =
        top -
        0.15 -
        Math.abs(fbm(Math.cos(a) * 2 + seed, Math.sin(a) * 2, rand(), 3)) * radius * 0.8;
    pos.setXYZ(i, Math.cos(a) * r, y, Math.sin(a) * r);
    ao[i] = (0.6 + 0.4 * flute) * (0.65 + 0.35 * Math.min(1, (y - baseH) / 1.2 + 0.2));
  }
  setAo(shaft, ao);
  const parts: BufferGeometry[] = [stripToPositionNormal(shaft)];
  const R = radius;
  const base = new LatheGeometry(
    [
      new Vector2(0, 0),
      new Vector2(R * 1.42, 0),
      new Vector2(R * 1.42, baseH * 0.3),
      new Vector2(R * 1.26, baseH * 0.38),
      new Vector2(R * 1.26, baseH * 0.6),
      new Vector2(R * 1.1, baseH * 0.72),
      new Vector2(R * 1.04, baseH * 0.88),
      new Vector2(R, baseH),
    ],
    radial / 2,
  );
  base.deleteAttribute('uv');
  setAo(base, new Float32Array(base.getAttribute('position').count).fill(0.6));
  parts.push(stripToPositionNormal(base));
  if (!broken) {
    const cap = new LatheGeometry(
      [
        new Vector2(R * 0.9, 0),
        new Vector2(R * 1.0, capH * 0.15),
        new Vector2(R * 1.12, capH * 0.35),
        new Vector2(R * 1.3, capH * 0.5),
        new Vector2(R * 1.3, capH * 0.62),
        new Vector2(R * 1.45, capH * 0.66),
        new Vector2(R * 1.45, capH),
        new Vector2(0, capH),
      ],
      radial / 2,
    );
    cap.deleteAttribute('uv');
    cap.translate(0, top, 0);
    setAo(cap, new Float32Array(cap.getAttribute('position').count).fill(0.85));
    parts.push(stripToPositionNormal(cap));
  }
  for (const p of parts) p.computeVertexNormals();
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (merged === null) throw new Error('column merge failed');
  return merged;
}

/** A stalagmite / crystal-like spire: displaced cone, unit height. */
export function spireGeometry(seed: number): BufferGeometry {
  const g0 = new CylinderGeometry(0.04, 1, 1, 18, 14, false);
  g0.deleteAttribute('uv');
  const g = mergeVertices(g0);
  g0.dispose();
  g.translate(0, 0.5, 0);
  const pos = g.getAttribute('position');
  const v = new Vector3();
  const ao = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = fbm(v.x * 2.5 + seed, v.y * 4, v.z * 2.5, 3);
    const bend = fbm(seed, v.y * 1.2, 0, 2) * 0.25 * v.y;
    const k = 1 + n * 0.3;
    pos.setXYZ(i, v.x * k + bend, v.y, v.z * k);
    ao[i] = 0.45 + 0.55 * Math.min(1, v.y * 1.6) * (0.7 + 0.3 * (n + 0.5));
  }
  setAo(g, ao);
  g.computeVertexNormals();
  return g;
}

/**
 * A ring of cliffs around the arena (outside the wall): a tall band displaced by ridged noise
 * so its silhouette and faces read as rock. `radius` is the inner radius.
 */
export function cliffRingGeometry(
  radius: number,
  height: number,
  seed: number,
  segments = 160,
  rows = 22,
): BufferGeometry {
  const g = new CylinderGeometry(radius, radius * 1.15, height, segments, rows, true);
  g.deleteAttribute('uv');
  g.translate(0, height / 2, 0);
  const pos = g.getAttribute('position');
  const v = new Vector3();
  const ao = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const a = Math.atan2(v.z, v.x);
    const t = v.y / height;
    const cx = Math.cos(a) * 3;
    const cz = Math.sin(a) * 3;
    const crest = ridged(cx + seed, t * 2.2, cz, 4);
    const face = fbm(cx * 2 + seed, t * 6, cz * 2, 4);
    // Top edge is jagged; faces bulge in and out.
    const out = (face * 0.18 + crest * 0.12) * height * 0.35;
    const r = Math.hypot(v.x, v.z) + out;
    const y = v.y * (0.62 + crest * 0.55);
    pos.setXYZ(i, Math.cos(a) * r, y, Math.sin(a) * r);
    ao[i] = 0.3 + 0.7 * Math.min(1, 0.35 + t * 0.9) * (0.75 + face * 0.5);
  }
  setAo(g, ao);
  g.computeVertexNormals();
  // Faces point inward (the camera is inside the ring).
  const idx = g.getIndex();
  if (idx !== null) {
    for (let i = 0; i < idx.count; i += 3) {
      const b = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, b);
    }
    g.computeVertexNormals();
  }
  return g;
}

/** A crude bone (femur-like) for set dressing, unit length along X. */
export function boneGeometry(): BufferGeometry {
  const shaft = new CylinderGeometry(0.05, 0.05, 0.8, 8, 1, true);
  shaft.deleteAttribute('uv');
  shaft.rotateZ(Math.PI / 2);
  const parts: BufferGeometry[] = [stripToPositionNormal(shaft)];
  for (const sx of [-0.42, 0.42]) {
    for (const sz of [-0.05, 0.05]) {
      const knob0 = new IcosahedronGeometry(0.075, 1);
      knob0.deleteAttribute('uv');
      const knob = mergeVertices(knob0);
      knob0.dispose();
      knob.translate(sx, 0, sz);
      parts.push(stripToPositionNormal(knob));
    }
  }
  for (const p of parts) setAo(p, new Float32Array(p.getAttribute('position').count).fill(0.9));
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (merged === null) throw new Error('bone merge failed');
  merged.computeVertexNormals();
  return merged;
}

/** A skull: cranium + jaw + eye hollows (dark AO), about 0.25 m. */
export function skullGeometry(): BufferGeometry {
  const head0 = new IcosahedronGeometry(0.12, 3);
  head0.deleteAttribute('uv');
  const head = mergeVertices(head0);
  head0.dispose();
  const pos = head.getAttribute('position');
  const v = new Vector3();
  const ao = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    v.z *= 1.15;
    if (v.y < 0) v.multiplyScalar(0.92);
    // Eye sockets.
    let dark = 1;
    for (const ex of [-0.045, 0.045]) {
      const d = Math.hypot(v.x - ex, v.y - 0.0, v.z - 0.12);
      if (d < 0.045) {
        v.z -= (0.045 - d) * 0.9;
        dark = Math.min(dark, 0.25 + d * 12);
      }
    }
    pos.setXYZ(i, v.x, v.y, v.z);
    ao[i] = dark * (0.6 + 0.4 * Math.min(1, (v.y + 0.12) * 5));
  }
  setAo(head, ao);
  head.computeVertexNormals();
  const jaw0 = new RoundedBoxGeometry(0.15, 0.06, 0.12, 2, 0.02);
  jaw0.deleteAttribute('uv');
  const jaw = mergeVertices(jaw0);
  jaw0.dispose();
  jaw.translate(0, -0.11, 0.06);
  setAo(jaw, new Float32Array(jaw.getAttribute('position').count).fill(0.7));
  jaw.computeVertexNormals();
  const merged = mergeGeometries([stripToPositionNormal(head), stripToPositionNormal(jaw)], false);
  head.dispose();
  jaw.dispose();
  if (merged === null) throw new Error('skull merge failed');
  return merged;
}
