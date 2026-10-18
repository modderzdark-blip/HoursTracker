import {
  Color,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
  type Scene,
} from 'three';
import { mulberry32 } from '../core/random';

interface Orb {
  active: boolean;
  t: number;
  sx: number;
  sy: number;
  sz: number;
  vx: number;
  vy: number;
  vz: number;
}

const FLY_SEC = 1.3;

/**
 * Soul orbs that burst out of a defeated foe and home in on the player. One instanced draw call.
 * `onCollect` fires once per orb that reaches the player.
 */
export class SoulOrbs {
  private readonly mesh: InstancedMesh;
  private readonly orbs: Orb[] = [];
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly p = new Vector3();
  private readonly s = new Vector3();
  private readonly rand = mulberry32(31);
  private readonly geometry = new IcosahedronGeometry(0.11, 1);
  private readonly material = new MeshBasicMaterial({ color: new Color(0.7, 0.9, 3.2) });
  onCollect: (() => void) | null = null;

  constructor(scene: Scene, capacity = 48) {
    this.mesh = new InstancedMesh(this.geometry, this.material, capacity);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < capacity; i++) {
      this.orbs.push({ active: false, t: 0, sx: 0, sy: 0, sz: 0, vx: 0, vy: 0, vz: 0 });
      this.m.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    scene.add(this.mesh);
  }

  burst(x: number, y: number, z: number, count: number): void {
    let n = count;
    for (const o of this.orbs) {
      if (n <= 0) break;
      if (o.active) continue;
      const a = this.rand() * Math.PI * 2;
      const sp = 2 + this.rand() * 3;
      o.active = true;
      o.t = -this.rand() * 0.25;
      o.sx = x;
      o.sy = y;
      o.sz = z;
      o.vx = Math.cos(a) * sp;
      o.vy = 3 + this.rand() * 3;
      o.vz = Math.sin(a) * sp;
      n--;
    }
  }

  update(dtSec: number, tx: number, ty: number, tz: number): void {
    let any = false;
    for (let i = 0; i < this.orbs.length; i++) {
      const o = this.orbs[i];
      if (o === undefined || !o.active) continue;
      any = true;
      o.t += dtSec;
      const t = Math.max(0, o.t) / FLY_SEC;
      if (t >= 1) {
        o.active = false;
        this.m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.m);
        this.onCollect?.();
        continue;
      }
      // Free flight blended into homing (ease-in) so the orbs fan out then converge.
      const free = Math.max(0, o.t);
      const fx = o.sx + o.vx * free;
      const fy = o.sy + o.vy * free - 4 * free * free;
      const fz = o.sz + o.vz * free;
      const h = t * t * t;
      this.p.set(fx + (tx - fx) * h, Math.max(0.2, fy + (ty - fy) * h), fz + (tz - fz) * h);
      const sc = 1 - t * 0.4;
      this.s.set(sc, sc, sc);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    for (let i = 0; i < this.orbs.length; i++) {
      const o = this.orbs[i];
      if (o !== undefined) o.active = false;
      this.m.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }
}
