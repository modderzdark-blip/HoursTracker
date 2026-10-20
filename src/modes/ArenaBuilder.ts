import {
  BoxGeometry,
  BufferAttribute,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
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
  type WebGLRenderer,
} from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/random';
import { ARENA_LOOKS, type ArenaLook, type SurfaceLook } from '../data/arenaLooks';
import type { ArenaDef, ArenaId } from '../data/arenas';
import type { QualityPreset } from '../data/quality';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import {
  boneGeometry,
  cliffRingGeometry,
  columnGeometry,
  fbm,
  rockGeometry,
  skullGeometry,
  spireGeometry,
  stoneBlockGeometry,
} from '../render/env/shapes';
import { TextureSynth, type MaterialMaps } from '../render/env/TextureSynth';
import { createTriplanarMaterial } from '../render/env/triplanar';
import { Flames } from '../vfx/Flames';
import { GroundFog } from '../vfx/GroundFog';
import { LightShafts } from '../vfx/LightShafts';

const DEG = Math.PI / 180;

/** Synthesized maps of the last arena built, reused when the same arena loads again. */
let mapCache: { key: string; maps: Map<string, MaterialMaps> } | null = null;

/**
 * Builds an arena from data: static colliders for the layout (src/data/arenas.ts) and sculpted,
 * textured visuals from its look (src/data/arenaLooks.ts): a flagstone / earth / cave floor with
 * blended patches, ruined masonry or rock walls, fluted columns, boulders, rubble, bones,
 * stalagmites, a cliff ring and far peaks. Surfaces are synthesized PBR maps sampled triplanar;
 * props are instanced (one draw call per prop type).
 */
export class ArenaBuilder {
  readonly objects: Object3D[] = [];
  readonly look: ArenaLook;
  private readonly flameSpots: { x: number; y: number; z: number; size: number }[] = [];
  private flames: Flames | null = null;
  private fog: GroundFog | null = null;
  private shafts: LightShafts | null = null;
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler();
  private readonly p = new Vector3();
  private readonly s = new Vector3();
  private readonly rand: () => number;
  /** Keep-out circles for set dressing (x, z, r): spawns, the boss, the dummy. */
  private readonly keepOut: [number, number, number][] = [];
  colliderCount = 0;

  constructor(
    private readonly def: ArenaDef,
    private readonly physics: PhysicsWorld,
    preset: QualityPreset,
    renderer: WebGLRenderer,
  ) {
    this.look = ARENA_LOOKS[def.id as ArenaId];
    this.rand = mulberry32(def.id.length * 977 + 13);
    const L = this.look;
    const size = preset.textureMaxSize >= 1024 ? 1024 : 512;
    const maps = this.synthesize(renderer, size, preset.anisotropy);
    const get = (k: string): MaterialMaps => {
      const v = maps.get(k);
      if (v === undefined) throw new Error(`missing maps ${k}`);
      return v;
    };

    const floorMat = this.mat(
      createTriplanarMaterial(get('floor'), {
        scale: L.floor.scale,
        flat: true,
        macro: 0.35,
        normalScale: 1,
        patch: { maps: get('floorPatch'), scale: L.floorPatch.scale, amount: 0.45 },
      }),
    );
    const wallMat = this.mat(
      createTriplanarMaterial(get('wall'), { scale: L.wall.scale, macro: 0.3, aoDirect: 0.6 }),
    );
    const rockMat = this.mat(
      createTriplanarMaterial(get('rock'), { scale: L.rock.scale, macro: 0.3, aoDirect: 0.7 }),
    );
    const stoneMat = this.mat(
      createTriplanarMaterial(get('stone'), {
        scale: this.stoneLook().scale,
        macro: 0.2,
        aoDirect: 0.65,
      }),
    );

    const [sx, , sz] = def.spawn;
    this.keepOut.push(
      [sx, sz, 3.5],
      [def.bossSpawn[0], def.bossSpawn[1], 4],
      [def.dummySpawn[0], def.dummySpawn[1], 2],
      ...def.spawnPoints.map(([x, z]): [number, number, number] => [x, z, 2]),
    );

    this.buildFloor(floorMat);
    if (L.wallKind === 'rock') this.buildRockWall(rockMat);
    else this.buildMasonryWall(wallMat, stoneMat);
    this.buildColumns(stoneMat);
    this.buildBlocks(stoneMat);
    this.buildRocks(rockMat);
    this.buildBackdrop(rockMat);
    this.buildRubble(rockMat);
    this.buildSpires(rockMat);
    this.buildFallenDrums(stoneMat);
    this.buildBones();
    this.buildBraziers();
    if (L.wallKind === 'masonry') this.buildTorches();
    this.flames = new Flames(this.flameSpots, def.palette.ember);
    this.objects.push(this.flames.mesh);
    if (preset.particleCount >= 120) {
      const fogColor = new Color(def.palette.fog).lerp(new Color(def.palette.moonlight), 0.1);
      this.fog = new GroundFog(def.floorRadius, fogColor.getHex(), 0.26);
      this.objects.push(...this.fog.meshes);
      // Moonlight through the haze (open skies) or through cracks in a cave roof.
      const open = L.sky.open;
      this.shafts = new LightShafts(
        def.floorRadius,
        def.lighting.moonDirection,
        new Color(def.palette.moonlight).lerp(new Color(L.sky.moon), 0.35).getHex(),
        open ? 0.34 : 0.26,
        open ? 5 : 4,
        this.rand,
        this.keepOut,
      );
      this.objects.push(this.shafts.mesh);
    }
  }

  /** Animated parts (fire, mist). */
  update(dtSec: number): void {
    this.flames?.update(dtSec);
    this.fog?.update(dtSec);
    this.shafts?.update(dtSec);
  }

  addTo(scene: Object3D): void {
    for (const o of this.objects) scene.add(o);
  }

  dispose(): void {
    this.flames?.dispose();
    this.fog?.dispose();
    this.shafts?.dispose();
    for (const o of this.objects) o.removeFromParent();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    // Synthesized maps stay cached for a quick restart / next stage in the same arena.
    this.objects.length = 0;
  }

  // ------------------------------------------------------------------ surfaces

  private synthesize(
    renderer: WebGLRenderer,
    size: number,
    aniso: number,
  ): Map<string, MaterialMaps> {
    const L = this.look;
    const key = `${this.def.id}:${size}:${aniso}`;
    if (mapCache !== null && mapCache.key === key) return mapCache.maps;
    if (mapCache !== null) for (const m of mapCache.maps.values()) m.dispose();
    const synth = new TextureSynth(renderer);
    const maps = new Map<string, MaterialMaps>();
    const build = (name: string, s: SurfaceLook): void => {
      maps.set(name, synth.build(s, size, aniso));
    };
    build('floor', L.floor);
    build('floorPatch', L.floorPatch);
    build('wall', L.wall);
    build('rock', L.rock);
    build('stone', this.stoneLook());
    synth.dispose();
    mapCache = { key, maps };
    return maps;
  }

  /** Dressed stone: the rock program, smoother and in the wall's tones. */
  private stoneLook(): SurfaceLook {
    const L = this.look;
    return (
      L.stone ?? {
        material: 'rock',
        colors: [L.wall.colors[0], L.wall.colors[1], L.wall.colors[2]],
        seed: L.wall.seed + 100,
        normalStrength: 2.5,
        scale: 0.45,
      }
    );
  }

  // ------------------------------------------------------------------ layout pieces

  private buildFloor(material: Material): void {
    const r = this.def.floorRadius + this.def.wall.thickness + 9;
    const geo = this.geo(new CircleGeometry(r, 96, 0));
    geo.rotateX(-Math.PI / 2);
    geo.deleteAttribute('uv');
    // Baked occlusion: darker toward the wall foot.
    const pos = geo.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    const wallR = this.def.floorRadius;
    for (let i = 0; i < pos.count; i++) {
      const d = Math.hypot(pos.getX(i), pos.getZ(i));
      const ao = d > wallR - 1.5 ? 0.55 + 0.45 * Math.max(0, (wallR - d) / 1.5) : 1;
      colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = Math.max(0.45, ao);
    }
    geo.setAttribute('color', new BufferAttribute(colors, 3));
    const floor = new Mesh(geo, material);
    floor.receiveShadow = true;
    floor.name = 'floor';
    this.objects.push(floor);
    this.physics.addStaticCuboid(0, -0.5, 0, r + 4, 0.5, r + 4);
    this.colliderCount++;
  }

  /** Ruined masonry ring: wall slabs with broken tops, buttresses and capstones. */
  private buildMasonryWall(material: Material, stone: Material): void {
    const w = this.def.wall;
    const n = w.segments;
    const ringR = this.def.floorRadius + w.thickness / 2;
    const segLen = ((2 * Math.PI * ringR) / n) * 1.04;
    const variants = [0, 1, 2].map((v) => this.geo(this.slabGeometry(v + this.def.id.length)));
    const meshes = variants.map((g) => new InstancedMesh(g, material, n));
    const counts = [0, 0, 0];
    const buttressGeo = this.geo(stoneBlockGeometry(5));
    const buttress = new InstancedMesh(buttressGeo, stone, n * 3);
    let bCount = 0;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = Math.cos(a) * ringR;
      const z = Math.sin(a) * ringR;
      const h = w.height * (0.55 + this.rand() * 0.6);
      this.e.set(0, -a + Math.PI / 2, (this.rand() - 0.5) * 0.03);
      this.q.setFromEuler(this.e);
      this.p.set(x, 0, z);
      this.s.set(segLen, h, w.thickness);
      const v = i % 3;
      const mesh = meshes[v];
      if (mesh !== undefined) {
        mesh.setMatrixAt(counts[v] ?? 0, this.m.compose(this.p, this.q, this.s));
        counts[v] = (counts[v] ?? 0) + 1;
      }
      // Collider always full height so the ring stays sealed.
      this.e.set(0, -a + Math.PI / 2, 0);
      this.q.setFromEuler(this.e);
      this.physics.addStaticCuboid(x, w.height, z, segLen / 2, w.height, w.thickness / 2, this.q);
      this.colliderCount++;
      // Buttress at every other joint: two stacked blocks plus a capstone, leaning inward.
      if (i % 2 === 0) {
        const ja = a + Math.PI / n;
        const jr = ringR - w.thickness * 0.55;
        const bh = Math.min(h, w.height) * (0.7 + this.rand() * 0.4);
        for (let k = 0; k < 3; k++) {
          const lift = k === 2 ? bh + 0.15 : (bh / 2) * k + bh / 4;
          const scale = k === 2 ? [1.5, 0.35, 1.3] : [1.1, bh / 2, 1];
          this.e.set(0, -ja + Math.PI / 2 + (this.rand() - 0.5) * 0.1, (this.rand() - 0.5) * 0.05);
          this.q.setFromEuler(this.e);
          this.p.set(Math.cos(ja) * jr, lift, Math.sin(ja) * jr);
          this.s.set(scale[0] ?? 1, scale[1] ?? 1, scale[2] ?? 1);
          buttress.setMatrixAt(bCount++, this.m.compose(this.p, this.q, this.s));
        }
      }
    }
    meshes.forEach((mesh, v) => {
      mesh.count = counts[v] ?? 0;
      this.finishInstanced(mesh, `wall-${v}`);
    });
    buttress.count = bCount;
    this.finishInstanced(buttress, 'buttresses');
  }

  /** A unit wall slab (1×1×1 from y 0) whose top edge is broken by noise. */
  private slabGeometry(seed: number): BufferGeometry {
    const box = new BoxGeometry(1, 1, 1, 10, 6, 2);
    box.deleteAttribute('uv');
    box.translate(0, 0.5, 0);
    const g = mergeVertices(box);
    box.dispose();
    const pos = g.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      let y = pos.getY(i);
      const z = pos.getZ(i);
      if (y > 0.99) {
        const n = fbm(x * 3 + seed, seed * 0.3, z, 3);
        y = 0.82 + n * 0.35 + (Math.abs(x) > 0.45 ? 0.08 : 0);
      } else if (y > 0.5) {
        y *= 1 + fbm(x * 2 + seed, y * 2, z, 2) * 0.05;
      }
      pos.setY(i, Math.max(0.3, y));
      // Occlusion: darker at the foot (contact with the floor) and in the broken crown.
      const ao = 0.5 + 0.5 * Math.min(1, y * 2.5);
      colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = ao;
    }
    g.setAttribute('color', new BufferAttribute(colors, 3));
    g.computeVertexNormals();
    return g;
  }

  /** Cave: a craggy cliff ring stands in for the wall (colliders as for masonry). */
  private buildRockWall(material: Material): void {
    const w = this.def.wall;
    const n = w.segments;
    const ringR = this.def.floorRadius + w.thickness / 2;
    const segLen = ((2 * Math.PI * ringR) / n) * 1.04;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.e.set(0, -a + Math.PI / 2, 0);
      this.q.setFromEuler(this.e);
      this.physics.addStaticCuboid(
        Math.cos(a) * ringR,
        w.height,
        Math.sin(a) * ringR,
        segLen / 2,
        w.height,
        w.thickness / 2,
        this.q,
      );
      this.colliderCount++;
    }
    const cliff = new Mesh(
      this.geo(
        cliffRingGeometry(this.def.floorRadius - 0.2, this.look.backdrop.cliffHeight, 3, 128, 18),
      ),
      material,
    );
    cliff.receiveShadow = true;
    cliff.name = 'cave-wall';
    this.objects.push(cliff);
  }

  /** Columns built to their real size and merged (one draw call, base/capital proportions kept). */
  private buildColumns(material: Material): void {
    const list = this.def.pillars;
    if (list.length === 0) return;
    const parts = list.map((pl, i) => {
      const g = columnGeometry(31 + i * 7, pl.height < 5, pl.height, pl.radius);
      g.rotateY(this.rand() * Math.PI * 2);
      g.translate(pl.x, 0, pl.z);
      this.physics.addStaticCylinder(pl.x, pl.height / 2, pl.z, pl.height / 2, pl.radius * 1.05);
      this.colliderCount++;
      return g;
    });
    const merged = mergeGeometries(parts, false);
    for (const g of parts) g.dispose();
    if (merged === null) throw new Error('columns merge failed');
    const mesh = new Mesh(this.geo(merged), material);
    mesh.name = 'columns';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.objects.push(mesh);
  }

  private buildBlocks(material: Material): void {
    const list = this.def.blocks;
    if (list.length === 0) return;
    const mesh = new InstancedMesh(this.geo(stoneBlockGeometry(2)), material, list.length);
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

  private buildRocks(material: Material): void {
    const list = this.def.rocks;
    if (list.length === 0) return;
    const variants = [rockGeometry(1, 4), rockGeometry(2, 4, 1.4)].map((g) => this.geo(g));
    const meshes = variants.map((g) => new InstancedMesh(g, material, list.length));
    const counts = [0, 0];
    list.forEach((r, i) => {
      this.e.set((this.rand() - 0.5) * 0.4, this.rand() * Math.PI * 2, (this.rand() - 0.5) * 0.4);
      this.q.setFromEuler(this.e);
      this.p.set(r.x, r.scale * 0.32, r.z);
      this.s.set(r.scale * 1.25, r.scale * 1.05, r.scale * 1.1);
      const v = i % 2;
      meshes[v]?.setMatrixAt(counts[v] ?? 0, this.m.compose(this.p, this.q, this.s));
      counts[v] = (counts[v] ?? 0) + 1;
      this.physics.addStaticBall(r.x, r.scale * 0.45, r.z, r.scale * 0.95);
      this.colliderCount++;
    });
    meshes.forEach((mesh, v) => {
      mesh.count = counts[v] ?? 0;
      this.finishInstanced(mesh, `rocks-${v}`);
    });
  }

  // ------------------------------------------------------------------ backdrop & dressing

  private buildBackdrop(material: Material): void {
    const b = this.look.backdrop;
    if (this.look.wallKind !== 'rock') {
      const cliff = new Mesh(
        this.geo(
          cliffRingGeometry(
            this.def.floorRadius + this.def.wall.thickness + 5,
            b.cliffHeight,
            7,
            128,
            16,
          ),
        ),
        material,
      );
      cliff.name = 'cliffs';
      cliff.receiveShadow = false;
      this.objects.push(cliff);
    }
    if (b.peaks) {
      const peaks = new Mesh(this.geo(cliffRingGeometry(88, 42, 13, 96, 8)), material);
      peaks.name = 'peaks';
      this.objects.push(peaks);
    }
  }

  private dressingSpot(minR: number, maxR: number, pad: number): [number, number] | null {
    for (let tries = 0; tries < 12; tries++) {
      const a = this.rand() * Math.PI * 2;
      const r = minR + Math.sqrt(this.rand()) * (maxR - minR);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const blocked =
        this.keepOut.some(([kx, kz, kr]) => Math.hypot(x - kx, z - kz) < kr + pad) ||
        this.def.pillars.some((p) => Math.hypot(x - p.x, z - p.z) < p.radius * 1.4 + pad) ||
        this.def.braziers.some((br) => Math.hypot(x - br.x, z - br.z) < 1 + pad);
      if (!blocked) return [x, z];
    }
    return null;
  }

  /** Small stones along the wall foot and around column bases (no colliders). */
  private buildRubble(material: Material): void {
    const n = this.look.dressing.rubble;
    if (n <= 0) return;
    const mesh = new InstancedMesh(this.geo(rockGeometry(5, 2, 1.2)), material, n);
    const R = this.def.floorRadius;
    let c = 0;
    for (let i = 0; i < n; i++) {
      let spot: [number, number] | null;
      const pl = this.def.pillars[i % Math.max(1, this.def.pillars.length)];
      if (i % 4 === 0 && pl !== undefined) {
        const a = this.rand() * Math.PI * 2;
        const d = pl.radius * (1.4 + this.rand() * 0.8);
        spot = [pl.x + Math.cos(a) * d, pl.z + Math.sin(a) * d];
      } else spot = this.dressingSpot(R - 2.6, R - 0.4, 0);
      if (spot === null) continue;
      const s = 0.12 + this.rand() * this.rand() * 0.45;
      this.e.set(this.rand() * 3, this.rand() * 6, this.rand() * 3);
      this.q.setFromEuler(this.e);
      this.p.set(spot[0], s * 0.25, spot[1]);
      this.s.set(s * (0.8 + this.rand() * 0.6), s * 0.7, s);
      mesh.setMatrixAt(c++, this.m.compose(this.p, this.q, this.s));
    }
    mesh.count = c;
    this.finishInstanced(mesh, 'rubble', false);
    mesh.receiveShadow = true;
  }

  /** Cave stalagmites near the walls (large ones block movement). */
  private buildSpires(material: Material): void {
    const n = this.look.dressing.spires;
    if (n <= 0) return;
    const mesh = new InstancedMesh(this.geo(spireGeometry(4)), material, n);
    const R = this.def.floorRadius;
    let c = 0;
    for (let i = 0; i < n; i++) {
      const spot = this.dressingSpot(R - 4, R - 0.6, 0.6);
      if (spot === null) continue;
      const big = this.rand() < 0.35;
      const h = big ? 2.5 + this.rand() * 3.5 : 0.6 + this.rand() * 1.4;
      const r = h * (0.18 + this.rand() * 0.08);
      this.e.set((this.rand() - 0.5) * 0.15, this.rand() * 6, (this.rand() - 0.5) * 0.15);
      this.q.setFromEuler(this.e);
      this.p.set(spot[0], -0.05, spot[1]);
      this.s.set(r, h, r);
      mesh.setMatrixAt(c++, this.m.compose(this.p, this.q, this.s));
      if (big) {
        this.physics.addStaticCylinder(spot[0], h / 2, spot[1], h / 2, r * 0.6);
        this.colliderCount++;
      }
    }
    mesh.count = c;
    this.finishInstanced(mesh, 'spires');
  }

  /** Fallen column drums lying near the wall (with colliders). */
  private buildFallenDrums(material: Material): void {
    const n = this.look.dressing.brokenColumns;
    if (n <= 0) return;
    // A unit drum (1 m tall, 1 m radius), scaled per instance.
    const geo = this.geo(columnGeometry(17, true, 1.3, 1));
    const mesh = new InstancedMesh(geo, material, n);
    const R = this.def.floorRadius;
    let c = 0;
    for (let i = 0; i < n; i++) {
      const spot = this.dressingSpot(R - 4.5, R - 1.5, 1.2);
      if (spot === null) continue;
      const len = 1.4 + this.rand() * 1.4;
      const rad = 0.55 + this.rand() * 0.2;
      const yaw = this.rand() * Math.PI * 2;
      this.e.set(0, yaw, Math.PI / 2, 'YXZ');
      this.q.setFromEuler(this.e);
      this.p.set(
        spot[0] - Math.cos(yaw) * len * 0.35,
        rad * 0.95,
        spot[1] + Math.sin(yaw) * len * 0.35,
      );
      this.s.set(rad, len / 1.3, rad);
      mesh.setMatrixAt(c++, this.m.compose(this.p, this.q, this.s));
      this.e.set(0, yaw, 0);
      this.q.setFromEuler(this.e);
      this.physics.addStaticCuboid(spot[0], rad, spot[1], (len * 0.6) / 2 + 0.3, rad, rad, this.q);
      this.colliderCount++;
    }
    mesh.count = c;
    this.finishInstanced(mesh, 'fallen-drums');
  }

  private buildBones(): void {
    const n = this.look.dressing.bones;
    if (n <= 0) return;
    const boneMat = this.mat(
      new MeshStandardMaterial({
        color: 0xb8ab94,
        roughness: 0.75,
        metalness: 0,
        vertexColors: true,
      }),
    );
    const bones = new InstancedMesh(this.geo(boneGeometry()), boneMat, n * 2);
    const skulls = new InstancedMesh(this.geo(skullGeometry()), boneMat, n);
    const R = this.def.floorRadius;
    let nb = 0;
    let ns = 0;
    for (let i = 0; i < n; i++) {
      const spot = this.dressingSpot(4, R - 1, 0.3);
      if (spot === null) continue;
      const [x, z] = spot;
      // A small pile: a skull and one or two bones.
      this.e.set(-0.3 + this.rand() * 0.6, this.rand() * 6, this.rand() * 0.4);
      this.q.setFromEuler(this.e);
      this.p.set(x, 0.1, z);
      this.s.setScalar(0.9 + this.rand() * 0.4);
      skulls.setMatrixAt(ns++, this.m.compose(this.p, this.q, this.s));
      const extra = 1 + Math.floor(this.rand() * 2);
      for (let k = 0; k < extra; k++) {
        this.e.set(0, this.rand() * 6, 0);
        this.q.setFromEuler(this.e);
        this.p.set(x + (this.rand() - 0.5) * 0.8, 0.05, z + (this.rand() - 0.5) * 0.8);
        this.s.setScalar(0.7 + this.rand() * 0.5);
        bones.setMatrixAt(nb++, this.m.compose(this.p, this.q, this.s));
      }
    }
    bones.count = nb;
    skulls.count = ns;
    this.finishInstanced(bones, 'bones', false);
    this.finishInstanced(skulls, 'skulls', false);
    bones.receiveShadow = true;
    skulls.receiveShadow = true;
  }

  private buildBraziers(): void {
    const list = this.def.braziers;
    if (list.length === 0) return;
    const metal = this.mat(
      new MeshStandardMaterial({ color: 0x2a2220, roughness: 0.45, metalness: 0.85 }),
    );
    const standGeo = this.geo(new CylinderGeometry(0.07, 0.14, 1.2, 10));
    standGeo.translate(0, 0.6, 0);
    const footGeo = this.geo(new ConeGeometry(0.42, 0.25, 6));
    footGeo.translate(0, 0.12, 0);
    const bowlGeo = this.geo(new CylinderGeometry(0.46, 0.18, 0.34, 16, 1, true));
    bowlGeo.translate(0, 1.32, 0);
    const coalGeo = this.geo(new CircleGeometry(0.4, 16));
    coalGeo.rotateX(-Math.PI / 2);
    coalGeo.translate(0, 1.42, 0);
    const fire = new Color(this.def.palette.ember).multiplyScalar(2.2);
    const coalMat = this.mat(new MeshBasicMaterial({ color: fire }));
    const stands = new InstancedMesh(standGeo, metal, list.length);
    const feet = new InstancedMesh(footGeo, metal, list.length);
    const bowls = new InstancedMesh(bowlGeo, metal, list.length);
    const coals = new InstancedMesh(coalGeo, coalMat, list.length);
    list.forEach((b, i) => {
      this.q.identity();
      this.p.set(b.x, 0, b.z);
      this.s.set(1, 1, 1);
      this.m.compose(this.p, this.q, this.s);
      stands.setMatrixAt(i, this.m);
      feet.setMatrixAt(i, this.m);
      bowls.setMatrixAt(i, this.m);
      coals.setMatrixAt(i, this.m);
      this.physics.addStaticCylinder(b.x, 0.7, b.z, 0.7, 0.42);
      this.colliderCount++;
      this.flameSpots.push({ x: b.x, y: 1.36, z: b.z, size: 0.7 });
    });
    this.finishInstanced(stands, 'brazier-stands');
    this.finishInstanced(feet, 'brazier-feet');
    this.finishInstanced(bowls, 'brazier-bowls');
    this.finishInstanced(coals, 'brazier-coals', false);
  }

  /** Iron torch brackets on the inner face of the wall, each with a flame. */
  private buildTorches(): void {
    const w = this.def.wall;
    const count = Math.max(6, Math.round(w.segments / 3.5));
    const iron = this.mat(
      new MeshStandardMaterial({ color: 0x241e1c, roughness: 0.5, metalness: 0.8 }),
    );
    const armGeo = this.geo(new CylinderGeometry(0.035, 0.05, 0.6, 6));
    armGeo.rotateX(-0.6);
    armGeo.translate(0, 0, 0.18);
    const cupGeo = this.geo(new CylinderGeometry(0.13, 0.05, 0.2, 8, 1, true));
    cupGeo.translate(0, 0.22, 0.36);
    const arms = new InstancedMesh(armGeo, iron, count);
    const cups = new InstancedMesh(cupGeo, iron, count);
    const r = this.def.floorRadius - 0.05;
    const y = Math.min(w.height * 0.5, 1.6);
    for (let i = 0; i < count; i++) {
      const a = ((i + 0.5) / count) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      // Face the arena centre.
      this.e.set(0, Math.atan2(-x, -z), 0);
      this.q.setFromEuler(this.e);
      this.p.set(x, y, z);
      this.s.set(1, 1, 1);
      this.m.compose(this.p, this.q, this.s);
      arms.setMatrixAt(i, this.m);
      cups.setMatrixAt(i, this.m);
      const fx = x - (x / r) * 0.36;
      const fz = z - (z / r) * 0.36;
      this.flameSpots.push({ x: fx, y: y + 0.28, z: fz, size: 0.55 });
    }
    this.finishInstanced(arms, 'torch-arms', false);
    this.finishInstanced(cups, 'torch-cups', false);
  }

  // ------------------------------------------------------------------ helpers

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
}
