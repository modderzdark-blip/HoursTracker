import {
  BoxGeometry,
  BufferAttribute,
  CatmullRomCurve3,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  IcosahedronGeometry,
  Matrix4,
  Quaternion,
  TubeGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/random';
import type { Structure, StructureSurface } from '../data/arenaAssets';

/**
 * Procedural architecture built from the arena's scanned surfaces: arcades of real voussoir
 * arches, ruined gothic walls with lancet windows and buttresses, obelisks, standing-stone
 * circles with trilithons, the ribcage of a fallen colossus, stalagmite fields, graveyards and
 * columned shrines. Each kind gives an arena its own silhouette; all of it merges into the
 * arena's per-surface mass meshes (no extra draw calls) with baked ground occlusion.
 */

/** A solid footprint: an oriented box (hx, hz half sizes) or a cylinder (r = hx). */
export interface StructureCollider {
  readonly x: number;
  readonly z: number;
  readonly hx: number;
  readonly hz: number;
  readonly h: number;
  readonly yaw: number;
  readonly round: boolean;
}

export interface BuiltStructure {
  readonly parts: { readonly surface: StructureSurface; readonly geometry: BufferGeometry }[];
  readonly colliders: StructureCollider[];
}

const DEG = Math.PI / 180;

/** Collects parts in the structure's local frame, then places them in the world. */
class Builder {
  private readonly bySurface = new Map<StructureSurface, BufferGeometry[]>();
  readonly colliders: StructureCollider[] = [];
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler();
  private readonly p = new Vector3();
  private readonly s = new Vector3(1, 1, 1);

  constructor(
    private readonly st: Structure,
    private readonly k: number,
  ) {}

  /** Adds geometry already in local metres (y up from the ground). */
  add(g: BufferGeometry, surface: StructureSurface = this.st.surface ?? 'stone'): void {
    if (g.getAttribute('uv') !== undefined) g.deleteAttribute('uv');
    if (g.index === null) {
      // Polyhedra come unindexed: weld them so they merge with the rest.
      g.deleteAttribute('normal');
      g = mergeVertices(g);
      g.computeVertexNormals();
    }
    const list = this.bySurface.get(surface) ?? [];
    list.push(g);
    this.bySurface.set(surface, list);
  }

  /** A box from its base centre (x, y, z), turned by yaw / tilt (X) / roll (Z) in degrees. */
  box(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    o: {
      yaw?: number;
      tilt?: number;
      roll?: number;
      surface?: StructureSurface;
      /** Raised this far along its own up axis before turning (parts of one leaning piece). */
      lift?: number;
    } = {},
  ): void {
    const seg = (v: number): number => Math.max(1, Math.min(8, Math.round(v / 2)));
    const g = new BoxGeometry(w, h, d, seg(w), Math.max(1, seg(h)), seg(d));
    g.translate(0, h / 2 + (o.lift ?? 0), 0);
    this.place(g, x, y, z, o.yaw ?? 0, o.tilt ?? 0, o.roll ?? 0);
    this.add(g, o.surface);
  }

  /** Any geometry (base at its local y = 0) placed at (x, y, z). */
  put(
    g: BufferGeometry,
    x: number,
    y: number,
    z: number,
    o: { yaw?: number; tilt?: number; roll?: number; surface?: StructureSurface } = {},
  ): void {
    this.place(g, x, y, z, o.yaw ?? 0, o.tilt ?? 0, o.roll ?? 0);
    this.add(g, o.surface);
  }

  private place(
    g: BufferGeometry,
    x: number,
    y: number,
    z: number,
    yaw: number,
    tilt: number,
    roll: number,
  ): void {
    this.e.set(tilt * DEG, yaw * DEG, roll * DEG, 'YXZ');
    this.q.setFromEuler(this.e);
    g.applyMatrix4(this.m.compose(this.p.set(x, y, z), this.q, this.s));
  }

  /** A collider in local metres (yaw in degrees, local frame). */
  solid(x: number, z: number, hx: number, hz: number, h: number, yaw = 0, round = false): void {
    if (this.st.solid === false) return;
    this.colliders.push({ x, z, hx, hz, h, yaw, round });
  }

  /** Everything moved into the world: scaled, turned by the structure's yaw, placed. */
  finish(): BuiltStructure {
    const k = this.k;
    const yaw = (this.st.yaw ?? 0) * DEG;
    const world = new Matrix4().compose(
      new Vector3(this.st.x, this.st.y ?? 0, this.st.z),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw),
      new Vector3(k, k, k),
    );
    const parts: BuiltStructure['parts'] = [];
    for (const [surface, list] of this.bySurface) {
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (merged === null) throw new Error(`structure merge failed (${this.st.kind})`);
      merged.applyMatrix4(world);
      bakeGroundOcclusion(merged, this.st.y ?? 0);
      parts.push({ surface, geometry: merged });
    }
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const colliders = this.colliders.map((col) => ({
      // Yaw about Y turns local (x, z) to (x cos + z sin, −x sin + z cos).
      x: this.st.x + (col.x * c + col.z * s) * k,
      z: this.st.z + (-col.x * s + col.z * c) * k,
      hx: col.hx * k,
      hz: col.hz * k,
      h: col.h * k,
      yaw: col.yaw * DEG + yaw,
      round: col.round,
    }));
    return { parts, colliders };
  }
}

/** Vertex colours: occlusion darkening the last metre above the ground (as the masses do). */
function bakeGroundOcclusion(g: BufferGeometry, base: number): void {
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) - Math.min(0, base);
    const ao = 0.55 + 0.45 * Math.min(1, Math.max(0, y) / 0.9);
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = ao;
  }
  g.setAttribute('color', new BufferAttribute(colors, 3));
}

/**
 * The voussoirs of an arch springing at height `spring` between x = −span/2 and +span/2, `ring`
 * thick (radially) and `depth` deep. Pointed: a gothic arch (two arcs, centres at ±span·0.3).
 */
function arch(
  b: Builder,
  cx: number,
  cz: number,
  span: number,
  spring: number,
  ring: number,
  depth: number,
  pointed: boolean,
  yaw = 0,
  keep = 1,
): void {
  const n = Math.max(5, Math.round(span * 2.2)) | 1;
  const shown = Math.round(n * keep);
  for (let i = 0; i < shown; i++) {
    const t0 = i / n;
    const t1 = (i + 1) / n;
    const a = archPoint(span, pointed, t0, ring);
    const e = archPoint(span, pointed, t1, ring);
    const mx = (a[0] + e[0]) / 2;
    const my = (a[1] + e[1]) / 2;
    const len = Math.hypot(e[0] - a[0], e[1] - a[1]) * 1.04;
    const ang = Math.atan2(e[1] - a[1], e[0] - a[0]) / DEG;
    // The block: `len` along the curve, `ring` across it, centred on the curve.
    const g = new BoxGeometry(len, ring, depth);
    g.rotateZ(ang * DEG);
    g.translate(mx, spring + my, 0);
    g.rotateY(yaw * DEG);
    g.translate(cx, 0, cz);
    b.add(g);
  }
}

/** Point t (0..1, left to right) on the arch's centre line, relative to the springing line. */
function archPoint(span: number, pointed: boolean, t: number, ring: number): [number, number] {
  const r = span / 2 + ring / 2;
  if (!pointed) {
    const a = Math.PI * (1 - t);
    return [Math.cos(a) * r, Math.sin(a) * r];
  }
  // Gothic: the left half is an arc centred right of the middle, the right half its mirror.
  const off = span * 0.3;
  const R = r + off;
  const apex = Math.acos(-off / R);
  if (t < 0.5) {
    const a = Math.PI - (t / 0.5) * (Math.PI - apex);
    return [off + Math.cos(a) * R, Math.sin(a) * R];
  }
  const a = (Math.PI - apex) * (1 - (t - 0.5) / 0.5);
  return [-off + Math.cos(a) * R, Math.sin(a) * R];
}

/** Height of an arch's top (extrados) above its springing line. */
function archRise(span: number, pointed: boolean, ring: number): number {
  return archPoint(span, pointed, 0.5, ring)[1] + ring / 2;
}

// ------------------------------------------------------------------------------------ kinds

/** A run of arches on square piers with a cornice; `ruined` breaks piers and drops voussoirs. */
function arcade(b: Builder, st: Structure, rand: () => number): void {
  const n = Math.max(1, st.count ?? 4);
  const L = st.length ?? n * 4;
  const H = st.height ?? 4;
  const ruin = st.ruined ?? 0;
  const bay = L / n;
  const pier = Math.min(1.1, bay * 0.28);
  const depth = 0.9;
  const ring = 0.5;
  const pointed = st.pointed === true;
  const span = bay - pier;
  const crown = H + 0.3 + archRise(span, pointed, ring);
  const broken: boolean[] = [];
  for (let i = 0; i <= n; i++) {
    const x = -L / 2 + i * bay;
    const isBroken = rand() < ruin * 0.7;
    broken.push(isBroken);
    const h = isBroken ? H * (0.25 + rand() * 0.5) : H;
    b.box(x, 0, 0, pier * 1.3, 0.45, depth * 1.3);
    b.box(x, 0.45, 0, pier, h - 0.45, depth);
    if (!isBroken) b.box(x, H - 0.05, 0, pier * 1.25, 0.35, depth * 1.2);
    b.solid(x, 0, (pier * 1.3) / 2, (depth * 1.3) / 2, h);
  }
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (i + 0.5) * bay;
    const standing = !broken[i] && !broken[i + 1];
    if (standing) {
      arch(b, x, 0, span, H + 0.3, ring, depth, pointed);
      // Spandrel wall and cornice above the arch.
      const top = crown + 0.4;
      if (rand() > ruin * 0.6) {
        b.box(x, crown - 0.15, 0, bay + pier, top - crown + 0.15, depth * 0.85);
        b.box(x, top, 0, bay + pier * 1.1, 0.3, depth * 1.15);
      }
    } else {
      // Fallen voussoirs and a cornice block in the rubble below.
      for (let r = 0; r < 4; r++)
        b.box(x + (rand() - 0.5) * span, -0.15, (rand() - 0.5) * 2.4, 0.9, 0.45, 0.6, {
          yaw: rand() * 180,
          tilt: (rand() - 0.5) * 30,
          roll: (rand() - 0.5) * 30,
        });
    }
  }
}

/** A gothic wall in bays: lancet windows, stepped buttresses, a broken skyline. */
function ruinWall(b: Builder, st: Structure, rand: () => number): void {
  const n = Math.max(1, st.count ?? 4);
  const L = st.length ?? n * 3.6;
  const H = st.height ?? 7;
  const ruin = st.ruined ?? 0.4;
  const bay = L / n;
  const t = 0.8;
  const sill = Math.min(2.2, H * 0.3);
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (i + 0.5) * bay;
    const top = Math.max(sill + 0.6, H * (1 - ruin * rand() * 0.75));
    const win = bay * 0.42;
    const jamb = (bay - win) / 2;
    // Lower wall, the two jambs, the arch and the wall above it.
    b.box(x, 0, 0, bay, sill, t);
    const springH = Math.min(top - 0.6, sill + (H - sill) * 0.55);
    b.box(x - win / 2 - jamb / 2, sill, 0, jamb, Math.max(0.4, top - sill), t);
    b.box(
      x + win / 2 + jamb / 2,
      sill,
      0,
      jamb,
      Math.max(0.4, top - sill) * (0.8 + rand() * 0.2),
      t,
    );
    const rise = archRise(win, true, 0.32);
    if (top > springH + rise) {
      arch(b, x, 0, win, springH, 0.32, t * 0.9, true);
      const above = springH + rise;
      if (top > above) b.box(x, above, 0, win + 0.05, top - above, t * 0.9);
    }
    // Tracery mullion in the window.
    if (rand() > ruin) b.box(x, sill, 0, 0.16, Math.max(0.5, springH - sill), 0.2);
    b.solid(x, 0, bay / 2, t / 2 + 0.05, Math.max(sill, top * 0.8));
  }
  // Stepped buttresses on the back face between bays.
  for (let i = 0; i <= n; i++) {
    const x = -L / 2 + i * bay;
    const h = H * (0.55 + rand() * 0.35) * (1 - ruin * 0.3);
    b.box(x, 0, t / 2 + 0.55, 0.9, h * 0.55, 1.1);
    b.box(x, h * 0.55, t / 2 + 0.4, 0.75, h * 0.45, 0.8);
    b.box(x, h, t / 2 + 0.35, 0.75, 0.5, 0.7, { tilt: 30 });
    b.solid(x, t / 2 + 0.55, 0.45, 0.55, h);
  }
}

/** A tapered square shaft with a pyramidion on a stepped base. */
function obelisk(b: Builder, st: Structure): void {
  const H = st.height ?? 9;
  const w = H * 0.11;
  b.box(0, 0, 0, w * 3.2, 0.5, w * 3.2);
  b.box(0, 0.5, 0, w * 2.5, 0.45, w * 2.5);
  b.box(0, 0.95, 0, w * 1.8, 0.6, w * 1.8);
  // Four radial segments: a square whose corners sit on the radius (half width × √2).
  const tipR = (w * 0.62) / Math.SQRT2;
  const shaft = new CylinderGeometry(tipR, w / Math.SQRT2, H, 4, 6);
  shaft.rotateY(Math.PI / 4);
  shaft.translate(0, H / 2, 0);
  b.put(shaft, 0, 1.55, 0);
  const tip = new ConeGeometry(tipR, w * 1.4, 4, 1);
  tip.rotateY(Math.PI / 4);
  tip.translate(0, (w * 1.4) / 2, 0);
  b.put(tip, 0, 1.55 + H, 0);
  b.solid(0, 0, w * 1.6, w * 1.6, H);
}

/** A ring of leaning monoliths; some pairs carry a lintel. Optional altar slab in the middle. */
function stones(b: Builder, st: Structure, rand: () => number): void {
  const n = Math.max(3, st.count ?? 9);
  const R = st.length ?? 7;
  const H = st.height ?? 4.2;
  const ruin = st.ruined ?? 0.3;
  for (let i = 0; i < n; i++) {
    if (rand() < ruin * 0.35) continue;
    const a = (i / n) * Math.PI * 2;
    const x = Math.sin(a) * R;
    const z = Math.cos(a) * R;
    const yaw = a / DEG + (rand() - 0.5) * 10;
    const h = H * (0.7 + rand() * 0.45);
    const fallen = rand() < ruin * 0.25;
    if (fallen) {
      b.box(x, -0.2, z, 1.4, 0.8, h * 0.9, { yaw: yaw + 70, tilt: 4 });
      continue;
    }
    b.box(x, -0.3, z, 1.2 + rand() * 0.5, h + 0.3, 0.75, {
      yaw,
      tilt: (rand() - 0.5) * 9,
      roll: (rand() - 0.5) * 7,
    });
    b.solid(x, z, 0.8, 0.45, h, yaw);
    // Trilithon: this stone and a twin carry a lintel.
    if (i % 3 === 0 && rand() > ruin) {
      const a2 = a + (Math.PI * 2) / n / 2.6;
      const x2 = Math.sin(a2) * R;
      const z2 = Math.cos(a2) * R;
      b.box(x2, -0.3, z2, 1.3, h + 0.3, 0.75, { yaw: a2 / DEG });
      b.solid(x2, z2, 0.8, 0.45, h, a2 / DEG);
      const mx = (x + x2) / 2;
      const mz = (z + z2) / 2;
      b.box(mx, h, mz, Math.hypot(x2 - x, z2 - z) + 1.6, 0.7, 0.9, {
        yaw: Math.atan2(-(z2 - z), x2 - x) / DEG,
      });
    }
  }
  if (st.altar === true) {
    b.box(0, 0, 0, 2.8, 0.6, 1.6);
    b.box(0, 0.6, 0, 2.4, 0.35, 1.3);
    b.solid(0, 0, 1.4, 0.8, 1);
  }
}

/** The bones of a fallen colossus: a half-buried spine, ribs arching overhead, the skull. */
function ribs(b: Builder, st: Structure, rand: () => number): void {
  const n = Math.max(2, st.count ?? 7);
  const L = st.length ?? 22;
  const H = st.height ?? 9;
  const ruin = st.ruined ?? 0.25;
  const bone = st.surface ?? 'stone';
  // Spine: vertebrae along a gentle S, sinking into the ground at the tail.
  const verts = Math.round(L / 1.5);
  for (let i = 0; i < verts; i++) {
    const t = i / (verts - 1);
    const x = -L / 2 + t * L;
    const z = Math.sin(t * Math.PI * 1.2) * 1.2;
    const sink = -0.6 - (1 - t) * 0.9;
    const v = new CylinderGeometry(0.75 + t * 0.35, 0.85 + t * 0.35, 1.1, 8, 1);
    v.rotateZ(Math.PI / 2);
    v.translate(0, 0.55, 0);
    b.put(v, x, sink + 0.6, z, { surface: bone, yaw: (rand() - 0.5) * 12 });
    // Spinous process.
    b.box(x, sink + 1.1, z, 0.35, 0.9 + t * 0.9, 0.5, { surface: bone, roll: -15 });
  }
  b.solid(0, 0, L / 2, 1.2, 1.4);
  // Ribs: pairs of curved tubes from the spine to the ground on either side.
  for (let i = 0; i < n; i++) {
    const t = 0.25 + (i / Math.max(1, n - 1)) * 0.7;
    const x = -L / 2 + t * L;
    const zc = Math.sin(t * Math.PI * 1.2) * 1.2;
    const h = H * (0.55 + 0.45 * Math.sin(t * Math.PI * 0.9));
    const reach = h * 0.75;
    for (const side of [-1, 1]) {
      if (rand() < ruin * 0.4) continue;
      const broken = rand() < ruin ? 0.45 + rand() * 0.35 : 1;
      const pts: Vector3[] = [];
      const steps = 7;
      for (let k = 0; k <= steps; k++) {
        const u = (k / steps) * broken;
        const ang = u * Math.PI * 0.95;
        pts.push(
          new Vector3(
            x - u * 1.2,
            0.6 + Math.sin(ang) * h * (1 - u * 0.15),
            zc + side * (1 - Math.cos(ang)) * reach * 0.62,
          ),
        );
      }
      const curve = new CatmullRomCurve3(pts);
      const radius = 0.32 + (1 - t) * 0.12;
      const tube = new TubeGeometry(curve, 14, radius, 6, false);
      b.put(tube, 0, 0, 0, { surface: bone });
      if (broken === 1) {
        const end = pts[pts.length - 1];
        if (end !== undefined) b.solid(end.x, end.z, 0.6, 0.6, 2, 0, true);
      }
    }
  }
  // The skull at the head end, half sunk and turned.
  const skull = new IcosahedronGeometry(1, 1);
  skull.scale(2.4, 1.9, 2.1);
  skull.translate(0, 1.2, 0);
  b.put(skull, L / 2 + 2.2, -0.6, 0.6, { surface: bone, yaw: 25, roll: 12 });
  const jaw = new BoxGeometry(2.6, 0.7, 1.8);
  jaw.translate(0, 0.35, 0);
  b.put(jaw, L / 2 + 3.6, -0.25, 1.2, { surface: bone, yaw: 40, tilt: 8 });
  b.solid(L / 2 + 2.6, 0.8, 2.3, 2, 2.6, 25);
}

/** A field of stalagmites (rough cones), the big ones solid. */
function stalagmites(b: Builder, st: Structure, rand: () => number): void {
  const n = Math.max(1, st.count ?? 9);
  const R = st.length ?? 4;
  const H = st.height ?? 5;
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * R;
    const x = Math.sin(a) * d;
    const z = Math.cos(a) * d;
    const h = H * (0.3 + rand() * 0.7);
    const r = h * (0.16 + rand() * 0.08);
    const cone = new ConeGeometry(r, h, 7, 5);
    // Lumpy: push the rings in and out.
    const pos = cone.getAttribute('position');
    const seed = rand() * 10;
    for (let v = 0; v < pos.count; v++) {
      const px = pos.getX(v);
      const py = pos.getY(v);
      const pz = pos.getZ(v);
      const k =
        1 + 0.18 * Math.sin(py * 3.1 + seed) + 0.1 * Math.sin(Math.atan2(pz, px) * 3 + seed);
      pos.setXYZ(v, px * k, py, pz * k);
    }
    cone.computeVertexNormals();
    cone.translate(0, h / 2 - 0.3, 0);
    b.put(cone, x, 0, z, { surface: 'rock', tilt: (rand() - 0.5) * 12, roll: (rand() - 0.5) * 12 });
    if (h > 2) b.solid(x, z, r * 0.8, r * 0.8, h, 0, true);
  }
}

/** Rows of headstones, crosses and sarcophagi, sunk and leaning. */
function tombs(b: Builder, st: Structure, rand: () => number): void {
  const cols = Math.max(1, st.count ?? 5);
  const rows = Math.max(1, st.rows ?? 2);
  const L = st.length ?? cols * 2.2;
  const D = rows * 2.6;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x = -L / 2 + (c + 0.5) * (L / cols) + (rand() - 0.5) * 0.5;
      const z = -D / 2 + (r + 0.5) * (D / rows) + (rand() - 0.5) * 0.4;
      const yaw = (rand() - 0.5) * 14;
      const lean = (rand() - 0.5) * 22;
      const kind = rand();
      if (kind < 0.45) {
        // Round-topped headstone.
        const w = 0.7 + rand() * 0.25;
        const h = 0.9 + rand() * 0.5;
        b.box(x, -0.2, z, w, h, 0.18, { yaw, tilt: lean });
        // The rounded top: a half disc standing on the slab.
        const top = new CylinderGeometry(w / 2, w / 2, 0.18, 10, 1, false, 0, Math.PI);
        top.rotateX(Math.PI / 2);
        top.rotateZ(Math.PI / 2);
        top.translate(0, h, 0);
        b.put(top, x, -0.2, z, { yaw, tilt: lean });
      } else if (kind < 0.75) {
        // Cross.
        const h = 1.3 + rand() * 0.5;
        b.box(x, -0.25, z, 0.18, h, 0.18, { yaw, tilt: lean });
        b.box(x, -0.25, z, 0.75, 0.16, 0.16, { yaw, tilt: lean, lift: h * 0.62 });
      } else {
        // Sarcophagus with a slipped lid.
        b.box(x, 0, z, 1, 0.7, 2.1, { yaw });
        b.box(x + 0.15, 0.7, z + 0.2, 1.1, 0.18, 2.2, { yaw: yaw + 8 + rand() * 10, roll: 6 });
        b.solid(x, z, 0.5, 1.05, 0.9, yaw);
      }
    }
}

/** A columned shrine: stepped platform, columns, entablature and a gabled roof (or its ruin). */
function shrine(b: Builder, st: Structure, rand: () => number): void {
  const W = st.length ?? 6;
  const D = W * 0.75;
  const H = st.height ?? 4.5;
  const ruin = st.ruined ?? 0.2;
  b.box(0, 0, 0, W + 1.6, 0.35, D + 1.6);
  b.box(0, 0.35, 0, W + 0.8, 0.35, D + 0.8);
  const base = 0.7;
  b.solid(0, 0, (W + 1.6) / 2, (D + 1.6) / 2, base);
  const cols: [number, number][] = [];
  const nx = Math.max(2, Math.round(W / 1.8));
  for (let i = 0; i < nx; i++) {
    const x = -W / 2 + (i / (nx - 1)) * W;
    cols.push([x, -D / 2], [x, D / 2]);
  }
  let standing = 0;
  for (const [x, z] of cols) {
    const fallen = rand() < ruin * 0.5;
    const h = fallen ? H * (0.2 + rand() * 0.4) : H;
    if (!fallen) standing++;
    const shaft = new CylinderGeometry(0.28, 0.34, h, 10, 2);
    shaft.translate(0, h / 2, 0);
    b.put(shaft, x, base, z);
    b.box(x, base, z, 0.85, 0.25, 0.85);
    if (!fallen) b.box(x, base + h - 0.2, z, 0.8, 0.25, 0.8);
    b.solid(x, z, 0.42, 0.42, base + h, 0, true);
  }
  if (standing >= cols.length - 1) {
    const top = base + H + 0.05;
    b.box(0, top, 0, W + 0.9, 0.55, D + 0.9);
    // Gable: two slabs meeting at the ridge.
    const pitch = 24;
    const half = (D + 1.2) / 2 / Math.cos(pitch * DEG);
    const rise = Math.sin(pitch * DEG) * half;
    b.box(0, top + 0.55 + rise / 2 - 0.15, -(D + 1.2) / 4, W + 1.3, 0.25, half, { tilt: pitch });
    b.box(0, top + 0.55 + rise / 2 - 0.15, (D + 1.2) / 4, W + 1.3, 0.25, half, { tilt: -pitch });
  } else {
    // The roof lies in pieces on the platform.
    for (let i = 0; i < 3; i++)
      b.box((rand() - 0.5) * W, base, (rand() - 0.5) * D, 1.8, 0.5, 0.9, {
        yaw: rand() * 180,
        tilt: (rand() - 0.5) * 20,
      });
  }
  // An altar inside.
  if (st.altar === true) b.box(0, base, 0, 1.4, 1, 0.9);
}

const KINDS: Readonly<
  Record<Structure['kind'], (b: Builder, st: Structure, r: () => number) => void>
> = {
  arcade,
  ruinWall,
  obelisk: (b, st) => obelisk(b, st),
  stones,
  ribs,
  stalagmites,
  tombs,
  shrine,
};

/** Builds one structure in world space (deterministic from its seed). */
export function buildStructure(st: Structure): BuiltStructure {
  const b = new Builder(st, st.scale ?? 1);
  KINDS[st.kind](b, st, mulberry32(st.seed ?? 1));
  return b.finish();
}
