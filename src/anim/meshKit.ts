import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  Euler,
  Matrix4,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Surface of a part: colour (sRGB hex), roughness and metalness (per vertex, see rig shader). */
export interface Surf {
  readonly color: number;
  readonly rough: number;
  readonly metal: number;
}

/** Bone influences of one vertex: [bone index, weight] pairs (normalised on write). */
export type Influences = [number, number][];
export type WeightFn = (p: Vector3, out: Influences) => void;

const KEEP = new Set(['position', 'normal', 'uv']);

/**
 * Collects skinned parts in rig bind space and merges them into one geometry (one draw call).
 * Each vertex carries colour, roughness/metalness (`surf`) and up to 4 bone influences, so
 * joints can bend smoothly instead of each part following a single bone.
 */
export class SkinBuilder {
  private readonly parts: BufferGeometry[] = [];
  private readonly c = new Color();
  private readonly v = new Vector3();
  private readonly inf: Influences = [];

  /**
   * @param withSurf write the per-vertex roughness/metalness attribute (lit body mesh)
   * @param lift multiplier on the linear colour (capped at 1), see CHARACTER_CONFIG.albedoLift
   */
  constructor(
    private readonly withSurf: boolean,
    private readonly lift = 1,
  ) {}

  get count(): number {
    return this.parts.length;
  }

  add(geo: BufferGeometry, surf: Surf | ((p: Vector3) => Surf), weigh: WeightFn): void {
    let g = geo;
    for (const name of Object.keys(g.attributes)) if (!KEEP.has(name)) g.deleteAttribute(name);
    if (g.getAttribute('uv') === undefined) {
      const n = g.getAttribute('position').count;
      g.setAttribute('uv', new BufferAttribute(new Float32Array(n * 2), 2));
    }
    if (g.getAttribute('normal') === undefined) g.computeVertexNormals();
    g.clearGroups();
    if (g.index === null) {
      const merged = mergeVertices(g, 1e-5);
      if (merged !== g) g.dispose();
      g = merged;
    }
    const pos = g.getAttribute('position');
    const n = pos.count;
    const colors = new Float32Array(n * 3);
    const surfs = new Float32Array(n * 2);
    const idx = new Uint16Array(n * 4);
    const w = new Float32Array(n * 4);
    const fixed = typeof surf === 'function' ? null : surf;
    const lift = (): void => {
      this.c.setRGB(
        Math.min(1, this.c.r * this.lift),
        Math.min(1, this.c.g * this.lift),
        Math.min(1, this.c.b * this.lift),
      );
    };
    if (fixed !== null) {
      this.c.setHex(fixed.color).convertSRGBToLinear();
      lift();
    }
    for (let i = 0; i < n; i++) {
      this.v.fromBufferAttribute(pos, i);
      const s = fixed ?? (surf as (p: Vector3) => Surf)(this.v);
      if (fixed === null) {
        this.c.setHex(s.color).convertSRGBToLinear();
        lift();
      }
      colors[i * 3] = this.c.r;
      colors[i * 3 + 1] = this.c.g;
      colors[i * 3 + 2] = this.c.b;
      surfs[i * 2] = s.rough;
      surfs[i * 2 + 1] = s.metal;
      this.inf.length = 0;
      weigh(this.v, this.inf);
      writeInfluences(this.inf, idx, w, i);
    }
    g.setAttribute('color', new BufferAttribute(colors, 3));
    if (this.withSurf) g.setAttribute('surf', new BufferAttribute(surfs, 2));
    g.setAttribute('skinIndex', new BufferAttribute(idx, 4));
    g.setAttribute('skinWeight', new BufferAttribute(w, 4));
    this.parts.push(g);
  }

  build(): BufferGeometry {
    const out = mergeGeometries(this.parts, false);
    for (const g of this.parts) g.dispose();
    this.parts.length = 0;
    return out;
  }
}

/** Keeps the 4 largest influences, merges duplicates and normalises. */
function writeInfluences(inf: Influences, idx: Uint16Array, w: Float32Array, i: number): void {
  const merged = new Map<number, number>();
  for (const [b, wt] of inf) if (wt > 0) merged.set(b, (merged.get(b) ?? 0) + wt);
  const list = [...merged.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  let sum = 0;
  for (const [, wt] of list) sum += wt;
  for (let k = 0; k < 4; k++) {
    const e = list[k];
    idx[i * 4 + k] = e?.[0] ?? 0;
    w[i * 4 + k] = e === undefined || sum <= 0 ? (k === 0 && sum <= 0 ? 1 : 0) : e[1] / sum;
  }
}

// ------------------------------------------------------------------ transforms

const tm = new Matrix4();
const tq = new Quaternion();
const te = new Euler();
const ts = new Vector3();
const tt = new Vector3();

/** Rotates (XYZ Euler, radians), scales, then translates a geometry in place. */
export function place(
  g: BufferGeometry,
  at: readonly [number, number, number] | Vector3,
  rot: readonly [number, number, number] = [0, 0, 0],
  scale: readonly [number, number, number] = [1, 1, 1],
): BufferGeometry {
  te.set(rot[0], rot[1], rot[2]);
  tq.setFromEuler(te);
  ts.set(scale[0], scale[1], scale[2]);
  if (at instanceof Vector3) tt.copy(at);
  else tt.set(at[0], at[1], at[2]);
  tm.compose(tt, tq, ts);
  g.applyMatrix4(tm);
  return g;
}

// ------------------------------------------------------------------ shapes

export interface Ring {
  readonly y: number;
  readonly rx: number;
  readonly rz: number;
  /** Offset of the ring centre (forward = +z). */
  readonly ox?: number;
  readonly oz?: number;
}

/**
 * Closed smooth surface through elliptical rings stacked top → bottom (any order of y works as
 * long as it is monotonic). Poles close both ends. Used for torsos, limbs, robes, horns.
 */
export function loft(
  rings: readonly Ring[],
  radial = 12,
  closeTop = true,
  closeBottom = true,
): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  const n = rings.length;
  for (let r = 0; r < n; r++) {
    const ring = rings[r];
    if (ring === undefined) continue;
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      pos.push(
        (ring.ox ?? 0) + Math.sin(a) * ring.rx,
        ring.y,
        (ring.oz ?? 0) + Math.cos(a) * ring.rz,
      );
      uv.push(j / radial, r / Math.max(1, n - 1));
    }
  }
  for (let r = 0; r < n - 1; r++) {
    for (let j = 0; j < radial; j++) {
      const a = r * radial + j;
      const b = r * radial + ((j + 1) % radial);
      const c = (r + 1) * radial + j;
      const d = (r + 1) * radial + ((j + 1) % radial);
      // Rings go top → bottom; winding chosen so normals face outward.
      index.push(a, c, b, b, c, d);
    }
  }
  const first = rings[0];
  const last = rings[n - 1];
  if (closeTop && first !== undefined) {
    const p = pos.length / 3;
    pos.push(first.ox ?? 0, first.y + (first.y >= (last?.y ?? 0) ? 0.001 : -0.001), first.oz ?? 0);
    uv.push(0.5, 0);
    for (let j = 0; j < radial; j++) index.push(p, j, (j + 1) % radial);
  }
  if (closeBottom && last !== undefined) {
    const p = pos.length / 3;
    const base = (n - 1) * radial;
    pos.push(last.ox ?? 0, last.y, last.oz ?? 0);
    uv.push(0.5, 1);
    for (let j = 0; j < radial; j++) index.push(p, base + ((j + 1) % radial), base + j);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/**
 * A limb segment hanging from (x, yTop, z) down to yBot with radius profile `prof(t)`
 * (t: 0 at the top joint → 1 at the bottom joint), returning [rx, rz, ox?, oz?].
 */
export function limb(
  x: number,
  z: number,
  yTop: number,
  yBot: number,
  prof: (t: number) => readonly [number, number, number?, number?],
  rings = 9,
  radial = 12,
): BufferGeometry {
  const list: Ring[] = [];
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    const [rx, rz, ox, oz] = prof(t);
    list.push({ y: yTop + (yBot - yTop) * t, rx, rz, ox: x + (ox ?? 0), oz: z + (oz ?? 0) });
  }
  return loft(list, radial);
}

/** Ellipsoid (or a slice of one) centred at `c`. */
export function ellipsoid(
  c: readonly [number, number, number],
  r: readonly [number, number, number],
  seg: readonly [number, number] = [12, 8],
  slice?: {
    phiStart?: number;
    phiLength?: number;
    thetaStart?: number;
    thetaLength?: number;
  },
  rot: readonly [number, number, number] = [0, 0, 0],
): BufferGeometry {
  const g = new SphereGeometry(
    1,
    seg[0],
    seg[1],
    slice?.phiStart ?? 0,
    slice?.phiLength ?? Math.PI * 2,
    slice?.thetaStart ?? 0,
    slice?.thetaLength ?? Math.PI,
  );
  return place(g, c, rot, r);
}

/**
 * Cloth panel hanging down -Y from its top edge at the origin: `width` wide, `length` long,
 * curved around the body by `curve` (metres, + = toward -Z), tapered to `taper` × width at the
 * hem, optionally ragged. Two-sided (front and back faces) so no double-sided material is needed.
 */
export function clothPanel(
  width: number,
  length: number,
  cols: number,
  rows: number,
  opts: {
    curve?: number;
    taper?: number;
    tattered?: boolean;
    thickness?: number;
    seed?: number;
  } = {},
): BufferGeometry {
  const curve = opts.curve ?? 0;
  const taper = opts.taper ?? 1;
  const th = opts.thickness ?? 0.012;
  let seed = opts.seed ?? 7;
  const rnd = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const front: number[] = [];
  const uv: number[] = [];
  for (let r = 0; r <= rows; r++) {
    const v = r / rows;
    const w = width * (1 + (taper - 1) * v);
    for (let c = 0; c <= cols; c++) {
      const u = c / cols;
      const x = (u - 0.5) * w;
      let y = -length * v;
      if (opts.tattered === true && r === rows) y += rnd() * length * 0.16;
      const k = (2 * x) / Math.max(1e-3, w);
      const z = -curve * (1 - k * k);
      front.push(x, y, z);
      uv.push(u, v);
    }
  }
  const stride = cols + 1;
  const vertsPerSide = front.length / 3;
  const pos = new Float32Array(vertsPerSide * 6);
  pos.set(front, 0);
  // Back side: same points pushed back by the thickness.
  for (let i = 0; i < vertsPerSide; i++) {
    pos[(vertsPerSide + i) * 3] = front[i * 3] ?? 0;
    pos[(vertsPerSide + i) * 3 + 1] = front[i * 3 + 1] ?? 0;
    pos[(vertsPerSide + i) * 3 + 2] = (front[i * 3 + 2] ?? 0) - th;
  }
  const index: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * stride + c;
      const b = a + 1;
      const d = a + stride;
      const e = d + 1;
      // Front faces +Z, back faces −Z.
      index.push(a, d, b, b, d, e);
      const o = vertsPerSide;
      index.push(o + a, o + b, o + d, o + b, o + e, o + d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array([...uv, ...uv]), 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ weights

export function smooth01(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Tapered tube swept along a smooth curve through `points` (horns, tails, spars), radius
 * `radius(t)` with t 0 → 1 from the first point to the last. The end is closed with a pole.
 */
export function sweep(
  points: readonly Vector3[],
  radius: (t: number) => number,
  segments = 12,
  radial = 8,
): BufferGeometry {
  const curve = new CatmullRomCurve3([...points]);
  const frames = curve.computeFrenetFrames(segments, false);
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  const p = new Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPointAt(t, p);
    const n = frames.normals[i];
    const b = frames.binormals[i];
    if (n === undefined || b === undefined) continue;
    const r = radius(t);
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const c = Math.cos(a) * r;
      const s = Math.sin(a) * r;
      pos.push(p.x + c * n.x + s * b.x, p.y + c * n.y + s * b.y, p.z + c * n.z + s * b.z);
      uv.push(j / radial, t);
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j;
      const b = i * radial + ((j + 1) % radial);
      const c = (i + 1) * radial + j;
      const d = (i + 1) * radial + ((j + 1) % radial);
      index.push(a, b, c, b, d, c);
    }
  }
  const end = curve.getPointAt(1);
  const pole = pos.length / 3;
  pos.push(end.x, end.y, end.z);
  uv.push(0.5, 1);
  const base = segments * radial;
  for (let j = 0; j < radial; j++) index.push(base + j, base + ((j + 1) % radial), pole);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** Same surface facing the other way (inside of hoods, capes seen from within). */
export function flipFaces(g: BufferGeometry): BufferGeometry {
  const index = g.getIndex();
  if (index !== null) {
    const a = index.array;
    for (let i = 0; i < a.length; i += 3) {
      const t = a[i + 1] ?? 0;
      a[i + 1] = a[i + 2] ?? 0;
      a[i + 2] = t;
    }
    index.needsUpdate = true;
  }
  const n = g.getAttribute('normal');
  if (n !== undefined) {
    for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
    n.needsUpdate = true;
  }
  return g;
}

export interface ArcRing extends Ring {
  /** Half-width (radians) of the opening at the front (+Z); 0 = closed ring. */
  readonly open: number;
}

/**
 * Open surface through stacked rings (top → bottom) that leaves a window at the front, e.g. a
 * hood around the face. No caps; pair with `flipFaces` of a slightly smaller copy for a lining.
 */
export function arcLoft(rings: readonly ArcRing[], samples = 16): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  const n = rings.length;
  const cols = samples + 1;
  for (let r = 0; r < n; r++) {
    const ring = rings[r];
    if (ring === undefined) continue;
    for (let j = 0; j <= samples; j++) {
      const a = ring.open + (j / samples) * (Math.PI * 2 - ring.open * 2);
      pos.push(
        (ring.ox ?? 0) + Math.sin(a) * ring.rx,
        ring.y,
        (ring.oz ?? 0) + Math.cos(a) * ring.rz,
      );
      uv.push(j / samples, r / Math.max(1, n - 1));
    }
  }
  for (let r = 0; r < n - 1; r++) {
    for (let j = 0; j < samples; j++) {
      const a = r * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}
