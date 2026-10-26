import {
  BufferAttribute,
  BufferGeometry,
  Euler,
  IcosahedronGeometry,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fbm } from './shapes';

/**
 * Small ground clutter, instanced in the thousands (one InstancedMesh per kind): pebbles, broken
 * tile shards, ash / leaf flakes and dead-weed tufts. Geometries are tiny (8–20 triangles) and
 * carry baked occlusion in vertex colours like the larger shapes.
 */

function aoColor(g: BufferGeometry, fn: (y: number) => number): void {
  const pos = g.getAttribute('position');
  const c = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) c.fill(fn(pos.getY(i)), i * 3, i * 3 + 3);
  g.setAttribute('color', new BufferAttribute(c, 3));
}

/** A pebble: a squashed, lumpy icosahedron (20 triangles), unit radius. */
export function pebbleGeometry(seed: number): BufferGeometry {
  const base = new IcosahedronGeometry(1, 0);
  base.deleteAttribute('uv');
  const g = mergeVertices(base);
  base.dispose();
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = 1 + fbm(x * 1.7 + seed, y * 1.7, z * 1.7, 2) * 0.5;
    pos.setXYZ(i, x * k, Math.max(-0.25, y * 0.55 * k), z * k);
  }
  aoColor(g, (y) => 0.55 + 0.45 * Math.min(1, Math.max(0, (y + 0.25) / 0.7)));
  g.computeVertexNormals();
  return g;
}

/** A broken tile shard: an irregular flat slab with chipped corners, unit width. */
export function shardGeometry(seed: number): BufferGeometry {
  const n = 5;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + fbm(seed, i, 0, 1) * 0.6;
    const r = 0.5 * (0.7 + 0.3 * Math.abs(fbm(i * 1.3, seed, 1, 2) * 2));
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  const h = 0.12;
  const pos: number[] = [];
  for (const [x, z] of pts) pos.push(x, h, z);
  for (const [x, z] of pts) pos.push(x * 1.04, 0, z * 1.04);
  const index: number[] = [];
  for (let i = 1; i < n - 1; i++) index.push(0, i + 1, i);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    index.push(i, j, n + i, j, n + j, n + i);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(index);
  const flat = g.toNonIndexed();
  g.dispose();
  flat.computeVertexNormals();
  aoColor(flat, (y) => (y > 0.06 ? 0.95 : 0.6));
  return flat;
}

/**
 * A dead-weed tuft: five bent blades fanning out from a point (two triangles each, drawn
 * double-sided), unit height.
 */
export function tuftGeometry(seed: number): BufferGeometry {
  const pos: number[] = [];
  const blades = 5;
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + fbm(seed, b, 0, 1);
    const lean = 0.25 + 0.35 * ((b * 0.37 + seed * 0.13) % 1);
    const h = 0.6 + 0.4 * ((b * 0.61 + seed * 0.29) % 1);
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const w = 0.06;
    const px = -dz * w;
    const pz = dx * w;
    const mx = dx * lean * 0.5;
    const mz = dz * lean * 0.5;
    const tx = dx * lean;
    const tz = dz * lean;
    pos.push(-px, 0, -pz, px, 0, pz, mx + px * 0.6, h * 0.55, mz + pz * 0.6);
    pos.push(
      -px,
      0,
      -pz,
      mx + px * 0.6,
      h * 0.55,
      mz + pz * 0.6,
      mx - px * 0.6,
      h * 0.55,
      mz - pz * 0.6,
    );
    pos.push(
      mx - px * 0.6,
      h * 0.55,
      mz - pz * 0.6,
      mx + px * 0.6,
      h * 0.55,
      mz + pz * 0.6,
      tx,
      h,
      tz,
    );
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  // Blades point up for lighting (a soft, grass-like shade rather than facet normals).
  const nor = g.getAttribute('normal');
  for (let i = 0; i < nor.count; i++) {
    const v = new Vector3(nor.getX(i) * 0.4, 1, nor.getZ(i) * 0.4).normalize();
    nor.setXYZ(i, v.x, v.y, v.z);
  }
  aoColor(g, (y) => 0.35 + 0.65 * Math.min(1, y));
  return g;
}

/** An ash / leaf flake: a small flat irregular quad just above the floor, unit size. */
export function flakeGeometry(): BufferGeometry {
  const g = new BufferGeometry();
  const pos = [-0.5, 0.01, -0.3, 0.45, 0.01, -0.45, 0.5, 0.012, 0.35, -0.4, 0.01, 0.5];
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  g.setAttribute(
    'normal',
    new BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3),
  );
  aoColor(g, () => 1);
  return g;
}

/** Where clutter may go: a ring of the arena clear of the fight centre and of keep-out circles. */
export interface ScatterOptions {
  readonly count: number;
  /** Nothing inside this radius (the central fight area stays clean for telegraphs). */
  readonly clearRadius: number;
  readonly maxRadius: number;
  readonly keepOut: readonly (readonly [number, number, number])[];
  readonly rand: () => number;
  readonly scale: readonly [number, number];
  /** Random tilt (radians) away from upright. */
  readonly tilt: number;
  /** Lift above the floor per unit of scale. */
  readonly lift: number;
  /** Weight toward the wall: 1 = uniform by area, higher = more near maxRadius. */
  readonly edgeBias: number;
}

/** Instance matrices for one clutter kind (positions honour the clear radius and keep-outs). */
export function scatter(o: ScatterOptions): Matrix4[] {
  const out: Matrix4[] = [];
  const e = new Euler();
  const q = new Quaternion();
  const p = new Vector3();
  const s = new Vector3();
  let tries = 0;
  while (out.length < o.count && tries++ < o.count * 6) {
    const a = o.rand() * Math.PI * 2;
    const t = Math.pow(o.rand(), 1 / (1 + o.edgeBias));
    const r = Math.sqrt(o.clearRadius ** 2 + t * (o.maxRadius ** 2 - o.clearRadius ** 2));
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (o.keepOut.some(([kx, kz, kr]) => (x - kx) ** 2 + (z - kz) ** 2 < kr * kr)) continue;
    const k = o.scale[0] + o.rand() * o.rand() * (o.scale[1] - o.scale[0]);
    e.set((o.rand() - 0.5) * o.tilt, o.rand() * Math.PI * 2, (o.rand() - 0.5) * o.tilt);
    q.setFromEuler(e);
    p.set(x, k * o.lift, z);
    s.set(k * (0.8 + o.rand() * 0.4), k, k * (0.8 + o.rand() * 0.4));
    out.push(new Matrix4().compose(p, q, s));
  }
  return out;
}
