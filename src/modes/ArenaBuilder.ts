import {
  BoxGeometry,
  BufferAttribute,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Group,
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
import { ARENA_ASSETS, arenaAssetRequest, type SurfaceRef } from '../data/arenaAssets';
import { ARENA_LOOKS, type ArenaLook, type SurfaceLook } from '../data/arenaLooks';
import type { ArenaDef, ArenaId } from '../data/arenas';
import type { QualityPreset } from '../data/quality';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import {
  flakeGeometry,
  pebbleGeometry,
  scatter,
  shardGeometry,
  tuftGeometry,
} from '../render/env/clutter';
import type { AssetLibrary } from '../render/env/AssetLibrary';
import { puddleGeometry } from '../render/env/landmarks';
import { PropBatch, type BatchMaterial } from '../render/env/PropBatch';
import {
  createClothMaterial,
  createCrystalMaterial,
  createGlowMaterial,
  createIronMaterial,
  createPuddleMaterial,
} from '../render/env/propMaterials';
import { prep } from '../render/env/props';
import {
  cliffRingGeometry,
  columnGeometry,
  fbm,
  rockGeometry,
  spireGeometry,
  stoneBlockGeometry,
} from '../render/env/shapes';
import { TextureSynth, type MaterialMaps } from '../render/env/TextureSynth';
import { createTriplanarMaterial } from '../render/env/triplanar';
import { AmbientMotes } from '../vfx/AmbientMotes';
import { Drips } from '../vfx/Drips';
import { Flames } from '../vfx/Flames';
import { GlowPools } from '../vfx/GlowPools';
import { GroundFog } from '../vfx/GroundFog';
import { GroundSigil } from '../vfx/GroundSigil';
import { LavaSurface } from '../vfx/LavaSurface';
import { LightShafts } from '../vfx/LightShafts';
import { SmokeCards } from '../vfx/SmokeCards';
import { ArenaDresser, type DressingPart } from './arenaDressing';
import { ScannedProps } from './ScannedProps';

const DEG = Math.PI / 180;

/** Synthesized maps of the last arena built, reused when the same arena loads again. */
let mapCache: { key: string; maps: Map<string, MaterialMaps> } | null = null;

/** Ground clutter is kept outside this fraction of the floor radius (telegraphs stay clean). */
/** Procedural dressing that scanned props replace (the rest: lava, cloth, chains, fungus, fog). */
const SCANNED_REPLACES: ReadonlySet<DressingPart> = new Set<DressingPart>([
  'statues',
  'sarcophagi',
  'cages',
  'racks',
  'barricades',
  'trees',
  'roots',
  'skullPiles',
  'remains',
  'candles',
  'gargoyles',
  'puddles',
]);

export const CLUTTER_CLEAR_FRACTION = 0.42;

/**
 * Builds an arena from data: static colliders for the layout (src/data/arenas.ts) and sculpted,
 * textured visuals from its look (src/data/arenaLooks.ts): a synthesized floor with glowing
 * cracks / veins / inlays and a carved sigil at the centre, ruined masonry or rock walls, columns,
 * boulders, the set dressing and landmark placed by ArenaDresser, ground clutter, and the living
 * parts — fire, light pools, lava, banners in the wind, motes, smoke and fog, drips, a floating
 * spire. Static geometry is merged per material (one draw call each); clutter is instanced.
 */
export class ArenaBuilder {
  readonly objects: Object3D[] = [];
  readonly look: ArenaLook;
  private readonly flameSpots: { x: number; y: number; z: number; size: number }[] = [];
  private flames: Flames | null = null;
  private fog: GroundFog | null = null;
  private shafts: LightShafts | null = null;
  private readonly disposables: { dispose(): void }[] = [];
  private floating: Group | null = null;
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private readonly batch = new PropBatch();
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler();
  private readonly p = new Vector3();
  private readonly s = new Vector3();
  private readonly rand: () => number;
  /** Keep-out circles for set dressing (x, z, r): spawns, the boss, the dummy. */
  private readonly keepOut: [number, number, number][] = [];
  private readonly wallInfo: {
    heights: number[];
    buttresses: { x: number; y: number; z: number; a: number }[];
    torchAngles: number[];
  } = { heights: [], buttresses: [], torchAngles: [] };
  /** Seconds, shared by every animated arena material. */
  private readonly time = { value: 0 };
  colliderCount = 0;
  /** Built from the scanned asset set (real surfaces and props). */
  readonly scanned: boolean;

  constructor(
    private readonly def: ArenaDef,
    private readonly physics: PhysicsWorld,
    private readonly preset: QualityPreset,
    renderer: WebGLRenderer,
    assets: AssetLibrary | null = null,
  ) {
    this.look = ARENA_LOOKS[def.id as ArenaId];
    this.rand = mulberry32(def.id.length * 977 + 13);
    const L = this.look;
    // Scanned assets when they are loaded (always in the game; unit tests build without them).
    const A = ARENA_ASSETS[def.id as ArenaId];
    const lib = assets !== null && assets.has(arenaAssetRequest(def.id as ArenaId)) ? assets : null;
    this.scanned = lib !== null;
    const size = preset.textureMaxSize >= 1024 ? 1024 : 512;
    const maps = lib === null ? this.synthesize(renderer, size, preset.anisotropy) : null;
    const scannedMaps: Record<string, SurfaceRef> = {
      floor: A.floor,
      floorPatch: A.floorPatch,
      wall: A.wall,
      rock: A.rock,
      stone: A.stone,
    };
    const get = (k: string): MaterialMaps => {
      const ref = scannedMaps[k];
      const v = lib !== null && ref !== undefined ? lib.surface(ref.id) : maps?.get(k);
      if (v === undefined) throw new Error(`missing maps ${k}`);
      return v;
    };
    /** Colour tint of a scanned surface (white for synthesized ones, already coloured). */
    const tintOf = (k: string): number =>
      lib !== null ? (scannedMaps[k]?.tint ?? 0xffffff) : 0xffffff;
    /** Texture repeats per metre: scanned tiles at their real size. */
    const scaleOf = (k: string, synth: number): number => {
      const ref = scannedMaps[k];
      return lib !== null && ref !== undefined ? 1 / ref.size : synth;
    };

    const floorMat = this.mat(
      createTriplanarMaterial(get('floor'), {
        scale: scaleOf('floor', L.floor.scale),
        tint: tintOf('floor'),
        flat: true,
        macro: 0.45,
        normalScale: 1,
        patch: {
          maps: get('floorPatch'),
          scale: scaleOf('floorPatch', L.floorPatch.scale),
          amount: 0.45,
        },
        radius: def.floorRadius,
        glow: { ...L.floorGlow, time: this.time },
      }),
    );
    const wallMat = this.mat(
      createTriplanarMaterial(get('wall'), {
        scale: scaleOf('wall', L.wall.scale),
        macro: 0.3,
        aoDirect: 0.6,
      }),
    );
    const rockMat = this.mat(
      createTriplanarMaterial(get('rock'), {
        scale: scaleOf('rock', L.rock.scale),
        macro: 0.3,
        aoDirect: 0.7,
      }),
    );
    const stoneMat = this.mat(
      createTriplanarMaterial(get('stone'), {
        scale: scaleOf('stone', this.stoneLook().scale),
        tint: tintOf('stone'),
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
    else this.buildMasonryWall(wallMat, lib === null || A.castle === undefined);
    this.buildColumns();
    this.buildBlocks();
    this.buildRocks(lib === null || A.boulders === undefined);
    this.buildBackdrop(rockMat);
    if (lib === null) {
      this.buildRubble();
      this.buildFallenDrums();
    }
    this.buildSpires();
    this.buildBraziers(lib === null || A.brazier === undefined);
    if (L.wallKind === 'masonry') this.buildTorches();

    const dresser = new ArenaDresser(
      def,
      L,
      this.batch,
      physics,
      this.rand,
      this.keepOut,
      this.wallInfo,
    );
    dresser.dress(lib === null ? undefined : SCANNED_REPLACES);
    this.colliderCount += dresser.colliders;
    this.flameSpots.push(...dresser.flames);
    if (lib !== null) {
      const props = new ScannedProps(lib, def, A, physics, preset, this.rand, this.keepOut);
      props.build();
      this.objects.push(...props.objects);
      this.flameSpots.push(...props.flames);
      this.colliderCount += props.colliders;
      this.disposables.push(props);
    }

    this.buildBatches(stoneMat, rockMat);
    this.buildFloating(dresser, stoneMat);
    this.buildEffects(dresser);
    if (preset.clutterDensity > 0) this.buildClutter(rockMat, stoneMat);

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

  /** Animated parts: fire, mist, banners, lava, motes and the floating spire share one clock. */
  update(dtSec: number): void {
    this.time.value = (this.time.value + dtSec) % 3600;
    this.flames?.update(dtSec);
    this.fog?.update(dtSec);
    this.shafts?.update(dtSec);
    if (this.floating !== null) {
      this.floating.rotation.y = this.time.value * 0.12;
      this.floating.position.y = 9.5 + Math.sin(this.time.value * 0.5) * 0.12;
    }
  }

  addTo(scene: Object3D): void {
    for (const o of this.objects) scene.add(o);
  }

  dispose(): void {
    this.flames?.dispose();
    this.fog?.dispose();
    this.shafts?.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.batch.dispose();
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

  /**
   * Ruined masonry ring: wall slabs with broken tops (merged, one draw call), buttresses and
   * capstones (stone batch). Records segment heights and buttress caps for the dressing.
   */
  private buildMasonryWall(material: Material, visual: boolean): void {
    const w = this.def.wall;
    const n = w.segments;
    const ringR = this.def.floorRadius + w.thickness / 2;
    const segLen = ((2 * Math.PI * ringR) / n) * 1.04;
    const variants = [0, 1, 2].map((v) => this.slabGeometry(v + this.def.id.length));
    const slabs: BufferGeometry[] = [];
    const buttress = stoneBlockGeometry(5);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = Math.cos(a) * ringR;
      const z = Math.sin(a) * ringR;
      const h = w.height * (0.55 + this.rand() * 0.6);
      this.wallInfo.heights.push(h * 0.82);
      this.e.set(0, -a + Math.PI / 2, (this.rand() - 0.5) * 0.03);
      this.q.setFromEuler(this.e);
      this.p.set(x, 0, z);
      this.s.set(segLen, h, w.thickness);
      const slab = visual ? variants[i % 3]?.clone() : undefined;
      if (slab !== undefined) {
        slab.applyMatrix4(this.m.compose(this.p, this.q, this.s));
        slabs.push(slab);
      }
      // Collider always full height so the ring stays sealed.
      this.e.set(0, -a + Math.PI / 2, 0);
      this.q.setFromEuler(this.e);
      this.physics.addStaticCuboid(x, w.height, z, segLen / 2, w.height, w.thickness / 2, this.q);
      this.colliderCount++;
      // Buttress at every other joint: two stacked blocks plus a capstone, leaning inward.
      if (visual && i % 2 === 0) {
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
          this.batch.add('stone', buttress, this.m.compose(this.p, this.q, this.s));
        }
        this.wallInfo.buttresses.push({
          x: Math.cos(ja) * jr,
          y: bh + 0.15 + 0.175,
          z: Math.sin(ja) * jr,
          a: ja,
        });
      }
    }
    for (const v of variants) v.dispose();
    buttress.dispose();
    if (!visual) return;
    const merged = mergeGeometries(slabs, false);
    for (const g of slabs) g.dispose();
    if (merged === null) throw new Error('wall merge failed');
    const mesh = new Mesh(this.geo(merged), material);
    mesh.name = 'wall';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.objects.push(mesh);
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

  /** Columns built to their real size (base/capital proportions kept), into the stone batch. */
  private buildColumns(): void {
    this.def.pillars.forEach((pl, i) => {
      const g = columnGeometry(31 + i * 7, pl.height < 5, pl.height, pl.radius);
      this.e.set(0, this.rand() * Math.PI * 2, 0);
      this.q.setFromEuler(this.e);
      this.batch.add(
        'stone',
        g,
        this.m.compose(this.p.set(pl.x, 0, pl.z), this.q, this.s.set(1, 1, 1)),
      );
      g.dispose();
      this.physics.addStaticCylinder(pl.x, pl.height / 2, pl.z, pl.height / 2, pl.radius * 1.05);
      this.colliderCount++;
    });
  }

  private buildBlocks(): void {
    const list = this.def.blocks;
    if (list.length === 0) return;
    const block = stoneBlockGeometry(2);
    for (const b of list) {
      this.e.set((b.tiltXDeg ?? 0) * DEG, b.rotationYDeg * DEG, 0, 'YXZ');
      this.q.setFromEuler(this.e);
      this.p.set(b.position[0], b.position[1], b.position[2]);
      this.s.set(b.size[0], b.size[1], b.size[2]);
      this.batch.add('stone', block, this.m.compose(this.p, this.q, this.s));
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
    }
    block.dispose();
  }

  /** Rock outcrops: colliders always, procedural visuals unless scanned boulders replace them. */
  private buildRocks(visual: boolean): void {
    const list = this.def.rocks;
    if (list.length === 0) return;
    const variants = [rockGeometry(1, 3), rockGeometry(2, 3, 1.4)];
    list.forEach((r, i) => {
      this.e.set((this.rand() - 0.5) * 0.4, this.rand() * Math.PI * 2, (this.rand() - 0.5) * 0.4);
      this.q.setFromEuler(this.e);
      this.p.set(r.x, r.scale * 0.32, r.z);
      this.s.set(r.scale * 1.25, r.scale * 1.05, r.scale * 1.1);
      const g = variants[i % 2];
      if (visual && g !== undefined)
        this.batch.add('rock', g, this.m.compose(this.p, this.q, this.s));
      this.physics.addStaticBall(r.x, r.scale * 0.45, r.z, r.scale * 0.95);
      this.colliderCount++;
    });
    for (const g of variants) g.dispose();
  }

  // ------------------------------------------------------------------ backdrop & dressing

  /** Cliffs outside the wall and the far peaks, merged into one mesh (no shadows). */
  private buildBackdrop(material: Material): void {
    const b = this.look.backdrop;
    const parts: BufferGeometry[] = [];
    if (this.look.wallKind !== 'rock') {
      parts.push(
        cliffRingGeometry(
          this.def.floorRadius + this.def.wall.thickness + 5,
          b.cliffHeight,
          7,
          128,
          16,
        ),
      );
    }
    if (b.peaks) parts.push(cliffRingGeometry(88, 42, 13, 96, 8));
    if (parts.length === 0) return;
    const merged = mergeGeometries(parts, false);
    for (const g of parts) g.dispose();
    if (merged === null) throw new Error('backdrop merge failed');
    const mesh = new Mesh(this.geo(merged), material);
    mesh.name = 'backdrop';
    this.objects.push(mesh);
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
  private buildRubble(): void {
    const n = this.look.dressing.rubble;
    if (n <= 0) return;
    const geo = rockGeometry(5, 1, 1.2);
    const R = this.def.floorRadius;
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
      this.batch.add('rock', geo, this.m.compose(this.p, this.q, this.s));
    }
    geo.dispose();
  }

  /** Cave stalagmites near the walls (large ones block movement). */
  private buildSpires(): void {
    const n = this.look.dressing.spires;
    if (n <= 0) return;
    const geo = spireGeometry(4);
    const R = this.def.floorRadius;
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
      this.batch.add('rock', geo, this.m.compose(this.p, this.q, this.s));
      if (big) {
        this.physics.addStaticCylinder(spot[0], h / 2, spot[1], h / 2, r * 0.6);
        this.colliderCount++;
      }
    }
    geo.dispose();
  }

  /** Fallen column drums lying near the wall (with colliders). */
  private buildFallenDrums(): void {
    const n = this.look.dressing.brokenColumns;
    if (n <= 0) return;
    // A unit drum (1 m tall, 1 m radius), scaled per instance.
    const geo = columnGeometry(17, true, 1.3, 1);
    const R = this.def.floorRadius;
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
      this.batch.add('stone', geo, this.m.compose(this.p, this.q, this.s));
      this.e.set(0, yaw, 0);
      this.q.setFromEuler(this.e);
      this.physics.addStaticCuboid(spot[0], rad, spot[1], (len * 0.6) / 2 + 0.3, rad, rad, this.q);
      this.colliderCount++;
    }
    geo.dispose();
  }

  /** Iron braziers (or only their colliders, under scanned fire pits). */
  private buildBraziers(visual: boolean): void {
    const list = this.def.braziers;
    if (list.length === 0) return;
    if (!visual) {
      for (const b of list) {
        this.physics.addStaticCylinder(b.x, 0.35, b.z, 0.35, 0.7);
        this.colliderCount++;
      }
      return;
    }
    const stand = prep(new CylinderGeometry(0.07, 0.14, 1.2, 10), 0.8);
    stand.translate(0, 0.6, 0);
    const foot = prep(new ConeGeometry(0.42, 0.25, 6), 0.6);
    foot.translate(0, 0.12, 0);
    const bowl = prep(new CylinderGeometry(0.46, 0.18, 0.34, 16, 1, true), 0.9);
    bowl.translate(0, 1.32, 0);
    const coal = prep(new CylinderGeometry(0.4, 0.4, 0.04, 16, 1));
    coal.translate(0, 1.42, 0);
    const iron = this.look.tints.iron;
    const fire = new Color(this.def.palette.ember).multiplyScalar(2.6);
    for (const b of list) {
      this.m.makeTranslation(b.x, 0, b.z);
      for (const g of [stand, foot, bowl]) this.batch.add('iron', g, this.m, iron);
      this.batch.add('glow', coal, this.m, fire);
      this.physics.addStaticCylinder(b.x, 0.7, b.z, 0.7, 0.42);
      this.colliderCount++;
      this.flameSpots.push({ x: b.x, y: 1.36, z: b.z, size: 0.7 });
    }
    for (const g of [stand, foot, bowl, coal]) g.dispose();
  }

  /** Iron torch brackets on the inner face of the wall, each with a flame. */
  private buildTorches(): void {
    const w = this.def.wall;
    const count = Math.max(6, Math.round(w.segments / 3.5));
    const arm = prep(new CylinderGeometry(0.035, 0.05, 0.6, 6));
    arm.rotateX(-0.6);
    arm.translate(0, 0, 0.18);
    const cup = prep(new CylinderGeometry(0.13, 0.05, 0.2, 8, 1, true));
    cup.translate(0, 0.22, 0.36);
    const r = this.def.floorRadius - 0.05;
    const y = Math.min(w.height * 0.5, 1.6);
    for (let i = 0; i < count; i++) {
      const a = ((i + 0.5) / count) * Math.PI * 2;
      this.wallInfo.torchAngles.push(a);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      // Face the arena centre.
      this.e.set(0, Math.atan2(-x, -z), 0);
      this.q.setFromEuler(this.e);
      this.p.set(x, y, z);
      this.s.set(1, 1, 1);
      this.m.compose(this.p, this.q, this.s);
      this.batch.add('iron', arm, this.m, this.look.tints.iron);
      this.batch.add('iron', cup, this.m, this.look.tints.iron);
      const fx = x - (x / r) * 0.36;
      const fz = z - (z / r) * 0.36;
      this.flameSpots.push({ x: fx, y: y + 0.28, z: fz, size: 0.55 });
    }
    arm.dispose();
    cup.dispose();
  }

  // ------------------------------------------------------------------ merged meshes & effects

  /** One mesh per prop material from the batch. */
  private buildBatches(stoneMat: Material, rockMat: Material): void {
    const t = this.look.tints;
    const mats: Record<BatchMaterial, { mat: () => Material; cast: boolean }> = {
      stone: { mat: () => stoneMat, cast: true },
      rock: { mat: () => rockMat, cast: true },
      iron: { mat: () => this.mat(createIronMaterial(this.time)), cast: true },
      wood: {
        mat: () => this.mat(new MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })),
        cast: true,
      },
      bone: {
        mat: () => this.mat(new MeshStandardMaterial({ vertexColors: true, roughness: 0.62 })),
        cast: true,
      },
      glow: { mat: () => this.mat(createGlowMaterial(this.time)), cast: false },
      crystal: { mat: () => this.mat(createCrystalMaterial(this.time, t.crystal)), cast: true },
      cloth: { mat: () => this.mat(createClothMaterial(this.time, t.emblem, t.trim)), cast: false },
    };
    for (const kind of Object.keys(mats) as BatchMaterial[]) {
      const geo = this.batch.merge(kind);
      const spec = mats[kind];
      if (geo === null) continue;
      const mesh = new Mesh(this.geo(geo), spec.mat());
      mesh.name = `props-${kind}`;
      mesh.castShadow = spec.cast;
      mesh.receiveShadow = kind !== 'glow';
      this.objects.push(mesh);
    }
  }

  /** The floating landmark: its own group (stone + glow), turned in update(). */
  private buildFloating(dresser: ArenaDresser, stoneMat: Material): void {
    const f = dresser.floating;
    if (f === null) return;
    const group = new Group();
    group.position.set(f.x, f.y, f.z);
    group.name = 'floating-spire';
    const stone = f.parts.parts.stone;
    const glow = f.parts.parts.glow;
    if (stone !== undefined) {
      const mesh = new Mesh(this.geo(stone), stoneMat);
      mesh.castShadow = true;
      group.add(mesh);
    }
    if (glow !== undefined) {
      const c = new Color(this.look.tints.glow).multiplyScalar(4);
      const col = glow.getAttribute('color');
      for (let i = 0; i < col.count; i++) col.setXYZ(i, c.r, c.g, c.b);
      group.add(new Mesh(this.geo(glow), this.mat(createGlowMaterial(this.time))));
    }
    this.floating = group;
    this.objects.push(group);
  }

  private buildEffects(dresser: ArenaDresser): void {
    const L = this.look;
    const def = this.def;
    const ember = def.palette.ember;
    // Light pools under every fire (real lights stay at the braziers only).
    for (const b of def.braziers) {
      dresser.pools.push({
        x: b.x,
        z: b.z,
        radius: 4.5,
        color: ember,
        intensity: 0.7,
        flicker: 0.7,
      });
    }
    const wr = def.floorRadius - 0.9;
    for (const a of this.wallInfo.torchAngles) {
      dresser.pools.push({
        x: Math.cos(a) * wr,
        z: Math.sin(a) * wr,
        radius: 2.6,
        color: ember,
        intensity: 0.5,
        flicker: 0.8,
      });
    }
    const pools = new GlowPools(dresser.pools, this.time);
    this.disposables.push(pools);
    this.objects.push(pools.mesh);

    // Among scanned stone the sigil is a faint inlay, not a neon sign.
    const sigilColor = this.scanned
      ? new Color(L.fx.sigil.color).multiplyScalar(0.22).getHex()
      : L.fx.sigil.color;
    const sigil = new GroundSigil(L.fx.sigil.radius, sigilColor, L.fx.sigil.style, this.time);
    this.disposables.push(sigil);
    this.objects.push(sigil.mesh);

    if (dresser.lava.length > 0) {
      const merged = mergeGeometries(dresser.lava, false);
      for (const g of dresser.lava) g.dispose();
      if (merged === null) throw new Error('lava merge failed');
      const lava = new LavaSurface(merged, L.tints.glow, 0x120806, this.time);
      this.disposables.push(lava);
      this.objects.push(lava.mesh);
    }
    if (dresser.puddles.length > 0) {
      const mesh = new Mesh(
        this.geo(puddleGeometry(dresser.puddles)),
        this.mat(createPuddleMaterial(this.time, L.floorGlow.color)),
      );
      mesh.name = 'puddles';
      mesh.receiveShadow = true;
      this.objects.push(mesh);
    }
    if (dresser.farGlow !== null) {
      const mesh = new Mesh(
        this.geo(dresser.farGlow),
        this.mat(new MeshBasicMaterial({ vertexColors: true, fog: false })),
      );
      mesh.name = 'far-glow';
      this.objects.push(mesh);
    }
    if (!this.preset.ambientFx) return;
    const motes = new AmbientMotes(
      Math.round(this.preset.particleCount * 2.2),
      L.fx.motes,
      this.time,
      def.id.length,
    );
    this.disposables.push(motes);
    this.objects.push(motes.mesh);
    if (dresser.cards.length > 0) {
      const fogColor = new Color(def.palette.fog).lerp(new Color(def.palette.moonlight), 0.25);
      const cards = new SmokeCards(
        dresser.cards,
        { smoke: L.fx.smoke, glow: L.fx.smokeGlow, fog: fogColor.getHex() },
        this.time,
      );
      this.disposables.push(cards);
      this.objects.push(cards.mesh);
    }
    if (dresser.drips.length > 0) {
      const drips = new Drips(dresser.drips, 0xa8e0d0, this.time);
      this.disposables.push(drips);
      this.objects.push(drips.mesh);
    }
  }

  /**
   * Thousands of pebbles, tile shards, ash flakes and weed tufts: one InstancedMesh per kind,
   * count scaled by the quality preset, none inside the central fight radius.
   */
  private buildClutter(rockMat: Material, stoneMat: Material): void {
    const c = this.look.clutter;
    const k = this.preset.clutterDensity;
    const R = this.def.floorRadius;
    const keep: [number, number, number][] = [
      ...this.keepOut.map(([x, z, r]): [number, number, number] => [x, z, r * 0.6]),
      ...this.def.pillars.map((p): [number, number, number] => [p.x, p.z, p.radius * 1.05]),
      ...this.def.braziers.map((b): [number, number, number] => [b.x, b.z, 0.5]),
    ];
    const kinds: {
      name: string;
      count: number;
      geo: () => BufferGeometry;
      mat: () => Material;
      scale: [number, number];
      tilt: number;
      lift: number;
      shadow: boolean;
    }[] = [
      {
        name: 'pebbles',
        count: c.pebbles,
        geo: () => pebbleGeometry(3),
        mat: () => rockMat,
        scale: [0.04, 0.16],
        tilt: 1,
        lift: 0.15,
        shadow: false,
      },
      {
        name: 'shards',
        count: c.shards,
        geo: () => shardGeometry(5),
        mat: () => stoneMat,
        scale: [0.12, 0.4],
        tilt: 0.25,
        lift: 0,
        shadow: false,
      },
      {
        name: 'flakes',
        count: c.flakes,
        geo: () => flakeGeometry(),
        mat: () =>
          this.mat(
            new MeshStandardMaterial({ color: c.flakeColor, roughness: 1, vertexColors: true }),
          ),
        scale: [0.03, 0.08],
        tilt: 0.1,
        lift: 0,
        shadow: false,
      },
      {
        name: 'tufts',
        count: c.tufts,
        geo: () => tuftGeometry(7),
        mat: () =>
          this.mat(
            new MeshStandardMaterial({
              color: c.tuftColor,
              roughness: 0.95,
              vertexColors: true,
              side: DoubleSide,
            }),
          ),
        scale: [0.18, 0.5],
        tilt: 0.3,
        lift: 0,
        shadow: false,
      },
    ];
    for (const kind of kinds) {
      const count = Math.round(kind.count * k);
      if (count <= 0) continue;
      const matrices = scatter({
        count,
        clearRadius: R * CLUTTER_CLEAR_FRACTION,
        maxRadius: R - 0.3,
        keepOut: keep,
        rand: this.rand,
        scale: kind.scale,
        tilt: kind.tilt,
        lift: kind.lift,
        edgeBias: 1.5,
      });
      const mesh = new InstancedMesh(this.geo(kind.geo()), kind.mat(), matrices.length);
      matrices.forEach((mm, i) => mesh.setMatrixAt(i, mm));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.name = `clutter-${kind.name}`;
      mesh.castShadow = kind.shadow;
      mesh.receiveShadow = true;
      this.objects.push(mesh);
    }
  }

  // ------------------------------------------------------------------ helpers

  private geo<T extends BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  private mat<T extends Material>(m: T): T {
    this.materials.push(m);
    return m;
  }
}
