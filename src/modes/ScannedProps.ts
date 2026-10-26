import {
  Box3,
  Euler,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ArenaAssets, PropPlacement, PropScatter, SetPiece } from '../data/arenaAssets';
import type { ArenaDef } from '../data/arenas';
import type { QualityPreset } from '../data/quality';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { AssetLibrary, ModelPart } from '../render/env/AssetLibrary';
import type { FlameSpot } from './arenaDressing';

const DEG = Math.PI / 180;

/** A prop's parts with bounds (model space, after the part offsets). */
interface Prop {
  readonly parts: readonly ModelPart[];
  readonly box: Box3;
  /** Parts placed without their offsets (a single node of a kit or set, or a merged model). */
  readonly single: boolean;
}

/** Detail tier a quality preset shows: 0 = key set pieces only (Low), 1 = Medium, 2 = High. */
export function detailTier(preset: QualityPreset): number {
  if (preset.clutterDensity <= 0) return 0;
  return preset.clutterDensity >= 1.5 ? 2 : 1;
}

/**
 * Places the scanned models of an arena (ARENA_ASSETS): the composed set pieces (architecture,
 * cliffs, landmark, backdrop terrain) in world space, small props at compass spots, scattered
 * dressing near the edge, fire pits for the braziers and boulders for the arena's rocks. Every
 * part is one InstancedMesh holding all copies, and a whole model's parts that share a material
 * are merged first, so a prop costs one draw call per material however often it appears.
 * Geometry and materials of the parts belong to the AssetLibrary; merged copies are ours.
 */
export class ScannedProps {
  readonly objects: Object3D[] = [];
  readonly flames: FlameSpot[] = [];
  colliders = 0;
  /** Placed copies per part: shadow casters and backdrop pieces (no shadows) kept apart. */
  private readonly near = new Map<ModelPart, Matrix4[]>();
  private readonly far = new Map<ModelPart, Matrix4[]>();
  /** Whole models merged per material (geometry owned here). */
  private readonly merged = new Map<string, Prop>();
  private readonly owned: BufferGeometry[] = [];
  /** Taken ground (x, z, r) so scattered props do not pile into each other. */
  private readonly occupied: [number, number, number][] = [];
  private readonly R: number;
  private readonly tier: number;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler(0, 0, 0, 'YXZ');
  private readonly p = new Vector3();
  private readonly s = new Vector3();

  constructor(
    private readonly lib: AssetLibrary,
    private readonly def: ArenaDef,
    private readonly a: ArenaAssets,
    private readonly physics: PhysicsWorld,
    private readonly preset: QualityPreset,
    private readonly rand: () => number,
    keepOut: readonly (readonly [number, number, number])[],
  ) {
    this.R = def.floorRadius;
    this.tier = detailTier(preset);
    for (const k of keepOut) this.occupied.push([k[0], k[1], k[2]]);
    for (const p of def.pillars) this.occupied.push([p.x, p.z, p.radius + 0.6]);
    for (const b of def.braziers) this.occupied.push([b.x, b.z, 1.2]);
  }

  /** Ground taken by placed props (x, z, r), for the procedural dressing to keep clear of. */
  get taken(): readonly (readonly [number, number, number])[] {
    return this.occupied;
  }

  build(): void {
    for (const p of this.a.pieces ?? [])
      if ((p.tier ?? 0) <= this.tier && this.tier <= (p.upTo ?? 2)) this.piece(p);
    for (const p of this.a.props) if ((p.tier ?? 0) <= this.tier) this.place(p);
    this.braziers();
    this.boulders();
    // Low quality keeps the set pieces and drops the scattered small props (like clutter).
    if (this.tier > 0) for (const s of this.a.scatter) this.scatter(s);
    this.flush();
  }

  /** Instanced meshes and merged geometry are ours; the rest stays with the library. */
  dispose(): void {
    for (const o of this.objects) {
      o.removeFromParent();
      if (o instanceof InstancedMesh) o.dispose();
    }
    this.objects.length = 0;
    for (const g of this.owned) g.dispose();
    this.owned.length = 0;
    this.merged.clear();
  }

  // ------------------------------------------------------------------ models

  private prop(model: string, node?: string): Prop | null {
    if (node === undefined) return this.whole(model);
    const all = this.lib.model(model);
    if (all === undefined) return null;
    const parts = all.filter((p) => p.node === node);
    if (parts.length === 0) return null;
    return { parts, box: bounds(parts, true), single: true };
  }

  /** A whole model with its parts merged per material (offsets baked in). */
  private whole(model: string): Prop | null {
    const cached = this.merged.get(model);
    if (cached !== undefined) return cached;
    const all = this.lib.model(model);
    if (all === undefined || all.length === 0) return null;
    const byMat = new Map<Material, ModelPart[]>();
    for (const part of all) {
      const list = byMat.get(part.material) ?? [];
      list.push(part);
      byMat.set(part.material, list);
    }
    const parts: ModelPart[] = [];
    for (const [material, list] of byMat) {
      const first = list[0];
      if (list.length === 1 && first !== undefined && first.offset.lengthSq() === 0) {
        parts.push(first);
        continue;
      }
      const moved = list.map((part) => {
        const g = part.geometry.clone();
        g.translate(part.offset.x, part.offset.y, part.offset.z);
        return g;
      });
      const geometry = mergeGeometries(moved, false);
      for (const g of moved) g.dispose();
      if (geometry === null) {
        // Parts with different vertex layouts: keep them separate (offsets baked per copy).
        for (const part of list) {
          const g = part.geometry.clone();
          g.translate(part.offset.x, part.offset.y, part.offset.z);
          g.computeBoundingBox();
          g.computeBoundingSphere();
          this.owned.push(g);
          parts.push({ node: part.node, geometry: g, material, offset: new Vector3() });
        }
        continue;
      }
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      this.owned.push(geometry);
      parts.push({ node: `${model}#${parts.length}`, geometry, material, offset: new Vector3() });
    }
    const prop = { parts, box: bounds(parts, true), single: true };
    this.merged.set(model, prop);
    return prop;
  }

  // ------------------------------------------------------------------ placement

  /** Compass position (0° = north, −Z) at a radius, and the yaw that faces the centre. */
  private polar(deg: number, r: number): [number, number, number] {
    const t = deg * DEG;
    const x = Math.sin(t) * r;
    const z = -Math.cos(t) * r;
    return [x, z, Math.atan2(-x, -z)];
  }

  /** A composed set piece in world space. */
  private piece(pc: SetPiece): void {
    const prop = this.prop(pc.model, pc.node);
    if (prop === null) return;
    const k = pc.scale ?? 1;
    const st = pc.stretch ?? [1, 1, 1];
    const sx = k * st[0];
    const sy = k * st[1];
    const sz = k * st[2];
    const yaw = (pc.yaw ?? 0) * DEG;
    this.e.set((pc.tilt ?? 0) * DEG, yaw, (pc.roll ?? 0) * DEG, 'YXZ');
    this.q.setFromEuler(this.e);
    this.p.set(pc.x, -prop.box.min.y * sy + (pc.y ?? 0), pc.z);
    this.s.set(sx, sy, sz);
    this.add(prop, new Matrix4().compose(this.p, this.q, this.s), pc.far === true);
    const size = prop.box.getSize(new Vector3());
    const centre = prop.box.getCenter(new Vector3());
    // Footprint centre in world space (models are rarely centred on their pivot).
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const lx = centre.x * sx;
    const lz = centre.z * sz;
    const cx = pc.x + lx * c + lz * s;
    const cz = pc.z - lx * s + lz * c;
    const hx = (size.x * sx) / 2;
    const hz = (size.z * sz) / 2;
    const top = (pc.y ?? 0) + size.y * sy;
    if (top > 0.2) this.occupied.push([cx, cz, Math.max(hx, hz)]);
    if (pc.solid === 'round') this.solid(cx, cz, top, Math.min(hx, hz) * 0.85);
    else if (pc.solid === 'box' && top > 0) {
      this.e.set(0, yaw, 0);
      this.q.setFromEuler(this.e);
      this.physics.addStaticCuboid(
        cx,
        top / 2,
        cz,
        hx * 0.92,
        Math.max(0.3, top / 2),
        hz * 0.92,
        this.q,
      );
      this.colliders++;
    }
    if (pc.fire !== undefined) this.flames.push({ x: cx, y: pc.fire, z: cz, size: 0.8 * k });
  }

  private place(pl: PropPlacement): void {
    const prop = this.prop(pl.model, pl.node);
    if (prop === null) return;
    const r = pl.metres === true ? pl.r : pl.r * this.R;
    const [x, z, face] = this.polar(pl.deg, r);
    const scale = pl.scale ?? 1;
    this.put(prop, x, z, face + (pl.yaw ?? 0) * DEG, scale, pl.tilt ?? 0, pl.sink ?? 0);
    const size = prop.box.getSize(this.p);
    const foot = Math.max(size.x, size.z) * scale * 0.5;
    this.occupied.push([x, z, foot]);
    if (pl.solid === true) this.solid(x, z, size.y * scale, foot * 0.75);
    if (pl.fire !== undefined) this.flames.push({ x, y: pl.fire, z, size: 0.8 * scale });
  }

  /** Adds one copy: yaw, then lean, resting on the floor (minus `sink`). */
  private put(
    prop: Prop,
    x: number,
    z: number,
    yaw: number,
    scale: number,
    tiltDeg: number,
    sink: number,
  ): void {
    this.e.set(tiltDeg * DEG, yaw, 0, 'YXZ');
    this.q.setFromEuler(this.e);
    const lift = -prop.box.min.y * scale - sink;
    this.p.set(x, lift, z);
    this.s.set(scale, scale, scale);
    this.add(prop, new Matrix4().compose(this.p, this.q, this.s), false);
  }

  private add(prop: Prop, base: Matrix4, far: boolean): void {
    const map = far ? this.far : this.near;
    for (const part of prop.parts) {
      const mat = prop.single
        ? base.clone()
        : base.clone().multiply(this.m.makeTranslation(part.offset));
      let list = map.get(part);
      if (list === undefined) {
        list = [];
        map.set(part, list);
      }
      list.push(mat);
    }
  }

  private solid(x: number, z: number, height: number, radius: number): void {
    if (radius < 0.25) return;
    const h = Math.max(0.6, height);
    this.physics.addStaticCylinder(x, h / 2, z, h / 2, radius);
    this.colliders++;
  }

  private free(x: number, z: number, r: number): boolean {
    return this.occupied.every(([ox, oz, or]) => Math.hypot(x - ox, z - oz) >= or + r);
  }

  private scatter(sc: PropScatter): void {
    const all = this.lib.model(sc.model);
    if (all === undefined) return;
    // Sets (rocks, branches, boulders) scatter their pieces one by one.
    const nodes = sc.pick === true ? [...new Set(all.map((p) => p.node))] : [sc.node];
    const props = nodes.map((n) => this.prop(sc.model, n)).filter((p): p is Prop => p !== null);
    if (props.length === 0) return;
    for (let i = 0; i < sc.count; i++) {
      const prop = props[i % props.length];
      if (prop === undefined) continue;
      const scale = sc.scale[0] + this.rand() * (sc.scale[1] - sc.scale[0]);
      const size = prop.box.getSize(this.p);
      const foot = Math.max(size.x, size.z) * scale * 0.5;
      for (let tries = 0; tries < 14; tries++) {
        const deg = this.rand() * 360;
        const r = (sc.band[0] + this.rand() * (sc.band[1] - sc.band[0])) * this.R;
        const [x, z, face] = this.polar(deg, r);
        if (!this.free(x, z, foot * 0.8)) continue;
        const yaw = face + (this.rand() - 0.5) * Math.PI * 2;
        const tilt = (sc.tilt ?? 0) * (0.7 + this.rand() * 0.6);
        this.put(prop, x, z, yaw, scale, tilt, sc.sink ?? 0);
        this.occupied.push([x, z, foot * 0.8]);
        if (sc.solid === true) this.solid(x, z, size.y * scale, foot * 0.7);
        break;
      }
    }
  }

  /** Fire pits at the brazier spots (their colliders come from ArenaBuilder). */
  private braziers(): void {
    const b = this.a.brazier;
    if (b === undefined) return;
    const prop = this.prop(b.model);
    if (prop === null) return;
    for (const br of this.def.braziers) {
      this.put(prop, br.x, br.z, this.rand() * Math.PI * 2, b.scale, 0, 0);
      this.flames.push({ x: br.x, y: b.fire, z: br.z, size: 0.75 * b.scale });
    }
  }

  /** The arena's rock outcrops (colliders from ArenaBuilder) as scanned stone. */
  private boulders(): void {
    const b = this.a.boulders;
    if (b === undefined) return;
    const all = this.lib.model(b.model);
    if (all === undefined) return;
    const nodes = b.pick === true ? [...new Set(all.map((p) => p.node))] : [undefined];
    this.def.rocks.forEach((rock, i) => {
      const prop = this.prop(b.model, nodes[i % nodes.length]);
      if (prop === null) return;
      const size = prop.box.getSize(this.p);
      // Fit the outcrop's footprint (its collider is a ball of ~scale m).
      const scale = (rock.scale * 2.3) / Math.max(size.x, size.z, 0.01);
      this.put(prop, rock.x, rock.z, this.rand() * Math.PI * 2, scale, 0, size.y * scale * 0.15);
    });
  }

  /** One InstancedMesh per part (and shadow class) with all its copies. */
  private flush(): void {
    const shadows = this.preset.shadows;
    for (const [map, far] of [
      [this.near, false],
      [this.far, true],
    ] as const) {
      for (const [part, mats] of map) {
        const mesh = new InstancedMesh(part.geometry, part.material, mats.length);
        mats.forEach((mm, i) => mesh.setMatrixAt(i, mm));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        const radius = part.geometry.boundingSphere?.radius ?? 0;
        mesh.castShadow = shadows && !far && radius > 0.35;
        mesh.receiveShadow = !far;
        mesh.name = `scanned-${part.node}${far ? '-far' : ''}`;
        this.objects.push(mesh);
      }
      map.clear();
    }
  }
}

/** Bounds of parts (with their offsets unless `single`). */
function bounds(parts: readonly ModelPart[], single: boolean): Box3 {
  const box = new Box3();
  const b = new Box3();
  for (const part of parts) {
    const bb = part.geometry.boundingBox;
    if (bb === null) continue;
    b.copy(bb);
    if (!single) b.translate(part.offset);
    box.union(b);
  }
  return box;
}
