import {
  BoxGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
  type Texture,
} from 'three';
import { mulberry32 } from '../core/random';
import type { ArenaDef } from '../data/arenas';
import type { QualityPreset } from '../data/quality';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { createFlagstoneTexture, createStoneTexture } from '../render/proceduralTextures';

const DEG = Math.PI / 180;

/**
 * Builds an arena from data: one static collider per prop plus instanced visuals (one draw call
 * per prop type). Owns and disposes every GPU resource it creates.
 */
export class ArenaBuilder {
  readonly objects: Object3D[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private readonly textures: Texture[] = [];
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler();
  private readonly p = new Vector3();
  private readonly s = new Vector3();
  colliderCount = 0;

  constructor(
    private readonly def: ArenaDef,
    private readonly physics: PhysicsWorld,
    preset: QualityPreset,
  ) {
    const texSize = Math.min(preset.textureMaxSize, 1024);
    const floorTex = this.tex(
      createFlagstoneTexture(texSize, def.palette.floorBase, preset.anisotropy, 1),
    );
    const stoneTex = this.tex(
      createStoneTexture(Math.min(texSize, 512), def.palette.stone, preset.anisotropy),
    );
    const floorMat = this.mat(
      new MeshStandardMaterial({ map: floorTex, roughness: 0.9, metalness: 0.02 }),
    );
    const stoneMat = this.mat(
      new MeshStandardMaterial({ map: stoneTex, roughness: 0.88, metalness: 0.03 }),
    );

    this.buildFloor(floorMat);
    this.buildWall(stoneMat);
    this.buildPillars(stoneMat);
    this.buildBlocks(stoneMat);
    this.buildRocks();
    this.buildBraziers();
  }

  addTo(scene: Object3D): void {
    for (const o of this.objects) scene.add(o);
  }

  dispose(): void {
    for (const o of this.objects) o.removeFromParent();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
    this.objects.length = 0;
  }

  private buildFloor(material: Material): void {
    const r = this.def.floorRadius + this.def.wall.thickness;
    const geo = this.geo(new CircleGeometry(r + 2, 72));
    geo.rotateX(-Math.PI / 2);
    // Repeat UVs in world units so stones keep a constant size.
    const uv = geo.getAttribute('uv');
    const pos = geo.getAttribute('position');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 8, pos.getZ(i) / 8);
    const floor = new Mesh(geo, material);
    floor.receiveShadow = true;
    floor.name = 'floor';
    this.objects.push(floor);
    this.physics.addStaticCuboid(0, -0.5, 0, r + 4, 0.5, r + 4);
    this.colliderCount++;
  }

  private buildWall(material: Material): void {
    const w = this.def.wall;
    const n = w.segments;
    const ringR = this.def.floorRadius + w.thickness / 2;
    const segLen = ((2 * Math.PI * ringR) / n) * 1.04;
    const geo = this.geo(new BoxGeometry(1, 1, 1));
    const mesh = new InstancedMesh(geo, material, n);
    const rand = mulberry32(7);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = Math.cos(a) * ringR;
      const z = Math.sin(a) * ringR;
      // Ruined look: per-segment height variation. Colliders always use the full height so the
      // ring stays sealed.
      const h = w.height * (0.55 + rand() * 0.6);
      this.e.set(0, -a + Math.PI / 2, (rand() - 0.5) * 0.04);
      this.q.setFromEuler(this.e);
      this.p.set(x, h / 2, z);
      this.s.set(segLen, h, w.thickness);
      mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
      this.e.set(0, -a + Math.PI / 2, 0);
      this.q.setFromEuler(this.e);
      this.physics.addStaticCuboid(x, w.height, z, segLen / 2, w.height, w.thickness / 2, this.q);
      this.colliderCount++;
    }
    this.finishInstanced(mesh, 'wall');
  }

  private buildPillars(material: Material): void {
    const list = this.def.pillars;
    if (list.length === 0) return;
    const geo = this.geo(new CylinderGeometry(0.9, 1, 1, 14, 1));
    geo.translate(0, 0.5, 0);
    const mesh = new InstancedMesh(geo, material, list.length * 2);
    const capGeo = this.geo(new BoxGeometry(1, 1, 1));
    const caps = new InstancedMesh(capGeo, material, list.length);
    list.forEach((pl, i) => {
      this.q.identity();
      this.p.set(pl.x, 0, pl.z);
      this.s.set(pl.radius, pl.height, pl.radius);
      mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
      // Plinth.
      this.p.set(pl.x, 0, pl.z);
      this.s.set(pl.radius * 1.35, 0.35, pl.radius * 1.35);
      mesh.setMatrixAt(list.length + i, this.m.compose(this.p, this.q, this.s));
      // Capital block.
      this.p.set(pl.x, pl.height + 0.15, pl.z);
      this.s.set(pl.radius * 2.3, 0.3, pl.radius * 2.3);
      caps.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
      this.physics.addStaticCylinder(pl.x, pl.height / 2, pl.z, pl.height / 2, pl.radius * 1.05);
      this.colliderCount++;
    });
    this.finishInstanced(mesh, 'pillars');
    this.finishInstanced(caps, 'pillar-caps');
  }

  private buildBlocks(material: Material): void {
    const list = this.def.blocks;
    if (list.length === 0) return;
    const geo = this.geo(new BoxGeometry(1, 1, 1));
    const mesh = new InstancedMesh(geo, material, list.length);
    list.forEach((b, i) => {
      this.e.set((b.tiltXDeg ?? 0) * DEG, b.rotationYDeg * DEG, 0, 'YXZ');
      this.q.setFromEuler(this.e);
      this.p.set(b.position[0], b.position[1], b.position[2]);
      this.s.set(b.size[0], b.size[1], b.size[2]);
      mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
      this.physics.addStaticCuboid(
        b.position[0],
        b.position[1],
        b.position[2],
        b.size[0] / 2,
        b.size[1] / 2,
        b.size[2] / 2,
        this.q,
      );
      this.colliderCount++;
    });
    this.finishInstanced(mesh, 'blocks');
  }

  private buildRocks(): void {
    const list = this.def.rocks;
    if (list.length === 0) return;
    const geo = this.geo(new IcosahedronGeometry(1, 0));
    const mat = this.mat(
      new MeshStandardMaterial({
        color: this.def.palette.stone,
        roughness: 0.95,
        flatShading: true,
      }),
    );
    const mesh = new InstancedMesh(geo, mat, list.length);
    const rand = mulberry32(21);
    list.forEach((r, i) => {
      this.e.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
      this.q.setFromEuler(this.e);
      this.p.set(r.x, r.scale * 0.45, r.z);
      this.s.set(r.scale * 1.2, r.scale * 0.9, r.scale);
      mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
      this.physics.addStaticBall(r.x, r.scale * 0.45, r.z, r.scale * 0.95);
      this.colliderCount++;
    });
    this.finishInstanced(mesh, 'rocks');
  }

  private buildBraziers(): void {
    const list = this.def.braziers;
    if (list.length === 0) return;
    const metal = this.mat(
      new MeshStandardMaterial({ color: 0x2a2220, roughness: 0.5, metalness: 0.8 }),
    );
    const standGeo = this.geo(new CylinderGeometry(0.09, 0.16, 1.2, 8));
    standGeo.translate(0, 0.6, 0);
    const bowlGeo = this.geo(new CylinderGeometry(0.42, 0.2, 0.3, 12, 1, true));
    bowlGeo.translate(0, 1.3, 0);
    const flameGeo = this.geo(new ConeGeometry(0.28, 0.7, 8, 1, true));
    flameGeo.translate(0, 1.7, 0);
    const fire = new Color(this.def.palette.ember).multiplyScalar(1.5);
    const flameMat = this.mat(
      new MeshBasicMaterial({ color: fire, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    const stands = new InstancedMesh(standGeo, metal, list.length);
    const bowls = new InstancedMesh(bowlGeo, metal, list.length);
    const flames = new InstancedMesh(flameGeo, flameMat, list.length);
    list.forEach((b, i) => {
      this.q.identity();
      this.p.set(b.x, 0, b.z);
      this.s.set(1, 1, 1);
      this.m.compose(this.p, this.q, this.s);
      stands.setMatrixAt(i, this.m);
      bowls.setMatrixAt(i, this.m);
      flames.setMatrixAt(i, this.m);
      this.physics.addStaticCylinder(b.x, 0.7, b.z, 0.7, 0.42);
      this.colliderCount++;
    });
    this.finishInstanced(stands, 'brazier-stands');
    this.finishInstanced(bowls, 'brazier-bowls');
    flames.castShadow = false;
    this.finishInstanced(flames, 'brazier-flames', false);
  }

  private finishInstanced(mesh: InstancedMesh, name: string, shadows = true): void {
    mesh.name = name;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    this.objects.push(mesh);
  }

  private geo<T extends BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  private mat<T extends Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  private tex(t: Texture): Texture {
    this.textures.push(t);
    return t;
  }
}
