import { Box3, Euler, InstancedMesh, Matrix4, Quaternion, Vector3, type Object3D } from 'three';
import type { ArenaAssets, CastleWall, PropPlacement, PropScatter } from '../data/arenaAssets';
import { FORT_MODEL } from '../data/arenaAssets';
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
  /** Parts placed without their offsets (a single node of a kit or set). */
  readonly single: boolean;
}

/**
 * Places the scanned props of an arena (ARENA_ASSETS): set pieces, scattered dressing near the
 * wall, fire pits for the braziers, boulders for the arena's rocks and fort-kit castle walls.
 * Every part is one InstancedMesh holding all copies, so a prop costs one draw call per material
 * however often it appears. Geometry and materials belong to the AssetLibrary.
 */
export class ScannedProps {
  readonly objects: Object3D[] = [];
  readonly flames: FlameSpot[] = [];
  colliders = 0;
  private readonly instances = new Map<ModelPart, Matrix4[]>();
  /** Taken ground (x, z, r) so scattered props do not pile into each other. */
  private readonly occupied: [number, number, number][] = [];
  private readonly R: number;
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
    for (const k of keepOut) this.occupied.push([k[0], k[1], k[2]]);
    for (const p of def.pillars) this.occupied.push([p.x, p.z, p.radius + 0.6]);
    for (const b of def.braziers) this.occupied.push([b.x, b.z, 1.2]);
  }

  build(): void {
    for (const p of this.a.props) this.place(p);
    if (this.a.castle !== undefined) this.castle(this.a.castle);
    this.braziers();
    this.boulders();
    for (const s of this.a.scatter) this.scatter(s);
    this.flush();
  }

  /** Instanced meshes are ours; geometry and materials stay with the library. */
  dispose(): void {
    for (const o of this.objects) {
      o.removeFromParent();
      if (o instanceof InstancedMesh) o.dispose();
    }
    this.objects.length = 0;
  }

  // ------------------------------------------------------------------ placement

  private prop(model: string, node?: string): Prop | null {
    const all = this.lib.model(model);
    if (all === undefined) return null;
    const parts = node === undefined ? all : all.filter((p) => p.node === node);
    if (parts.length === 0) return null;
    const single = node !== undefined;
    const box = new Box3();
    const b = new Box3();
    for (const part of parts) {
      const bb = part.geometry.boundingBox;
      if (bb === null) continue;
      b.copy(bb);
      if (!single) b.translate(part.offset);
      box.union(b);
    }
    return { parts, box, single };
  }

  /** Compass position (0° = north, −Z) at a radius, and the yaw that faces the centre. */
  private polar(deg: number, r: number): [number, number, number] {
    const t = deg * DEG;
    const x = Math.sin(t) * r;
    const z = -Math.cos(t) * r;
    return [x, z, Math.atan2(-x, -z)];
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
    const base = new Matrix4().compose(this.p, this.q, this.s);
    for (const part of prop.parts) {
      const mat = prop.single
        ? base.clone()
        : base.clone().multiply(this.m.makeTranslation(part.offset));
      let list = this.instances.get(part);
      if (list === undefined) {
        list = [];
        this.instances.set(part, list);
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

  /**
   * Fort-kit walls standing on the arena's wall ring (the ring keeps its own colliders), with
   * round towers at intervals: each tower is solid and kept clear of enemy spawn points.
   */
  private castle(c: CastleWall): void {
    const wall = this.prop(FORT_MODEL, `${FORT_MODEL}_wall_thin_straight_01`);
    const tower = this.prop(FORT_MODEL, `${FORT_MODEL}_tower_round`);
    if (wall === null) return;
    const w = this.def.wall;
    const ring = this.R + w.thickness / 2 + 0.2;
    const len = wall.box.getSize(this.p).z * c.scale;
    const n = Math.ceil((2 * Math.PI * ring) / len);
    const stretch = ((2 * Math.PI * ring) / n / len) * 1.06;
    for (let i = 0; i < n; i++) {
      const deg = (i / n) * 360;
      const [x, z, face] = this.polar(deg, ring);
      // The kit's walls run along their Z axis: turn them tangent to the ring.
      this.e.set(0, face + Math.PI / 2, 0, 'YXZ');
      this.q.setFromEuler(this.e);
      this.p.set(x, -wall.box.min.y * c.scale - 0.15, z);
      this.s.set(c.scale, c.scale, c.scale * stretch);
      const mat = new Matrix4().compose(this.p, this.q, this.s);
      for (const part of wall.parts) this.push(part, mat);
    }
    if (tower === null) return;
    const tr = (tower.box.getSize(this.p).x * c.towerScale) / 2;
    for (let i = 0; i < n; i += c.towerEvery) {
      const deg = ((i + 0.5) / n) * 360;
      const [x, z, face] = this.polar(deg, ring + tr * 0.35);
      if (!this.free(x, z, tr * 0.9)) continue;
      this.put(tower, x, z, face, c.towerScale, 0, 0.2);
      this.occupied.push([x, z, tr]);
      this.solid(x, z, tower.box.getSize(this.p).y * c.towerScale, tr * 0.92);
    }
  }

  private push(part: ModelPart, mat: Matrix4): void {
    let list = this.instances.get(part);
    if (list === undefined) {
      list = [];
      this.instances.set(part, list);
    }
    list.push(mat);
  }

  /** One InstancedMesh per part with all its copies. */
  private flush(): void {
    const shadows = this.preset.shadows;
    for (const [part, mats] of this.instances) {
      const mesh = new InstancedMesh(part.geometry, part.material, mats.length);
      mats.forEach((mm, i) => mesh.setMatrixAt(i, mm));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      const radius = part.geometry.boundingSphere?.radius ?? 0;
      mesh.castShadow = shadows && radius > 0.35;
      mesh.receiveShadow = true;
      mesh.name = `scanned-${part.node}`;
      this.objects.push(mesh);
    }
    this.instances.clear();
  }
}
