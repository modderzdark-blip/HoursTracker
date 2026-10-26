import {
  BoxGeometry,
  Color,
  Euler,
  Matrix4,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from 'three';
import type { BannerHang } from '../data/arenaAssets';
import type { ArenaLook } from '../data/arenaLooks';
import { insideOutline, type ArenaDef } from '../data/arenas';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import {
  floatingSpireGeometry,
  mushroomClusterGeometry,
  portcullisGeometry,
  pylonGeometry,
  towerGeometry,
  volcanoGeometry,
} from '../render/env/landmarks';
import type { PropBatch } from '../render/env/PropBatch';
import {
  angelStatueGeometry,
  archGeometry,
  bannerClothGeometry,
  bannerRodGeometry,
  barricadeGeometry,
  cageGeometry,
  candleClusterGeometry,
  chainGeometry,
  chunkGeometry,
  crystalClusterGeometry,
  deadTreeGeometry,
  femurGeometry,
  flagPoleGeometry,
  gargoyleGeometry,
  knightStatueGeometry,
  longBoneGeometry,
  mergeParts,
  prep,
  ribcageGeometry,
  rootsGeometry,
  sarcophagusGeometry,
  skullGeometry,
  strut,
  weaponRackGeometry,
  type PropParts,
  type StatueDamage,
} from '../render/env/props';
import { spireGeometry } from '../render/env/shapes';
import type { DripSpot } from '../vfx/Drips';
import type { GlowPool } from '../vfx/GlowPools';
import { lavaPoolGeometry, lavaRingGeometry } from '../vfx/LavaSurface';
import type { SmokeCard } from '../vfx/SmokeCards';

/** What the wall builder reports for dressing: segment heights, buttress caps, torch angles. */
export interface WallInfo {
  readonly heights: readonly number[];
  readonly buttresses: readonly {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly a: number;
  }[];
  readonly torchAngles: readonly number[];
}

export interface FlameSpot {
  x: number;
  y: number;
  z: number;
  size: number;
}

/** The floating landmark: parts in local space, its anchor, spun by the arena each frame. */
export interface FloatingPiece {
  readonly parts: PropParts;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const TAU = Math.PI * 2;

/**
 * Places an arena's set dressing (src/data/arenaLooks.ts counts) around the edges: statues,
 * gargoyles on the buttresses, cages on gallows, chains, barricades, weapon racks, banners and
 * flags, skull piles and remains, candles, sarcophagi, arches, trees and roots, crystals,
 * mushrooms, stalactites, lava pools, puddles — and the arena's landmark. Static parts go into
 * the PropBatch (one draw call per material); fire, light pools, smoke / fog cards, drips, lava
 * and puddles are collected for the builder's effect meshes. Solid props near the fight get
 * colliders; tall props stay out of the south band where they would hide the hero from the
 * camera; the fight centre, spawns, the boss and the dummy stay clear.
 */
export type DressingPart =
  | 'landmark'
  | 'arches'
  | 'statues'
  | 'sarcophagi'
  | 'cages'
  | 'racks'
  | 'barricades'
  | 'lavaPools'
  | 'trees'
  | 'crystals'
  | 'mushrooms'
  | 'roots'
  | 'skullPiles'
  | 'remains'
  | 'candles'
  | 'banners'
  | 'flags'
  | 'gargoyles'
  | 'chains'
  | 'stalactites'
  | 'puddles'
  | 'smoke';

const NO_SKIP: ReadonlySet<DressingPart> = new Set();

export class ArenaDresser {
  readonly flames: FlameSpot[] = [];
  readonly pools: GlowPool[] = [];
  readonly cards: SmokeCard[] = [];
  readonly drips: DripSpot[] = [];
  readonly lava: BufferGeometry[] = [];
  readonly puddles: [number, number, number][] = [];
  floating: FloatingPiece | null = null;
  /** Distant glow (volcano lava) drawn without fog so it shows through the haze. */
  farGlow: BufferGeometry | null = null;
  colliders = 0;
  private readonly occupied: [number, number, number][] = [];
  private readonly altars: { x: number; z: number }[] = [];
  private readonly temp: BufferGeometry[] = [];
  private readonly m = new Matrix4();
  private readonly e = new Euler();
  private readonly q = new Quaternion();
  private readonly p = new Vector3();
  private readonly s = new Vector3();
  private readonly R: number;
  private readonly L: ArenaLook;

  constructor(
    private readonly def: ArenaDef,
    look: ArenaLook,
    private readonly batch: PropBatch,
    private readonly physics: PhysicsWorld,
    private readonly rand: () => number,
    private readonly keepOut: readonly (readonly [number, number, number])[],
    private readonly wall: WallInfo,
  ) {
    this.R = def.floorRadius;
    this.L = look;
  }

  /**
   * Builds the dressing. `skip` names procedural props to leave out, used when scanned models
   * (ScannedProps) take their place.
   */
  dress(skip: ReadonlySet<DressingPart> = NO_SKIP): void {
    const steps: [DressingPart, () => void][] = [
      ['landmark', () => this.landmark()],
      ['arches', () => this.arches()],
      ['statues', () => this.statues()],
      ['sarcophagi', () => this.sarcophagi()],
      ['cages', () => this.cages()],
      ['racks', () => this.racks()],
      ['barricades', () => this.barricades()],
      ['lavaPools', () => this.lavaPools()],
      ['trees', () => this.trees()],
      ['crystals', () => this.crystals()],
      ['mushrooms', () => this.mushrooms()],
      ['roots', () => this.roots()],
      ['skullPiles', () => this.skullPiles()],
      ['remains', () => this.remains()],
      ['candles', () => this.candles()],
      ['banners', () => this.banners()],
      ['flags', () => this.flags()],
      ['gargoyles', () => this.gargoyles()],
      ['chains', () => this.chains()],
      ['stalactites', () => this.stalactites()],
      ['puddles', () => this.puddleSpots()],
      ['smoke', () => this.smokeAndFog()],
    ];
    for (const [name, run] of steps) if (!skip.has(name)) run();
    if (this.L.fx.lavaMoat) {
      const t = this.def.wall.thickness;
      this.lava.push(lavaRingGeometry(this.R + t + 0.5, this.R + t + 4.8, 3));
    }
    for (const g of this.temp) g.dispose();
    this.temp.length = 0;
  }

  /** Banners at given spots (scanned walls): cloth on an iron rod, waving out of step. */
  hangBanners(list: readonly BannerHang[]): void {
    for (const b of list) {
      const yaw = (b.yaw * Math.PI) / 180;
      const cloth = bannerClothGeometry(b.w, b.h);
      const rod = bannerRodGeometry(b.w);
      this.batch.add(
        'cloth',
        cloth,
        this.at(b.x, b.y, b.z, yaw),
        this.tint(this.L.tints.cloth),
        [0, 0, 0],
        this.rand() * 6,
      );
      this.batch.add('iron', rod, this.at(b.x, b.y + 0.03, b.z, yaw), this.L.tints.iron);
      cloth.dispose();
      rod.dispose();
    }
  }

  // ------------------------------------------------------------------ helpers

  private keep<T extends BufferGeometry>(g: T): T {
    this.temp.push(g);
    return g;
  }

  private keepParts(pp: PropParts): PropParts {
    for (const g of Object.values(pp.parts)) if (g !== undefined) this.temp.push(g);
    return pp;
  }

  /** Transform: position, yaw, uniform scale, then pitch / roll (YXZ order). */
  private at(
    x: number,
    y: number,
    z: number,
    yaw: number,
    scale = 1,
    pitch = 0,
    roll = 0,
  ): Matrix4 {
    this.e.set(pitch, yaw, roll, 'YXZ');
    this.q.setFromEuler(this.e);
    return this.m.compose(this.p.set(x, y, z), this.q, this.s.set(scale, scale, scale));
  }

  private tint(hex: number, jitter = 0.2): Color {
    return new Color(hex).multiplyScalar(1 - jitter / 2 + this.rand() * jitter);
  }

  private glow(k: number, hex = this.L.tints.glow): Color {
    return new Color(hex).multiplyScalar(k);
  }

  private pool(
    x: number,
    z: number,
    radius: number,
    color: number,
    intensity: number,
    flicker: number,
  ): void {
    this.pools.push({ x, z, radius, color, intensity, flicker });
  }

  /** Yaw that turns a prop's +Z toward the arena centre. */
  private faceCentre(x: number, z: number): number {
    return Math.atan2(-x, -z);
  }

  /**
   * A free spot in the ring minR..maxR for a prop of footprint radius `foot`. Tall props never go
   * in the south band (between the camera and a hero standing near the south wall).
   */
  private spot(minR: number, maxR: number, foot: number, tall: boolean): [number, number] | null {
    const d = this.def;
    for (let tries = 0; tries < 24; tries++) {
      const a = this.rand() * TAU;
      const r = minR + this.rand() * (maxR - minR);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (tall && z > this.R * 0.3) continue;
      if (r + foot > this.R - 0.2) continue;
      const near = (px: number, pz: number, pr: number): boolean =>
        (x - px) ** 2 + (z - pz) ** 2 < (pr + foot) ** 2;
      if (this.keepOut.some(([kx, kz, kr]) => near(kx, kz, kr))) continue;
      if (d.pillars.some((pl) => near(pl.x, pl.z, pl.radius * 1.35))) continue;
      if (d.braziers.some((b) => near(b.x, b.z, 0.9))) continue;
      if (d.rocks.some((rk) => near(rk.x, rk.z, rk.scale * 1.15))) continue;
      if (
        d.blocks.some((b) =>
          near(b.position[0], b.position[2], Math.max(b.size[0], b.size[2]) * 0.6),
        )
      )
        continue;
      if (this.occupied.some(([ox, oz, or]) => near(ox, oz, or))) continue;
      this.occupied.push([x, z, foot]);
      return [x, z];
    }
    return null;
  }

  private cylinder(x: number, z: number, h: number, r: number): void {
    this.physics.addStaticCylinder(x, h / 2, z, h / 2, r);
    this.colliders++;
  }

  private box(x: number, z: number, hx: number, hy: number, hz: number, yaw: number): void {
    this.e.set(0, yaw, 0);
    this.q.setFromEuler(this.e);
    this.physics.addStaticCuboid(x, hy, z, hx, hy, hz, this.q);
    this.colliders++;
  }

  /** World position of a point given in a prop's local frame (yaw about its origin). */
  private local(x: number, z: number, yaw: number, lx: number, lz: number): [number, number] {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    return [x + lx * c + lz * s, z - lx * s + lz * c];
  }

  // ------------------------------------------------------------------ landmarks

  private landmark(): void {
    const R = this.R;
    const t = this.def.wall.thickness;
    const tint = this.L.tints;
    switch (this.L.landmark) {
      case 'chained_colossus': {
        // A giant knight standing in the lava moat, chained between two burning pylons.
        const z0 = -(R + t + 3.2);
        const k = 4.2;
        this.batch.add(
          'stone',
          this.keep(knightStatueGeometry(91, 'none')),
          this.at(0, -0.4, z0, 0, k),
        );
        const visor = this.keep(prep(new BoxGeometry(0.22, 0.03, 0.03)));
        visor.translate(0, 2.22, 0.125);
        this.batch.add('glow', visor, this.at(0, -0.4, z0, 0, k), this.glow(6));
        const pylon = this.keepParts(pylonGeometry(5, 9));
        for (const sx of [-1, 1]) {
          const px = sx * 10.5;
          const pz = z0 + 1.5;
          this.batch.addParts(
            pylon,
            this.at(px, 0, pz, 0),
            { iron: tint.iron, glow: this.glow(4) },
            this.flames,
          );
          const from = new Vector3(sx * 0.3 * k, 1.95 * k - 0.4, z0);
          const to = new Vector3(px - sx * 0.8, 9.1, pz);
          const mid = from
            .clone()
            .lerp(to, 0.5)
            .add(new Vector3(0, -1.8, 0.5));
          this.batch.add(
            'iron',
            this.keep(chainGeometry([from, mid, to], 0.6)),
            this.at(0, 0, 0, 0),
            tint.iron,
          );
          const low = new Vector3(sx * 0.28 * k, 1.25 * k - 0.4, z0 + 0.4);
          const ground = new Vector3(sx * 4.2, 0.1, z0 + 2.6);
          const sag = low
            .clone()
            .lerp(ground, 0.5)
            .add(new Vector3(0, -0.9, 0));
          this.batch.add(
            'iron',
            this.keep(chainGeometry([low, sag, ground], 0.45)),
            this.at(0, 0, 0, 0),
            tint.iron,
          );
        }
        this.pool(0, z0 + 1, 8, tint.glow, 0.7, 0.3);
        this.cards.push({ x: 0, y: 0, z: z0 - 3, w: 9, h: 26, kind: 0, alpha: 0.5 });
        break;
      }
      case 'burning_gate': {
        // A gatehouse beyond the north wall: two towers, an arch with a half-raised portcullis
        // and a fire raging in the passage behind it.
        const z0 = -(R + t + 2.6);
        const tower = this.keep(towerGeometry(13, 4, 12));
        for (const sx of [-1, 1]) {
          this.batch.add('stone', tower, this.at(sx * 5.4, 0, z0, 0));
          const cloth = this.keep(bannerClothGeometry(1.6, 5.2));
          this.batch.add(
            'cloth',
            cloth,
            this.at(sx * 5.4, 11.2, z0 + 2.08, 0),
            this.tint(tint.cloth),
            [0, 0, 0],
            this.rand() * 6,
          );
          this.batch.add(
            'iron',
            this.keep(bannerRodGeometry(1.6)),
            this.at(sx * 5.4, 11.25, z0 + 2.1, 0),
            tint.iron,
          );
          this.flames.push({ x: sx * 3.3, y: 4.2, z: z0 + 1.2, size: 0.8 });
        }
        this.batch.add('stone', this.keep(archGeometry(17, false)), this.at(0, 0, z0, 0, 1.75));
        this.batch.add(
          'iron',
          this.keep(portcullisGeometry(4.6, 4.4)),
          this.at(0, 1.9, z0 + 0.2, 0),
          tint.iron,
        );
        const bed = this.keep(prep(new BoxGeometry(4.4, 0.25, 2.2)));
        this.batch.add('glow', bed, this.at(0, 0.1, z0 - 1.2, 0), this.glow(3));
        for (let i = 0; i < 6; i++) {
          this.flames.push({
            x: -1.8 + i * 0.72,
            y: 0.15,
            z: z0 - 0.9 - (i % 2) * 0.6,
            size: 2.2 + (i % 3) * 0.5,
          });
        }
        this.pool(0, z0 + 1.5, 7, tint.glow, 1.1, 0.8);
        this.pool(0, -(R - 1.5), 5, tint.glow, 0.45, 0.8);
        this.cards.push({ x: 0, y: 1, z: z0 - 2.5, w: 8, h: 24, kind: 0, alpha: 0.6 });
        break;
      }
      case 'volcano': {
        // A volcano of dark basalt on the northern horizon with glowing lava streams.
        const v = volcanoGeometry(23, 38, 34);
        this.keepParts(v);
        if (v.parts.rock !== undefined)
          this.batch.add('rock', v.parts.rock, this.at(16, -2, -70, 0.4), 0x5a4640);
        if (v.parts.glow !== undefined) {
          const g = v.parts.glow.clone();
          g.applyMatrix4(this.at(16, -2, -70, 0.4));
          const c = g.getAttribute('color');
          const hot = this.glow(5);
          for (let i = 0; i < c.count; i++) c.setXYZ(i, hot.r, hot.g, hot.b);
          this.farGlow = g;
        }
        this.cards.push({ x: 16, y: 20, z: -66, w: 16, h: 30, kind: 0, alpha: 0.5 });
        break;
      }
      case 'floating_spire': {
        // An inverted obelisk hanging over the north wall, turning slowly with rubble orbiting
        // it, chained to the wall tops by its point.
        const spire = floatingSpireGeometry(41, 11, 1.7);
        const stone = spire.parts.stone;
        if (stone === undefined) break;
        const bits: BufferGeometry[] = [stone];
        for (let i = 0; i < 9; i++) {
          const g = chunkGeometry(i * 3 + 1);
          const a = (i / 9) * TAU;
          const rr = 3 + this.rand() * 1.6;
          g.scale(0.5 + this.rand() * 0.7, 0.5 + this.rand() * 0.5, 0.5 + this.rand() * 0.7);
          g.rotateY(this.rand() * TAU);
          g.translate(Math.cos(a) * rr, 2 + this.rand() * 7, Math.sin(a) * rr);
          bits.push(g);
        }
        const parts: PropParts = { parts: { stone: mergeParts(bits), glow: spire.parts.glow } };
        const z = -(R + 2.4);
        this.floating = { parts, x: 0, y: 9.5, z };
        const tip = new Vector3(0, 9.5, z);
        for (const da of [-0.38, 0.38]) {
          const a = -Math.PI / 2 + da;
          const end = new Vector3(
            Math.cos(a) * (R + 0.7),
            this.def.wall.height * 0.85,
            Math.sin(a) * (R + 0.7),
          );
          const mid = tip
            .clone()
            .lerp(end, 0.5)
            .add(new Vector3(0, -1.2, 0));
          this.batch.add(
            'iron',
            this.keep(chainGeometry([tip, mid, end], 0.32)),
            this.at(0, 0, 0, 0),
            tint.iron,
          );
        }
        const down = new Vector3(0.4, 0, z - 4);
        this.batch.add(
          'iron',
          this.keep(
            chainGeometry(
              [
                tip,
                tip
                  .clone()
                  .lerp(down, 0.5)
                  .add(new Vector3(0, -0.5, 0)),
                down,
              ],
              0.32,
            ),
          ),
          this.at(0, 0, 0, 0),
          tint.iron,
        );
        this.pool(0, -(R - 2), 6, tint.glow, 0.55, 0.3);
        break;
      }
      case 'great_crystal': {
        // A giant crystal cluster breaking out of the north cave wall, leaning into the cavern.
        const big = this.keep(crystalClusterGeometry(53, 9, 9));
        this.batch.add('crystal', big, this.at(0, -0.6, -(R + 0.8), 0, 1, 0.32));
        this.batch.add(
          'crystal',
          this.keep(crystalClusterGeometry(61, 6, 5)),
          this.at(-5, -0.3, -(R - 0.2), 0.5, 1, 0.4),
        );
        this.batch.add(
          'crystal',
          this.keep(crystalClusterGeometry(67, 5, 4)),
          this.at(5.2, -0.3, -(R - 0.1), -0.4, 1, 0.45),
        );
        this.physics.addStaticBall(0, 1, -(R - 1.1), 1.6);
        this.physics.addStaticBall(-4.6, 0.6, -(R - 0.9), 1.1);
        this.physics.addStaticBall(4.8, 0.6, -(R - 0.9), 1);
        this.colliders += 3;
        this.occupied.push([0, -(R - 1.1), 2.2], [-4.6, -(R - 0.9), 1.6], [4.8, -(R - 0.9), 1.5]);
        this.pool(0, -(R - 2.5), 8, tint.crystal, 1, 0.12);
        this.pool(-5, -(R - 1.5), 4, tint.crystal, 0.7, 0.12);
        this.pool(5, -(R - 1.5), 4, tint.crystal, 0.7, 0.12);
        break;
      }
    }
  }

  // ------------------------------------------------------------------ edge props

  private statues(): void {
    const n = this.L.dressing.statues;
    const kind = this.L.dressing.statueKind;
    const damages: StatueDamage[] = ['none', 'head', 'arm', 'top'];
    const knights = damages.map((d, i) => this.keep(knightStatueGeometry(11 + i * 7, d)));
    const angels = [false, true].map((b, i) => this.keep(angelStatueGeometry(23 + i * 5, b)));
    for (let i = 0; i < n; i++) {
      const sp = this.spot(this.R - 3.4, this.R - 1.5, 0.85, true);
      if (sp === null) continue;
      const [x, z] = sp;
      const angel = kind === 'angel' || (kind === 'mixed' && i % 2 === 1);
      const geo = angel ? angels[i % 2] : knights[i % knights.length];
      if (geo === undefined) continue;
      this.batch.add(
        'stone',
        geo,
        this.at(x, 0, z, this.faceCentre(x, z) + (this.rand() - 0.5) * 0.4),
      );
      this.cylinder(x, z, 2.6, 0.6);
      this.altars.push({ x, z });
    }
  }

  private sarcophagi(): void {
    const geo = this.keep(sarcophagusGeometry(5));
    for (let i = 0; i < this.L.dressing.sarcophagi; i++) {
      const sp = this.spot(this.R - 4.4, this.R - 2.4, 1.4, false);
      if (sp === null) continue;
      const [x, z] = sp;
      const yaw = this.faceCentre(x, z) + Math.PI / 2 + (this.rand() - 0.5) * 0.3;
      this.batch.add('stone', geo, this.at(x, 0, z, yaw));
      this.box(x, z, 0.52, 0.5, 1.08, yaw);
      this.altars.push(
        { x: this.local(x, z, yaw, 0, 1.45)[0], z: this.local(x, z, yaw, 0, 1.45)[1] },
        { x: this.local(x, z, yaw, 0, -1.45)[0], z: this.local(x, z, yaw, 0, -1.45)[1] },
      );
    }
  }

  private arches(): void {
    for (let i = 0; i < this.L.dressing.arches; i++) {
      const sp = this.spot(this.R - 1.7, this.R - 1.3, 2.6, true);
      if (sp === null) continue;
      const [x, z] = sp;
      const yaw = this.faceCentre(x, z);
      const broken = i % 2 === 0;
      this.batch.add('stone', this.keep(archGeometry(41 + i, broken)), this.at(x, 0, z, yaw));
      for (const lx of [-1.7, 1.7]) {
        const [px, pz] = this.local(x, z, yaw, lx, 0);
        this.cylinder(px, pz, broken && lx > 0 ? 1.3 : 2.6, 0.5);
      }
      if (broken) {
        const [bx, bz] = this.local(x, z, yaw, 2.4, 0);
        this.box(bx, bz, 0.9, 0.3, 0.9, yaw);
      }
    }
  }

  private cages(): void {
    const cage = this.keep(cageGeometry());
    const iron = this.L.tints.iron;
    for (let i = 0; i < this.L.dressing.cages; i++) {
      const sp = this.spot(this.R - 2.3, this.R - 1.6, 1.1, true);
      if (sp === null) continue;
      const [x, z] = sp;
      // Gallows: a post at the wall, an arm reaching inward, a brace; the cage hangs from the arm.
      const out = Math.hypot(x, z);
      const ux = x / out;
      const uz = z / out;
      const post = new Vector3(x + ux * 1.1, 0, z + uz * 1.1);
      const top = post.clone().setY(4.3);
      const arm = new Vector3(x - ux * 0.25, 4.2, z - uz * 0.25);
      const wood = this.tint(this.L.tints.wood);
      this.batch.add('wood', this.keep(strut(post, top, 0.14, 0.12, 6)), this.at(0, 0, 0, 0), wood);
      this.batch.add(
        'wood',
        this.keep(strut(top.clone().setY(4.15), arm, 0.1, 0.09, 6)),
        this.at(0, 0, 0, 0),
        wood,
      );
      this.batch.add(
        'wood',
        this.keep(
          strut(post.clone().setY(3.0), top.clone().lerp(arm, 0.55).setY(4.1), 0.06, 0.06, 5),
        ),
        this.at(0, 0, 0, 0),
        wood,
      );
      const pivot = 4.15;
      const phase = this.rand() * TAU;
      const sway: [number, number, number] = [pivot, 0.022, phase];
      const cx = arm.x;
      const cz = arm.z;
      this.batch.add('iron', cage, this.at(cx, 0.8, cz, this.rand() * TAU), iron, sway);
      const chain = chainGeometry(
        [new Vector3(cx, 2.85, cz), new Vector3(cx, 3.5, cz), new Vector3(cx, pivot, cz)],
        0.12,
      );
      this.batch.add('iron', this.keep(chain), this.at(0, 0, 0, 0), iron, sway);
      this.cylinder(post.x, post.z, 4.3, 0.2);
      this.cylinder(cx, cz, 2.9, 0.5);
      this.boneHeap(cx + 0.5 * uz, cz - 0.5 * ux, 2);
    }
  }

  private racks(): void {
    for (let i = 0; i < this.L.dressing.racks; i++) {
      const sp = this.spot(this.R - 1.2, this.R - 0.95, 0.9, false);
      if (sp === null) continue;
      const [x, z] = sp;
      const yaw = this.faceCentre(x, z);
      const rack = this.keepParts(weaponRackGeometry(71 + i * 13));
      this.batch.addParts(rack, this.at(x, 0, z, yaw), {
        wood: this.tint(this.L.tints.wood),
        iron: this.L.tints.iron,
      });
      this.box(x, z, 0.85, 0.75, 0.38, yaw);
    }
  }

  private barricades(): void {
    for (let i = 0; i < this.L.dressing.barricades; i++) {
      const sp = this.spot(this.R - 5, this.R - 2.6, 1.4, false);
      if (sp === null) continue;
      const [x, z] = sp;
      const yaw = this.faceCentre(x, z) + Math.PI / 2 + (this.rand() - 0.5) * 0.5;
      const b = this.keepParts(barricadeGeometry(81 + i * 5));
      this.batch.addParts(b, this.at(x, 0, z, yaw), {
        wood: this.tint(this.L.tints.wood),
        iron: this.L.tints.iron,
      });
      this.box(x, z, 1.25, 0.6, 0.6, yaw);
    }
  }

  private lavaPools(): void {
    const chunks = [1, 2, 3].map((s) => this.keep(chunkGeometry(s * 7)));
    for (let i = 0; i < this.L.dressing.lavaPools; i++) {
      const r = 1.1 + this.rand() * 0.8;
      const sp = this.spot(this.R - 4.8, this.R - 2.2, r + 0.7, false);
      if (sp === null) continue;
      const [x, z] = sp;
      this.lava.push(lavaPoolGeometry(x, z, r, i * 3.7 + 1));
      const n = Math.round(r * 7);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU + this.rand() * 0.3;
        const rr = r * (1.05 + this.rand() * 0.15);
        const sc = 0.35 + this.rand() * 0.35;
        const g = chunks[k % chunks.length];
        if (g !== undefined) {
          this.batch.add(
            'rock',
            g,
            this.at(x + Math.cos(a) * rr, sc * 0.1, z + Math.sin(a) * rr, this.rand() * TAU, sc),
          );
        }
      }
      this.cylinder(x, z, 0.7, r * 1.05);
      this.pool(x, z, r + 2.4, this.L.tints.glow, 1, 0.35);
      this.flames.push({ x: x + r * 0.3, y: 0.05, z: z - r * 0.2, size: 0.45 });
      this.cards.push({ x, y: 0, z, w: 2, h: 6, kind: 0, alpha: 0.3 });
    }
  }

  private trees(): void {
    const n = this.L.dressing.trees;
    const t = this.def.wall.thickness;
    const variants = [0, 1, 2].map((i) => this.keep(deadTreeGeometry(101 + i * 17)));
    for (let i = 0; i < n; i++) {
      const g = variants[i % variants.length];
      if (g === undefined) continue;
      const wood = this.tint(this.L.tints.wood);
      if (i % 2 === 0) {
        const sp = this.spot(this.R - 3.2, this.R - 1.4, 0.8, true);
        if (sp === null) continue;
        this.batch.add(
          'wood',
          g,
          this.at(sp[0], 0, sp[1], this.rand() * TAU, 0.9 + this.rand() * 0.3),
          wood,
        );
        this.cylinder(sp[0], sp[1], 3, 0.35);
      } else {
        // Beyond the wall: silhouettes above it, mostly north.
        const a = Math.PI * (1.1 + this.rand() * 0.8);
        let r = this.R + t + 1.5 + this.rand() * 3;
        // Shaped arenas reach past the radius: step out until the tree stands outside.
        for (let k = 0; k < 12 && insideOutline(this.def, Math.cos(a) * r, Math.sin(a) * r); k++)
          r += 1.5;
        r += t;
        this.batch.add(
          'wood',
          g,
          this.at(Math.cos(a) * r, 0, Math.sin(a) * r, this.rand() * TAU, 1.2 + this.rand() * 0.4),
          wood,
        );
      }
    }
  }

  private roots(): void {
    for (let i = 0; i < this.L.dressing.roots; i++) {
      const sp = this.spot(this.R - 3, this.R - 0.7, 0.9, false);
      if (sp === null) continue;
      this.batch.add(
        'wood',
        this.keep(rootsGeometry(131 + i * 7)),
        this.at(sp[0], 0, sp[1], this.rand() * TAU),
        this.tint(this.L.tints.wood),
      );
    }
  }

  private crystals(): void {
    for (let i = 0; i < this.L.dressing.crystals; i++) {
      const size = 0.8 + this.rand() * 1.6;
      const sp = this.spot(this.R - 4, this.R - 0.8, size * 0.5, size > 1.8);
      if (sp === null) continue;
      const [x, z] = sp;
      const g = this.keep(
        crystalClusterGeometry(151 + i * 11, 3 + Math.floor(this.rand() * 4), size),
      );
      this.batch.add(
        'crystal',
        g,
        this.at(x, -0.1, z, this.rand() * TAU, 1, (this.rand() - 0.5) * 0.3),
      );
      if (size > 1.2) {
        this.physics.addStaticBall(x, size * 0.3, z, size * 0.32);
        this.colliders++;
      }
      this.pool(x, z, size * 2.2, this.L.tints.crystal, 0.65, 0.1);
    }
  }

  private mushrooms(): void {
    for (let i = 0; i < this.L.dressing.mushrooms; i++) {
      const sp = this.spot(this.R - 5.5, this.R - 0.8, 0.45, false);
      if (sp === null) continue;
      const [x, z] = sp;
      const m = this.keepParts(
        mushroomClusterGeometry(171 + i * 3, 3 + Math.floor(this.rand() * 4)),
      );
      this.batch.addParts(m, this.at(x, 0, z, this.rand() * TAU, 0.8 + this.rand() * 0.6), {
        bone: 0xb4bca4,
        glow: this.glow(2.4),
      });
      this.pool(x, z, 1.6, this.L.tints.glow, 0.5, 0.15);
    }
  }

  /** A heap of skulls and long bones at (x, z); `size` 1 small … 3 large. */
  private boneHeap(x: number, z: number, size: number): void {
    const skull = this.skullLow ?? this.keep(skullGeometry(2));
    this.skullLow = skull;
    const femur = this.femur ?? this.keep(femurGeometry());
    this.femur = femur;
    const bone = this.L.tints.bone;
    const rings = size >= 3 ? [6, 3, 1] : size === 2 ? [4, 1] : [2];
    rings.forEach((count, layer) => {
      for (let k = 0; k < count; k++) {
        const a = (k / count) * TAU + layer * 0.7 + this.rand() * 0.4;
        const rr = count === 1 ? 0 : 0.24 - layer * 0.08;
        this.batch.add(
          'bone',
          skull,
          this.at(
            x + Math.cos(a) * rr,
            0.09 + layer * 0.15,
            z + Math.sin(a) * rr,
            a + Math.PI / 2 + (this.rand() - 0.5),
            1,
            (this.rand() - 0.5) * 0.5,
            (this.rand() - 0.5) * 0.4,
          ),
          this.tint(bone, 0.3),
        );
      }
    });
    for (let k = 0; k < size + 2; k++) {
      const a = this.rand() * TAU;
      const rr = 0.3 + this.rand() * 0.25;
      this.batch.add(
        'bone',
        femur,
        this.at(
          x + Math.cos(a) * rr,
          0.03,
          z + Math.sin(a) * rr,
          this.rand() * TAU,
          1,
          0,
          (this.rand() - 0.5) * 0.2,
        ),
        this.tint(bone, 0.3),
      );
    }
  }

  private skullLow: BufferGeometry | undefined;
  private femur: BufferGeometry | undefined;

  private skullPiles(): void {
    for (let i = 0; i < this.L.dressing.skullPiles; i++) {
      const sp = this.spot(this.R - 3.2, this.R - 0.9, 0.7, false);
      if (sp === null) continue;
      this.boneHeap(sp[0], sp[1], 1 + (i % 3));
      this.cylinder(sp[0], sp[1], 0.45, 0.45);
    }
  }

  /** Skeletons lying where they fell: rib cage on its side, skull, scattered limb bones. */
  private remains(): void {
    const ribs = this.keep(ribcageGeometry());
    const skull = this.keep(skullGeometry(2));
    const femur = this.femur ?? this.keep(femurGeometry());
    this.femur = femur;
    const limb = this.keep(longBoneGeometry());
    const bone = this.L.tints.bone;
    for (let i = 0; i < this.L.dressing.bones; i++) {
      const sp = this.spot(this.R * 0.55, this.R - 1, 0.8, false);
      if (sp === null) continue;
      const [x, z] = sp;
      const yaw = this.rand() * TAU;
      const tint = this.tint(bone, 0.25);
      this.batch.add('bone', ribs, this.at(x, 0.13, z, yaw, 1, 0, Math.PI / 2 - 0.15), tint);
      const [hx, hz] = this.local(x, z, yaw, -0.05, 0.55);
      this.batch.add(
        'bone',
        skull,
        this.at(hx, 0.08, hz, yaw + (this.rand() - 0.5) * 1.5, 1, 0, (this.rand() - 0.5) * 0.6),
        tint,
      );
      for (let k = 0; k < 4; k++) {
        const [bx, bz] = this.local(x, z, yaw, (this.rand() - 0.5) * 0.9, -0.3 - this.rand() * 0.6);
        this.batch.add(
          'bone',
          k < 2 ? femur : limb,
          this.at(bx, 0.03, bz, this.rand() * TAU),
          tint,
        );
      }
    }
  }

  private candles(): void {
    const n = this.L.dressing.candles;
    if (n <= 0) return;
    const variants = [0, 1, 2].map((i) =>
      this.keepParts(candleClusterGeometry(191 + i * 7, 3 + i)),
    );
    const spots: [number, number][] = [];
    for (const a of this.altars) spots.push([a.x, a.z]);
    // Ritual candles ring the sigil in the spire.
    if (this.L.landmark === 'floating_spire') {
      const rr = this.L.fx.sigil.radius + 0.8;
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * TAU;
        const x = Math.cos(a) * rr;
        const z = Math.sin(a) * rr;
        if (this.keepOut.some(([kx, kz, kr]) => (x - kx) ** 2 + (z - kz) ** 2 < kr * kr)) continue;
        if (this.def.braziers.some((b) => (x - b.x) ** 2 + (z - b.z) ** 2 < 1.5)) continue;
        spots.push([x, z]);
      }
    }
    while (spots.length < n) {
      const sp = this.spot(this.R - 1.5, this.R - 0.6, 0.35, false);
      if (sp === null) break;
      spots.push(sp);
    }
    spots.slice(0, n).forEach(([x, z], i) => {
      const v = variants[i % variants.length];
      if (v === undefined) return;
      const ox = (this.rand() - 0.5) * 0.6;
      const oz = (this.rand() - 0.5) * 0.6;
      this.batch.addParts(
        v,
        this.at(x + ox, 0, z + oz, this.rand() * TAU),
        { bone: 0xe6d8b8, glow: this.glow(5, 0xffb060) },
        this.flames,
      );
      this.pool(x + ox, z + oz, 1.5, 0xffa040, 0.55, 0.6);
    });
  }

  private banners(): void {
    const n = this.L.dressing.banners;
    if (n <= 0 || this.L.wallKind !== 'masonry') return;
    const segs = this.wall.heights.length;
    const big = this.keep(bannerClothGeometry(1.1, 2.6));
    const small = this.keep(bannerClothGeometry(0.9, 1.8));
    const rodBig = this.keep(bannerRodGeometry(1.1));
    const rodSmall = this.keep(bannerRodGeometry(0.9));
    // Spread over the north and the sides (the camera faces north; the south wall is behind it).
    const candidates: number[] = [];
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * TAU;
      const sa = Math.sin(a);
      if (sa > 0.45) continue;
      if (
        this.wall.torchAngles.some(
          (ta) => Math.abs(Math.atan2(Math.sin(ta - a), Math.cos(ta - a))) < 0.12,
        )
      )
        continue;
      if (
        this.L.landmark === 'burning_gate' &&
        Math.abs(Math.atan2(Math.sin(a + Math.PI / 2), Math.cos(a + Math.PI / 2))) < 0.3
      )
        continue;
      candidates.push(i);
    }
    const step = Math.max(1, candidates.length / n);
    for (let k = 0; k < n && Math.floor(k * step) < candidates.length; k++) {
      const i = candidates[Math.floor(k * step)] ?? 0;
      const a = (i / segs) * TAU;
      const h = this.wall.heights[i] ?? this.def.wall.height;
      const top = Math.min(h * 0.8, h - 0.35);
      const useBig = top > 3.1;
      if (top < 2.0) continue;
      const r = this.R - 0.08;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const yaw = this.faceCentre(x, z);
      this.batch.add(
        'cloth',
        useBig ? big : small,
        this.at(x, top, z, yaw),
        this.tint(this.L.tints.cloth),
        [0, 0, 0],
        this.rand() * 6,
      );
      this.batch.add(
        'iron',
        useBig ? rodBig : rodSmall,
        this.at(x, top + 0.03, z, yaw),
        this.L.tints.iron,
      );
    }
  }

  private flags(): void {
    const cloth = this.keep(bannerClothGeometry(1.7, 1.0, true));
    const pole = this.keepParts(flagPoleGeometry(5.6, 7));
    for (let i = 0; i < this.L.dressing.flags; i++) {
      const sp = this.spot(this.R - 2.2, this.R - 0.9, 0.5, true);
      if (sp === null) continue;
      const [x, z] = sp;
      this.batch.addParts(pole, this.at(x, 0, z, this.rand() * TAU), {
        wood: this.tint(this.L.tints.wood),
        iron: this.L.tints.iron,
      });
      // All flags stream the same way: the wind blows east.
      this.batch.add(
        'cloth',
        cloth,
        this.at(x, 5.0, z, (this.rand() - 0.5) * 0.3),
        this.tint(this.L.tints.cloth),
        [0, 0, 0],
        this.rand() * 6,
      );
      this.cylinder(x, z, 5.6, 0.12);
    }
  }

  private gargoyles(): void {
    const n = this.L.dressing.gargoyles;
    if (n <= 0) return;
    const garg = this.keepParts(gargoyleGeometry(211));
    const seats: { x: number; y: number; z: number }[] = [];
    // On the tall pillars (spire), else on the buttress caps of the north half.
    for (const pl of this.def.pillars)
      if (pl.height >= 6) seats.push({ x: pl.x, y: pl.height + 0.02, z: pl.z });
    const caps = this.wall.buttresses.filter((b) => b.z < this.R * 0.4);
    const step = Math.max(1, caps.length / Math.max(1, n - seats.length));
    for (let k = 0; k * step < caps.length; k++) {
      const b = caps[Math.floor(k * step)];
      if (b !== undefined) seats.push({ x: b.x, y: b.y + 0.18, z: b.z });
    }
    seats.slice(0, n).forEach((s) => {
      this.batch.addParts(garg, this.at(s.x, s.y, s.z, this.faceCentre(s.x, s.z), 1.15), {
        glow: this.glow(5),
      });
    });
  }

  private chains(): void {
    const n = this.L.dressing.chains;
    if (n <= 0) return;
    const iron = this.L.tints.iron;
    const tall = this.def.pillars.filter((pl) => pl.height >= 6);
    if (this.L.landmark === 'floating_spire' && tall.length >= 4) {
      // Catenaries between neighbouring pillar tops, high over the fight.
      const ring = [...tall].sort((a, b) => Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x));
      for (let i = 0; i < Math.min(n, ring.length); i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        if (a === undefined || b === undefined) continue;
        const pa = new Vector3(a.x * 0.94, a.height - 0.5, a.z * 0.94);
        const pb = new Vector3(b.x * 0.94, b.height - 0.5, b.z * 0.94);
        const mid = pa
          .clone()
          .lerp(pb, 0.5)
          .add(new Vector3(0, -2.2, 0));
        this.batch.add(
          'iron',
          this.keep(chainGeometry([pa, mid, pb], 0.16)),
          this.at(0, 0, 0, 0),
          iron,
        );
      }
      return;
    }
    const caps = this.wall.buttresses.filter((b) => b.z < this.R * 0.35);
    for (let i = 0; i + 1 < caps.length && i / 2 < n; i += 2) {
      const a = caps[i];
      const b = caps[i + 1];
      // Only neighbouring caps (the filtered list jumps across the south gap).
      if (a === undefined || b === undefined || Math.hypot(a.x - b.x, a.z - b.z) > 8) continue;
      const k = (this.R - 0.35) / Math.hypot(a.x, a.z);
      const pa = new Vector3(a.x * k, a.y - 0.05, a.z * k);
      const kb = (this.R - 0.35) / Math.hypot(b.x, b.z);
      const pb = new Vector3(b.x * kb, b.y - 0.05, b.z * kb);
      const mid = pa
        .clone()
        .lerp(pb, 0.5)
        .multiplyScalar(0.985)
        .add(new Vector3(0, -1.0, 0));
      this.batch.add(
        'iron',
        this.keep(chainGeometry([pa, mid, pb], 0.13)),
        this.at(0, 0, 0, 0),
        iron,
      );
    }
  }

  private stalactites(): void {
    const n = this.L.dressing.stalactites;
    if (n <= 0) return;
    const variants = [7, 9].map((s) => {
      const g = this.keep(spireGeometry(s));
      g.rotateX(Math.PI);
      return g;
    });
    let drips = 0;
    for (let i = 0; i < n; i++) {
      const a = this.rand() * TAU;
      const r = this.R - 0.5 - this.rand() * 2.6;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const top = 11 + this.rand() * 4;
      const len = 2 + this.rand() * 4.5;
      const rad = len * (0.16 + this.rand() * 0.06);
      const g = variants[i % 2];
      if (g === undefined) continue;
      this.e.set(0, this.rand() * TAU, 0);
      this.q.setFromEuler(this.e);
      this.m.compose(this.p.set(x, top, z), this.q, this.s.set(rad, len, rad));
      this.batch.add('rock', g, this.m);
      if (drips < this.L.fx.drips && i % 2 === 0) {
        this.drips.push({ x, z, top: top - len });
        drips++;
      }
    }
  }

  private puddleSpots(): void {
    for (let i = 0; i < this.L.dressing.puddles; i++) {
      const r = 0.8 + this.rand() * 1.3;
      const sp = this.spot(5, this.R - 2, r, false);
      if (sp === null) continue;
      this.puddles.push([sp[0], sp[1], r]);
      if (this.drips.length < this.L.fx.drips) this.drips.push({ x: sp[0], z: sp[1], top: 12 });
    }
  }

  private smokeAndFog(): void {
    const t = this.def.wall.thickness;
    for (let i = 0; i < this.L.fx.smokeColumns; i++) {
      const a =
        Math.PI * (1.08 + (i / Math.max(1, this.L.fx.smokeColumns - 1)) * 0.84) +
        (this.rand() - 0.5) * 0.15;
      const r = this.R + t + 6 + this.rand() * 9;
      this.cards.push({
        x: Math.cos(a) * r,
        y: -1,
        z: Math.sin(a) * r,
        w: 5 + this.rand() * 4,
        h: 16 + this.rand() * 10,
        kind: 0,
        alpha: 0.45 + this.rand() * 0.2,
      });
    }
    for (let i = 0; i < this.L.fx.fogBanks; i++) {
      const a = (i / this.L.fx.fogBanks) * TAU + this.rand() * 0.4;
      const r = this.R - 1.4 - this.rand() * 2.2;
      this.cards.push({
        x: Math.cos(a) * r,
        y: -0.3,
        z: Math.sin(a) * r,
        w: 7 + this.rand() * 4,
        h: 2 + this.rand() * 1.2,
        kind: 1,
        alpha: 0.3 + this.rand() * 0.15,
      });
    }
  }
}
