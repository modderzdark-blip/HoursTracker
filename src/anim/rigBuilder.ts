import type { BufferGeometry } from 'three';
import {
  CatmullRomCurve3,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Matrix4,
  Quaternion,
  Shape,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { CHARACTER_CONFIG } from '../data/config';
import type { ClothDef, RigDef, RigOutfit } from '../data/rigs';
import {
  SkinBuilder,
  clothPanel,
  ellipsoid,
  limb,
  loft,
  place,
  smooth01,
  sweep,
  flipFaces,
  arcLoft,
  type ArcRing,
  type Influences,
  type Ring,
  type Surf,
  type WeightFn,
} from './meshKit';
import { BONE_SPECS, FX_BONE, bindPosition, type BoneName } from './skeletonDef';

export type SocketName = 'rightBase' | 'rightTip' | 'leftBase' | 'leftTip';

export type ChainKind = 'cape' | 'tabardFront' | 'tabardBack' | 'scarf' | 'tail' | 'wing';

/** A chain of extra bones driven by springs at runtime (cloth, tails, wings). */
export interface ChainSpec {
  readonly kind: ChainKind;
  /** Bone names, root first. */
  readonly bones: readonly string[];
  readonly parent: BoneName;
  /** Side for mirrored chains (+1 left, −1 right, 0 centre). */
  readonly side: number;
}

export interface ExtraBone {
  readonly name: string;
  readonly parent: string;
  readonly pos: readonly [number, number, number];
}

export interface RigTemplate {
  readonly geometry: BufferGeometry;
  readonly glowGeometry: BufferGeometry;
  readonly sockets: Readonly<Record<SocketName, { bone: BoneName; offset: Vector3 }>>;
  /** Bones after BONE_SPECS + FX bone, in skeleton order. */
  readonly extraBones: readonly ExtraBone[];
  readonly chains: readonly ChainSpec[];
  readonly boneCount: number;
}

const DEFAULT_OUTFIT: RigOutfit = { head: 'bare', armor: 'leather' };

/** Builds the merged skinned geometry, glow geometry, sockets and cloth chains of a rig. */
export function buildRigTemplate(def: RigDef): RigTemplate {
  return new Builder(def).build();
}

class Builder {
  private readonly p: RigDef['proportions'];
  private readonly L: RigDef['look'];
  private readonly O: RigOutfit;
  private readonly body = new SkinBuilder(true, CHARACTER_CONFIG.albedoLift);
  private readonly glow = new SkinBuilder(false);
  private readonly names: string[] = [...BONE_SPECS.map((b) => b.name), FX_BONE];
  private readonly extra: ExtraBone[] = [];
  private readonly chains: ChainSpec[] = [];
  private readonly J: Record<BoneName, Vector3>;
  private readonly accent: number;
  private readonly sockets: Record<SocketName, { bone: BoneName; offset: Vector3 }>;

  constructor(private readonly def: RigDef) {
    this.p = def.proportions;
    this.L = def.look;
    this.O = def.look.outfit ?? legacyOutfit(def);
    const J = {} as Record<BoneName, Vector3>;
    for (const b of BONE_SPECS) J[b.name] = bindPosition(b.name, this.p);
    this.J = J;
    this.accent = this.O.accent ?? this.L.eyes;
    const r = this.p.limbRadius;
    this.sockets = {
      rightBase: { bone: 'RightHand', offset: new Vector3(0, -r, 0.08) },
      rightTip: { bone: 'RightHand', offset: new Vector3(0, -r, 0.5) },
      leftBase: { bone: 'LeftHand', offset: new Vector3(0, -r, 0.08) },
      leftTip: { bone: 'LeftHand', offset: new Vector3(0, -r, 0.5) },
    };
  }

  build(): RigTemplate {
    this.torso();
    this.neckAndHead();
    this.arms();
    this.legs();
    this.armor();
    this.cloth();
    this.extras();
    this.weapon();
    if (this.glow.count === 0) {
      this.glow.add(
        ellipsoid([0, this.J.Head.y, 0], [0.0001, 0.0001, 0.0001], [3, 2]),
        SURF.glow(0),
        this.rigid('Head'),
      );
    }
    return {
      geometry: this.body.build(),
      glowGeometry: this.glow.build(),
      sockets: this.sockets,
      extraBones: this.extra,
      chains: this.chains,
      boneCount: this.names.length,
    };
  }

  // ------------------------------------------------------------------ weights

  private bi(name: string): number {
    const i = this.names.indexOf(name);
    if (i < 0) throw new Error(`rig ${this.def.id}: unknown bone ${name}`);
    return i;
  }

  private rigid(bone: string): WeightFn {
    const i = this.bi(bone);
    return (_p, out) => {
      out.push([i, 1]);
    };
  }

  private mix(a: string, wa: number, b: string): WeightFn {
    const ia = this.bi(a);
    const ib = this.bi(b);
    return (_p, out) => {
      out.push([ia, wa], [ib, 1 - wa]);
    };
  }

  /** Limb segment: blends half-way into the parent at the top and the child at the bottom. */
  private limbW(
    bone: BoneName,
    parent: BoneName,
    child: BoneName | null,
    yTop: number,
    yBot: number,
    blend = 0.24,
  ): WeightFn {
    const ib = this.bi(bone);
    const ip = this.bi(parent);
    const ic = child === null ? -1 : this.bi(child);
    return (p, out) => {
      const t = Math.min(1, Math.max(0, (yTop - p.y) / (yTop - yBot)));
      const wp = t < blend ? 0.5 * (1 - t / blend) : 0;
      const wc = ic >= 0 && t > 1 - blend ? 0.5 * ((t - (1 - blend)) / blend) : 0;
      out.push([ib, 1 - wp - wc]);
      if (wp > 0) out.push([ip, wp]);
      if (wc > 0) out.push([ic, wc]);
    };
  }

  /** Torso: hips → spine → chest by height; shoulders follow the arms, groin the thighs. */
  private readonly torsoW: WeightFn = (p: Vector3, out: Influences) => {
    const J = this.J;
    const a = smooth01(J.Spine.y - 0.05, J.Spine.y + 0.05, p.y);
    const b = smooth01(J.Chest.y - 0.06, J.Chest.y + 0.06, p.y);
    const left = p.x >= 0;
    const sh = left ? J.LeftArm : J.RightArm;
    const up = left ? J.LeftUpLeg : J.RightUpLeg;
    const ax = Math.abs(p.x);
    const wArm =
      0.45 *
      smooth01(Math.abs(sh.x) * 0.55, Math.abs(sh.x) * 1.0, ax) *
      smooth01(sh.y - 0.14, sh.y - 0.02, p.y);
    const wLeg =
      0.5 * smooth01(up.y + 0.03, up.y - 0.09, p.y) * smooth01(0, Math.abs(up.x) * 0.9, ax);
    const k = 1 - wArm - wLeg;
    out.push(
      [this.bi('Hips'), (1 - a) * k],
      [this.bi('Spine'), (a - b) * k],
      [this.bi('Chest'), b * k],
    );
    if (wArm > 0) out.push([this.bi(left ? 'LeftArm' : 'RightArm'), wArm]);
    if (wLeg > 0) out.push([this.bi(left ? 'LeftUpLeg' : 'RightUpLeg'), wLeg]);
  };

  /** Skirts and robes: the hem follows the thighs, the waist follows the hips. */
  private skirtW(yTop: number, yBot: number, follow: number): WeightFn {
    const ih = this.bi('Hips');
    const il = this.bi('LeftUpLeg');
    const ir = this.bi('RightUpLeg');
    return (p, out) => {
      if (p.y > yTop) {
        this.torsoW(p, out);
        return;
      }
      const h = Math.min(1, Math.max(0, (yTop - p.y) / (yTop - yBot)));
      const wl = follow * Math.min(1, h * 1.2);
      const side = smooth01(-0.07, 0.07, p.x);
      out.push([ih, 1 - wl], [il, wl * side], [ir, wl * (1 - side)]);
    };
  }

  /** Smooth weights along a bone chain starting at `top` and running along `dir`. */
  private chainW(bones: readonly string[], top: Vector3, dir: Vector3, seg: number): WeightFn {
    const idx = bones.map((b) => this.bi(b));
    const d = new Vector3();
    return (p, out) => {
      const s = Math.max(0, d.subVectors(p, top).dot(dir)) / seg;
      const k = Math.min(idx.length - 1, Math.floor(s));
      const f = s - k;
      const a = idx[k] ?? idx[0] ?? 0;
      const b = idx[k + 1];
      if (b === undefined || k >= idx.length - 1) out.push([a, 1]);
      else out.push([a, 1 - f], [b, f]);
    };
  }

  /** Adds a chain of `count` bones hanging from `parent` at bind position `top` along `dir`. */
  private addChain(
    kind: ChainKind,
    name: string,
    parent: BoneName,
    top: Vector3,
    dir: Vector3,
    seg: number,
    count: number,
    side: number,
  ): string[] {
    const bones: string[] = [];
    const base = this.J[parent];
    for (let i = 0; i < count; i++) {
      const bone = `${name}${i}`;
      const pos: [number, number, number] =
        i === 0
          ? [top.x - base.x, top.y - base.y, top.z - base.z]
          : [dir.x * seg, dir.y * seg, dir.z * seg];
      this.extra.push({ name: bone, parent: i === 0 ? parent : (bones[i - 1] ?? parent), pos });
      this.names.push(bone);
      bones.push(bone);
    }
    this.chains.push({ kind, bones, parent, side });
    return bones;
  }

  // ------------------------------------------------------------------ surfaces

  private garment(): Surf {
    const a = this.O.armor;
    const c = this.L.body;
    if (a === 'leather') return SURF.leather(c);
    if (a === 'hide' || a === 'rags') return SURF.skin(this.L.skin);
    if (a === 'straw') return SURF.cloth(c);
    return SURF.cloth(c);
  }

  private trim(): Surf {
    return this.O.armor === 'plate' || this.O.armor === 'robe' || this.O.armor === 'leather'
      ? SURF.gold(this.L.trim)
      : SURF.leather(this.L.trim);
  }

  // ------------------------------------------------------------------ body

  private torsoRings(pad = 0): Ring[] {
    const J = this.J;
    const t = this.p.torsoRadius + pad;
    const cw = this.p.chestWidth;
    const bulk = this.O.bulk ?? 0;
    const hunch = this.O.hunch ?? 0;
    const shY = J.LeftArm.y;
    return [
      { y: J.Neck.y + 0.012, rx: 0.42 * t, rz: 0.4 * t, oz: -0.005 },
      { y: J.Neck.y - 0.03, rx: t * cw * 0.74, rz: 0.62 * t + hunch * 0.03, oz: -hunch * 0.03 },
      { y: shY - 0.004, rx: t * cw * 0.98, rz: 0.78 * t + hunch * 0.04, oz: -hunch * 0.035 },
      {
        y: J.Chest.y + this.p.chestLen * 0.5,
        rx: t * cw * 0.97 * (1 + 0.1 * bulk),
        rz: 0.9 * t * (1 + 0.25 * bulk),
        oz: 0.022,
      },
      {
        y: J.Chest.y + 0.015,
        rx: t * (0.95 + (cw - 1) * 0.45) * (1 + 0.2 * bulk),
        rz: 0.82 * t * (1 + 0.35 * bulk),
        oz: 0.014 + 0.03 * bulk,
      },
      {
        y: J.Spine.y + 0.04,
        rx: t * 0.86 * (1 + 0.28 * bulk),
        rz: 0.7 * t * (1 + 0.55 * bulk),
        oz: 0.01 + 0.05 * bulk,
      },
      { y: J.Hips.y + 0.02, rx: t * 1.02 * (1 + 0.1 * bulk), rz: 0.74 * t * (1 + 0.2 * bulk) },
      { y: J.Hips.y - 0.07, rx: t * 0.9, rz: 0.68 * t },
      { y: J.Hips.y - 0.125, rx: t * 0.45, rz: 0.42 * t },
    ];
  }

  private torso(): void {
    const surf = this.garment();
    const a = this.O.armor;
    const J = this.J;
    if (a === 'hide' || a === 'rags') {
      // Bare torso with a darker belly/loin band.
      const skin = SURF.skin(this.L.skin);
      const low = SURF.cloth(this.L.body);
      this.body.add(
        loft(this.torsoRings(), 14),
        (v) => (v.y < J.Hips.y + 0.03 ? low : skin),
        this.torsoW,
      );
    } else {
      this.body.add(loft(this.torsoRings(), 14), surf, this.torsoW);
    }
  }

  private neckAndHead(): void {
    const J = this.J;
    const p = this.p;
    const t = p.torsoRadius;
    const hr = p.headRadius;
    const skin = SURF.skin(this.L.skin);
    const iN = this.bi('Neck');
    const iC = this.bi('Chest');
    const iH = this.bi('Head');
    this.body.add(
      limb(0, 0, J.Head.y + 0.03, J.Neck.y - 0.01, (k) => [
        0.37 * t + k * 0.012,
        0.36 * t + k * 0.012,
      ]),
      skin,
      (v, out) => {
        const wh = 0.6 * smooth01(J.Neck.y + 0.03, J.Head.y + 0.02, v.y);
        const wc = 0.5 * smooth01(J.Neck.y + 0.03, J.Neck.y - 0.01, v.y);
        out.push([iN, 1 - wh - wc], [iH, wh], [iC, wc]);
      },
    );
    const head = this.rigid('Head');
    const c = J.Head;
    const kind = this.O.head;
    const eyeGlow = (z: number, y: number, size: number, sep: number): void => {
      if (this.L.eyes === 0) return;
      for (const s of [1, -1]) {
        this.glow.add(
          ellipsoid(
            [c.x + s * hr * sep, c.y + y, c.z + z],
            [hr * size * 1.25, hr * size * 0.7, hr * size * 0.6],
            [8, 6],
          ),
          SURF.glow(this.L.eyes),
          head,
        );
      }
    };
    const skull = (): void => {
      this.body.add(
        ellipsoid([c.x, c.y + hr * 0.95, c.z - 0.005], [hr * 0.86, hr * 1.0, hr * 0.95]),
        skin,
        head,
      );
      this.body.add(
        ellipsoid([c.x, c.y + hr * 0.42, c.z + hr * 0.22], [hr * 0.62, hr * 0.45, hr * 0.6]),
        skin,
        head,
      );
      // Brow ridge and cheekbones give the face planes under the light.
      this.body.add(
        ellipsoid(
          [c.x, c.y + hr * 1.12, c.z + hr * 0.7],
          [hr * 0.78, hr * 0.16, hr * 0.28],
          [12, 6],
        ),
        skin,
        head,
      );
      for (const s of [1, -1]) {
        this.body.add(
          ellipsoid(
            [c.x + s * hr * 0.32, c.y + hr * 0.95, c.z + hr * 0.78],
            [hr * 0.17, hr * 0.12, hr * 0.08],
            [8, 5],
          ),
          SURF.void,
          head,
        );
      }
    };
    switch (kind) {
      case 'bare':
      case 'skull':
        skull();
        eyeGlow(hr * 0.84, hr * 0.95, 0.12, 0.32);
        break;
      case 'hood':
      case 'cowl': {
        // Deep hood (outer cloth + darker lining) around a recessed, shadowed face; only the
        // eyes catch the light.
        this.body.add(
          ellipsoid([c.x, c.y + hr * 0.95, c.z - hr * 0.06], [hr * 0.74, hr * 0.86, hr * 0.8]),
          SURF.void,
          head,
        );
        const cloth = kind === 'cowl' ? SURF.cloth(this.L.body) : this.hoodCloth();
        // Rings from the pointed crown down to the drape on the shoulders, open at the face.
        const tall = kind === 'cowl' ? 1.6 : 1;
        const ring = (y: number, rx: number, rz: number, oz: number, open: number): ArcRing => ({
          y: c.y + y * hr,
          rx: rx * hr,
          rz: rz * hr,
          ox: c.x,
          oz: c.z + oz * hr,
          open,
        });
        const hoodRings = (k: number): ArcRing[] => [
          ring(1.0 + 1.15 * tall, 0.08 * k, 0.08 * k, -0.75, 0),
          ring(1.0 + 0.95 * tall, 0.55 * k, 0.62 * k, -0.45, 0),
          ring(1.75, 1.0 * k, 1.12 * k, -0.18, 0.35),
          ring(1.4, 1.2 * k, 1.32 * k, -0.06, 0.62),
          ring(0.95, 1.22 * k, 1.34 * k, 0.0, 0.72),
          ring(0.5, 1.12 * k, 1.24 * k, 0.0, 0.62),
          ring(0.12, 1.15 * k, 1.18 * k, -0.04, 0.45),
          ring(-0.3, 1.6 * k, 1.45 * k, -0.08, 0.32),
          ring(-0.62, 2.15 * k, 1.75 * k, -0.1, 0.22),
        ];
        // Above the chin the hood turns with the head; the drape below follows the chest.
        const iHead = this.bi('Head');
        const iNeck = this.bi('Neck');
        const iChest = this.bi('Chest');
        const hoodW: WeightFn = (v, out) => {
          const k = smooth01(c.y + hr * 0.25, c.y - hr * 0.55, v.y);
          out.push([iHead, 1 - k], [iNeck, k * 0.3], [iChest, k * 0.7]);
        };
        this.body.add(arcLoft(hoodRings(1), 18), cloth, hoodW);
        this.body.add(
          flipFaces(arcLoft(hoodRings(0.93), 18)),
          SURF.cloth(darken(cloth.color, 0.4)),
          hoodW,
        );
        if (kind === 'cowl') {
          // Iron mask with eye slits.
          this.body.add(
            ellipsoid(
              [c.x, c.y + hr * 0.85, c.z + hr * 0.2],
              [hr * 0.8, hr * 0.95, hr * 0.78],
              [14, 10],
              {
                phiStart: Math.PI * 0.2,
                phiLength: Math.PI * 0.6,
              },
            ),
            SURF.plate(this.L.metal),
            head,
          );
          eyeGlow(hr * 0.96, hr * 1.0, 0.14, 0.3);
        } else {
          if (this.O.mask === true) {
            this.body.add(
              ellipsoid(
                [c.x, c.y + hr * 0.62, c.z + hr * 0.12],
                [hr * 0.86, hr * 0.5, hr * 0.84],
                [14, 8],
                {
                  phiStart: Math.PI * 0.1,
                  phiLength: Math.PI * 0.8,
                },
              ),
              SURF.cloth(this.O.scarf ?? this.L.trim),
              head,
            );
          }
          eyeGlow(hr * 0.86, hr * 0.98, 0.11, 0.3);
        }
        // Mantle over the shoulders.
        this.body.add(
          loft(
            [
              { y: J.Neck.y + 0.06, rx: t * 0.55, rz: t * 0.55 },
              { y: J.Neck.y - 0.02, rx: t * this.p.chestWidth * 0.95, rz: t * 0.92 },
              { y: J.LeftArm.y - 0.07, rx: t * this.p.chestWidth * 1.12, rz: t * 1.0 },
            ],
            16,
            false,
            false,
          ),
          cloth,
          this.torsoW,
        );
        break;
      }
      case 'helm':
      case 'greathelm': {
        const metal = SURF.plate(this.L.metal);
        if (kind === 'helm') {
          this.body.add(
            ellipsoid([c.x, c.y + hr * 1.02, c.z], [hr * 1.06, hr * 1.14, hr * 1.12]),
            metal,
            head,
          );
          this.body.add(
            ellipsoid(
              [c.x, c.y + hr * 0.62, c.z + hr * 0.18],
              [hr * 0.94, hr * 0.7, hr * 1.0],
              [14, 8],
              {
                phiStart: Math.PI * 0.15,
                phiLength: Math.PI * 0.7,
              },
            ),
            metal,
            head,
          );
        } else {
          this.body.add(
            loft(
              [
                { y: c.y + hr * 2.0, rx: hr * 0.7, rz: hr * 0.75 },
                { y: c.y + hr * 1.75, rx: hr * 1.08, rz: hr * 1.12 },
                { y: c.y + hr * 0.6, rx: hr * 1.12, rz: hr * 1.18, oz: hr * 0.05 },
                { y: c.y + hr * 0.15, rx: hr * 1.02, rz: hr * 1.05, oz: hr * 0.06 },
              ],
              16,
            ),
            metal,
            head,
          );
        }
        // Visor: a glowing slit (T-shaped on the great helm).
        const vz = c.z + hr * (kind === 'helm' ? 1.1 : 1.2);
        this.glow.add(
          place(new RoundedBoxGeometry(hr * 1.2, hr * 0.1, hr * 0.06, 1, hr * 0.03), [
            c.x,
            c.y + hr * 1.0,
            vz,
          ]),
          SURF.glow(this.accent),
          head,
        );
        if (kind === 'greathelm') {
          this.glow.add(
            place(new RoundedBoxGeometry(hr * 0.1, hr * 0.6, hr * 0.06, 1, hr * 0.03), [
              c.x,
              c.y + hr * 0.7,
              vz,
            ]),
            SURF.glow(this.accent),
            head,
          );
        }
        // Crest.
        this.body.add(
          place(new RoundedBoxGeometry(hr * 0.12, hr * 0.28, hr * 2.1, 1, hr * 0.05), [
            c.x,
            c.y + hr * (kind === 'helm' ? 2.12 : 2.05),
            c.z - hr * 0.1,
          ]),
          this.trim(),
          head,
        );
        break;
      }
      case 'crown': {
        skull();
        eyeGlow(hr * 0.84, hr * 0.95, 0.13, 0.32);
        const gold = SURF.gold(this.L.trim);
        this.body.add(
          loft(
            [
              { y: c.y + hr * 1.62, rx: hr * 0.95, rz: hr * 1.0 },
              { y: c.y + hr * 1.3, rx: hr * 0.92, rz: hr * 0.98 },
            ],
            16,
            false,
            false,
          ),
          gold,
          head,
        );
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          this.body.add(
            place(new ConeGeometry(hr * 0.12, hr * (i % 2 === 0 ? 0.75 : 0.45), 5), [
              c.x + Math.sin(a) * hr * 0.92,
              c.y + hr * (i % 2 === 0 ? 1.95 : 1.8),
              c.z + Math.cos(a) * hr * 0.97,
            ]),
            gold,
            head,
          );
        }
        this.glow.add(
          ellipsoid(
            [c.x, c.y + hr * 1.47, c.z + hr * 0.98],
            [hr * 0.1, hr * 0.13, hr * 0.06],
            [8, 6],
          ),
          SURF.glow(this.accent),
          head,
        );
        break;
      }
    }
    if (this.L.horns) {
      for (const side of [1, -1]) {
        const o = new Vector3(c.x + side * hr * 0.6, c.y + hr * 1.45, c.z + hr * 0.05);
        const pts = [
          o,
          o.clone().add(new Vector3(side * hr * 0.45, hr * 0.35, -hr * 0.05)),
          o.clone().add(new Vector3(side * hr * 0.75, hr * 0.85, -hr * 0.35)),
          o.clone().add(new Vector3(side * hr * 0.6, hr * 1.25, -hr * 0.85)),
        ];
        this.body.add(
          sweep(pts, (k) => hr * 0.23 * (1 - 0.92 * k), 10, 8),
          SURF.bone(this.L.trim),
          head,
        );
      }
    }
  }

  private hoodCloth(): Surf {
    return SURF.cloth(this.O.cape?.color ?? this.L.body);
  }

  private arms(): void {
    const J = this.J;
    const r = this.p.limbRadius;
    const a = this.O.armor;
    const sleeve = a === 'hide' || a === 'rags' ? SURF.skin(this.L.skin) : this.garment();
    const fore = a === 'plate' || a === 'leather' || a === 'robe' ? sleeve : SURF.skin(this.L.skin);
    const glove =
      a === 'hide' || a === 'rags' || a === 'straw'
        ? SURF.skin(this.L.skin)
        : SURF.leather(darken(this.L.trim, 0.5));
    for (const side of ['Left', 'Right'] as const) {
      const s = side === 'Left' ? 1 : -1;
      const sh = J[`${side}Arm`];
      const el = J[`${side}ForeArm`];
      const wr = J[`${side}Hand`];
      this.body.add(
        limb(sh.x, sh.z, sh.y + r * 0.9, el.y, (t) => [
          r * (1.32 - 0.2 * t - 0.25 * t * t),
          r * (1.22 - 0.1 * t - 0.25 * t * t),
          0,
          0.004 * Math.sin(t * Math.PI),
        ]),
        sleeve,
        this.limbW(`${side}Arm`, 'Chest', `${side}ForeArm`, sh.y, el.y),
      );
      this.body.add(
        limb(el.x, el.z, el.y + r * 0.4, wr.y, (t) => [
          r * (0.95 + 0.12 * Math.sin(Math.min(1, t * 2.2) * Math.PI * 0.5) - 0.38 * t),
          r * (0.92 + 0.06 * Math.sin(t * Math.PI) - 0.32 * t),
        ]),
        fore,
        this.limbW(`${side}ForeArm`, `${side}Arm`, `${side}Hand`, el.y, wr.y),
      );
      // Fist + thumb.
      const hand = this.rigid(`${side}Hand`);
      this.body.add(
        ellipsoid([wr.x, wr.y - r * 1.15, wr.z + r * 0.15], [r * 0.9, r * 1.3, r * 1.05], [10, 8]),
        glove,
        hand,
      );
      this.body.add(
        ellipsoid(
          [wr.x - s * r * 0.55, wr.y - r * 0.8, wr.z + r * 0.75],
          [r * 0.32, r * 0.5, r * 0.32],
          [6, 5],
          undefined,
          [0.5, 0, s * 0.4],
        ),
        glove,
        hand,
      );
    }
  }

  private legs(): void {
    const J = this.J;
    const r = this.p.limbRadius;
    const a = this.O.armor;
    const pants =
      a === 'hide' || a === 'rags'
        ? SURF.skin(this.L.skin)
        : a === 'leather'
          ? SURF.leather(darken(this.L.body, 0.85))
          : SURF.cloth(darken(this.L.body, 0.9));
    const boot =
      a === 'hide' || a === 'rags' || a === 'straw'
        ? SURF.skin(darken(this.L.skin, 0.8))
        : SURF.leather(darken(this.L.trim, 0.45));
    for (const side of ['Left', 'Right'] as const) {
      const hip = J[`${side}UpLeg`];
      const knee = J[`${side}Leg`];
      const ankleY = knee.y - this.p.shin;
      this.body.add(
        limb(hip.x, hip.z, hip.y + 0.035, knee.y, (t) => [
          r * (1.62 - 0.55 * t * t),
          r * (1.55 - 0.5 * t * t),
          0,
          0.006 * Math.sin(t * Math.PI),
        ]),
        pants,
        this.limbW(`${side}UpLeg`, 'Hips', `${side}Leg`, hip.y, knee.y),
      );
      this.body.add(
        limb(knee.x, knee.z, knee.y + r * 0.5, ankleY, (t) => [
          r * (1.06 + 0.16 * Math.sin(Math.min(1, t * 2) * Math.PI) - 0.4 * t),
          r * (1.02 + 0.22 * Math.sin(Math.min(1, t * 2) * Math.PI) - 0.36 * t),
          0,
          -0.012 * Math.sin(Math.min(1, t * 2) * Math.PI),
        ]),
        pants,
        this.limbW(`${side}Leg`, `${side}UpLeg`, null, knee.y, ankleY),
      );
      const shin = this.rigid(`${side}Leg`);
      // Boot: shaft + foot.
      if (a !== 'hide' && a !== 'straw') {
        this.body.add(
          limb(knee.x, knee.z, ankleY + this.p.shin * 0.45, ankleY - 0.01, (t) => [
            r * (1.18 - 0.22 * t),
            r * (1.18 - 0.18 * t),
          ]),
          boot,
          shin,
        );
      }
      this.body.add(
        ellipsoid(
          [knee.x, ankleY - 0.005, knee.z + r * 1.0],
          [r * 1.05, r * 0.85, r * 2.25],
          [12, 8],
        ),
        boot,
        shin,
      );
    }
  }

  // ------------------------------------------------------------------ armor

  private armor(): void {
    const J = this.J;
    const p = this.p;
    const r = p.limbRadius;
    const t = p.torsoRadius;
    const cw = p.chestWidth;
    const a = this.O.armor;
    const metal = SURF.plate(this.L.metal);
    const trim = this.trim();
    // Belt with a buckle and a glowing gem (every armoured or clothed rig).
    if (a !== 'hide' && a !== 'straw') {
      const by = J.Hips.y + 0.035;
      this.body.add(
        loft(
          [
            { y: by + 0.03, rx: t * 1.07, rz: t * 0.8 },
            { y: by - 0.03, rx: t * 1.08, rz: t * 0.81 },
          ],
          16,
          false,
          false,
        ),
        a === 'robe' ? SURF.cloth(this.L.trim) : SURF.leather(darken(this.L.trim, 0.55)),
        this.torsoW,
      );
      this.body.add(
        place(new RoundedBoxGeometry(0.075, 0.06, 0.02, 1, 0.008), [0, by, t * 0.81 + 0.008]),
        SURF.gold(this.L.trim),
        this.torsoW,
      );
      this.glow.add(
        ellipsoid([0, by, t * 0.81 + 0.02], [0.014, 0.014, 0.008], [6, 5]),
        SURF.glow(this.accent),
        this.torsoW,
      );
    }
    if (a === 'plate') {
      const cy = J.Chest.y + p.chestLen * 0.42;
      // Breastplate + backplate.
      this.body.add(
        ellipsoid([0, cy, 0.022], [t * cw * 1.04, p.chestLen * 0.78, t * 0.98], [14, 8], {
          phiStart: 0,
          phiLength: Math.PI,
          thetaStart: Math.PI * 0.12,
          thetaLength: Math.PI * 0.72,
        }),
        metal,
        this.torsoW,
      );
      this.body.add(
        ellipsoid([0, cy, 0.0], [t * cw * 1.02, p.chestLen * 0.78, t * 0.9], [14, 8], {
          phiStart: Math.PI,
          phiLength: Math.PI,
          thetaStart: Math.PI * 0.12,
          thetaLength: Math.PI * 0.72,
        }),
        metal,
        this.torsoW,
      );
      // Ridge down the breastplate.
      this.body.add(
        place(
          new RoundedBoxGeometry(0.03, p.chestLen * 1.1, 0.03, 1, 0.012),
          [0, cy - 0.01, t * 0.98 + 0.012],
          [-0.12, 0, 0],
        ),
        trim,
        this.torsoW,
      );
      // Fauld bands over the belly.
      for (let k = 0; k < 2; k++) {
        const y = J.Spine.y + 0.06 - k * 0.055;
        this.body.add(
          loft(
            [
              { y: y + 0.03, rx: t * (0.95 + k * 0.06), rz: t * (0.8 + k * 0.03), oz: 0.012 },
              { y: y - 0.03, rx: t * (1.0 + k * 0.06), rz: t * (0.84 + k * 0.03), oz: 0.012 },
            ],
            16,
            false,
            false,
          ),
          metal,
          this.torsoW,
        );
      }
      // Gorget.
      this.body.add(
        loft(
          [
            { y: J.Neck.y + 0.05, rx: t * 0.55, rz: t * 0.52 },
            { y: J.Neck.y - 0.02, rx: t * 0.85, rz: t * 0.75 },
          ],
          14,
          false,
          false,
        ),
        metal,
        this.torsoW,
      );
    }
    if (a === 'leather') {
      // Crossed straps over the chest.
      for (const s of [1, -1]) {
        const strap = new TorusGeometry(t * 1.0, 0.011, 5, 28);
        strap.rotateX(Math.PI / 2);
        strap.rotateZ(s * 0.62);
        strap.scale(cw * 0.98, 1, 0.9);
        strap.translate(0, J.Chest.y + p.chestLen * 0.3, 0.012);
        this.body.add(strap, SURF.leather(darken(this.L.trim, 0.5)), this.torsoW);
      }
      this.body.add(
        place(
          new RoundedBoxGeometry(0.05, 0.05, 0.02, 1, 0.008),
          [0, J.Chest.y + p.chestLen * 0.3, t * 0.95],
          [0, 0, Math.PI / 4],
        ),
        SURF.gold(this.L.trim),
        this.torsoW,
      );
    }
    if (a === 'robe') {
      // Floor-length robe; the hem follows the legs.
      const top = J.Spine.y + 0.03;
      const yBot = 0.05;
      const rings: Ring[] = [];
      const n = 8;
      for (let i = 0; i < n; i++) {
        const k = i / (n - 1);
        rings.push({
          y: top + (yBot - top) * k,
          rx: t * (1.0 + 0.85 * k * k) + 0.01,
          rz: t * (0.78 + 0.7 * k * k) + 0.01,
          oz: 0.01,
        });
      }
      this.body.add(
        loft(rings, 18, false, true),
        (v) => (v.y < 0.13 ? SURF.cloth(this.L.trim) : SURF.cloth(this.L.body)),
        this.skirtW(J.Hips.y, yBot, 0.8),
      );
      const last = rings[rings.length - 1];
      if (last !== undefined) {
        this.glow.add(
          loft(
            [
              { y: 0.16, rx: last.rx * 0.985, rz: last.rz * 0.985, oz: 0.01 },
              { y: 0.145, rx: last.rx * 0.99, rz: last.rz * 0.99, oz: 0.01 },
            ],
            18,
            false,
            false,
          ),
          SURF.glow(this.accent),
          this.skirtW(J.Hips.y, yBot, 0.8),
        );
      }
      // Wide sleeves.
      for (const side of ['Left', 'Right'] as const) {
        const el = J[`${side}ForeArm`];
        const wr = J[`${side}Hand`];
        this.body.add(
          limb(
            el.x,
            el.z,
            el.y + 0.01,
            wr.y + 0.02,
            (k) => [r * (1.2 + 1.0 * k), r * (1.2 + 1.0 * k)],
            6,
          ),
          SURF.cloth(this.L.body),
          this.limbW(`${side}ForeArm`, `${side}Arm`, null, el.y, wr.y),
        );
      }
    }
    if (a === 'rags') {
      // Torn wraps around torso and arms.
      const wrap = SURF.cloth(this.L.body);
      for (let k = 0; k < 3; k++) {
        const y = J.Spine.y + 0.03 + k * 0.07;
        this.body.add(
          place(
            new TorusGeometry(t * (1.0 - k * 0.04), 0.016, 4, 20),
            [0, y, 0.01],
            [Math.PI / 2 + 0.15 * (k - 1), 0, 0.12 * (k - 1)],
            [cw * 0.9, 0.8, 1],
          ),
          wrap,
          this.torsoW,
        );
      }
    }
    if (a === 'hide') {
      // Fur mantle: lumpy ring over the shoulders.
      const fur = SURF.fur(this.L.trim);
      for (let i = 0; i < 10; i++) {
        const ang = (i / 10) * Math.PI * 2;
        this.body.add(
          ellipsoid(
            [
              Math.sin(ang) * t * cw * 0.82,
              J.Neck.y - 0.03 + 0.015 * Math.sin(i * 2.3),
              Math.cos(ang) * t * 0.72 - 0.01,
            ],
            [t * 0.42, t * 0.3, t * 0.36],
            [8, 6],
          ),
          fur,
          this.torsoW,
        );
      }
    }
    // Shoulder armour.
    if (this.L.pauldrons) {
      const plate = a === 'plate' || a === 'hide';
      for (const side of ['Left', 'Right'] as const) {
        const s = side === 'Left' ? 1 : -1;
        const sh = J[`${side}Arm`];
        const w = this.mix(`${side}Arm`, 0.65, 'Chest');
        const layers = plate ? 3 : 1;
        for (let k = 0; k < layers; k++) {
          this.body.add(
            ellipsoid(
              [sh.x + s * (0.012 + k * 0.006), sh.y + 0.035 - k * 0.042, sh.z],
              [r * (2.45 - k * 0.22), r * 1.45, r * (2.35 - k * 0.2)],
              [12, 6],
              { thetaLength: Math.PI * 0.55 },
              [0, 0, -s * (0.35 + k * 0.12)],
            ),
            a === 'hide'
              ? SURF.bone(this.L.metal)
              : plate
                ? metal
                : SURF.leather(darken(this.L.body, 0.8)),
            w,
          );
        }
        this.body.add(
          place(
            new TorusGeometry(r * 2.3, r * 0.14, 5, 22),
            [sh.x + s * 0.012, sh.y + 0.0, sh.z],
            [Math.PI / 2, 0, -s * 0.35],
            [1, 1, 1],
          ),
          trim,
          w,
        );
        if (this.O.spikes === true) {
          for (let k = 0; k < 3; k++) {
            this.body.add(
              place(
                new ConeGeometry(r * 0.32, r * 1.6, 6),
                [
                  sh.x + s * (r * 0.4 + k * r * 0.5),
                  sh.y + r * 1.25 - k * r * 0.18,
                  sh.z + (k - 1) * r * 0.6,
                ],
                [0, 0, -s * (0.25 + k * 0.3)],
              ),
              SURF.bone(this.L.metal),
              w,
            );
          }
        }
      }
    }
    // Plate limbs.
    if (a === 'plate') {
      for (const side of ['Left', 'Right'] as const) {
        const el = J[`${side}ForeArm`];
        const wr = J[`${side}Hand`];
        const hip = J[`${side}UpLeg`];
        const knee = J[`${side}Leg`];
        const ankleY = knee.y - p.shin;
        // Vambrace + gauntlet.
        this.body.add(
          limb(
            el.x,
            el.z,
            el.y - p.foreArm * 0.22,
            wr.y + 0.01,
            (k) => [r * (1.28 - 0.22 * k), r * (1.24 - 0.2 * k)],
            6,
          ),
          metal,
          this.limbW(`${side}ForeArm`, `${side}Arm`, null, el.y, wr.y),
        );
        this.body.add(
          ellipsoid(
            [wr.x, wr.y - r * 0.85, wr.z + r * 0.2],
            [r * 1.05, r * 1.05, r * 1.15],
            [8, 6],
          ),
          metal,
          this.rigid(`${side}Hand`),
        );
        // Elbow cop.
        this.body.add(
          ellipsoid([el.x, el.y, el.z - r * 0.55], [r * 0.85, r * 0.85, r * 0.7], [8, 6]),
          metal,
          this.mix(`${side}ForeArm`, 0.5, `${side}Arm`),
        );
        // Cuisse (thigh plate, front half).
        this.body.add(
          ellipsoid(
            [hip.x, (hip.y + knee.y) / 2 + 0.03, hip.z + 0.01],
            [r * 1.72, p.thigh * 0.46, r * 1.66],
            [12, 8],
            {
              phiStart: 0,
              phiLength: Math.PI,
            },
          ),
          metal,
          this.limbW(`${side}UpLeg`, 'Hips', `${side}Leg`, hip.y, knee.y),
        );
        // Knee cop.
        this.body.add(
          ellipsoid(
            [knee.x, knee.y + 0.005, knee.z + r * 0.75],
            [r * 1.05, r * 1.1, r * 0.75],
            [8, 6],
          ),
          SURF.plate(this.L.metal),
          this.mix(`${side}Leg`, 0.5, `${side}UpLeg`),
        );
        // Greave + sabaton.
        this.body.add(
          limb(
            knee.x,
            knee.z,
            knee.y - 0.03,
            ankleY - 0.005,
            (k) => [
              r * (1.32 + 0.1 * Math.sin(Math.min(1, k * 2) * Math.PI) - 0.3 * k),
              r * (1.3 + 0.14 * Math.sin(Math.min(1, k * 2) * Math.PI) - 0.28 * k),
              0,
              -0.008 * Math.sin(Math.min(1, k * 2) * Math.PI),
            ],
            6,
            10,
          ),
          metal,
          this.rigid(`${side}Leg`),
        );
        this.body.add(
          ellipsoid(
            [knee.x, ankleY + 0.005, knee.z + r * 1.05],
            [r * 1.18, r * 0.95, r * 2.4],
            [12, 8],
            {
              thetaLength: Math.PI * 0.62,
            },
          ),
          metal,
          this.rigid(`${side}Leg`),
        );
      }
    }
    if (a === 'leather') {
      for (const side of ['Left', 'Right'] as const) {
        const el = J[`${side}ForeArm`];
        const wr = J[`${side}Hand`];
        this.body.add(
          limb(
            el.x,
            el.z,
            el.y - p.foreArm * 0.3,
            wr.y + 0.005,
            (k) => [r * (1.18 - 0.16 * k), r * (1.14 - 0.14 * k)],
            5,
          ),
          SURF.leather(darken(this.L.trim, 0.55)),
          this.limbW(`${side}ForeArm`, `${side}Arm`, null, el.y, wr.y),
        );
        for (const f of [0.35, 0.8]) {
          this.body.add(
            loft(
              [
                {
                  y: el.y - p.foreArm * f + 0.008,
                  rx: r * (1.22 - f * 0.16),
                  rz: r * (1.18 - f * 0.14),
                },
                {
                  y: el.y - p.foreArm * f - 0.008,
                  rx: r * (1.22 - f * 0.16),
                  rz: r * (1.18 - f * 0.14),
                },
              ].map((g) => ({ ...g, ox: el.x, oz: el.z })),
              12,
              false,
              false,
            ),
            SURF.gold(this.L.trim),
            this.rigid(`${side}ForeArm`),
          );
        }
      }
    }
    if (this.O.tassets === true) {
      const y = J.Hips.y - 0.0;
      for (const [x, z, ry] of [
        [t * 0.62, t * 0.55, 0.5],
        [-t * 0.62, t * 0.55, -0.5],
        [t * 0.98, 0, 1.5],
        [-t * 0.98, 0, -1.5],
      ] as const) {
        this.body.add(
          place(
            new RoundedBoxGeometry(t * 0.95, 0.2, 0.018, 1, 0.008),
            [x, y - 0.1, z + Math.sign(z) * 0.01],
            [0.08, ry, 0],
          ),
          metal,
          this.skirtW(J.Hips.y + 0.02, J.Hips.y - 0.22, 0.75),
        );
      }
    }
    if (this.O.cracks !== undefined) this.cracks(this.O.cracks);
  }

  /** Glowing cracks over the torso and limbs (demons). */
  private cracks(color: number): void {
    const J = this.J;
    const rings = this.torsoRings(0.004);
    let seed = 11;
    const rnd = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const glow = SURF.glow(color);
    for (let i = 0; i < 18; i++) {
      const ri = 2 + Math.floor(rnd() * 4);
      const a0 = rings[ri];
      if (a0 === undefined) continue;
      const ang = rnd() * Math.PI * 2;
      const x = Math.sin(ang) * a0.rx;
      const z = (a0.oz ?? 0) + Math.cos(ang) * a0.rz;
      const len = 0.05 + rnd() * 0.08;
      this.glow.add(
        place(
          new RoundedBoxGeometry(0.008, len, 0.006, 1, 0.002),
          [x, a0.y - len * 0.3, z],
          [0, ang, (rnd() - 0.5) * 1.6],
        ),
        glow,
        this.torsoW,
      );
    }
    for (const side of ['Left', 'Right'] as const) {
      const sh = J[`${side}Arm`];
      const r = this.p.limbRadius;
      for (let k = 0; k < 3; k++) {
        const ang = rnd() * Math.PI * 2;
        this.glow.add(
          place(
            new RoundedBoxGeometry(0.007, 0.07, 0.006, 1, 0.002),
            [
              sh.x + Math.sin(ang) * r * 1.2,
              sh.y - 0.06 - k * 0.07,
              sh.z + Math.cos(ang) * r * 1.2,
            ],
            [0, ang, (rnd() - 0.5) * 1.2],
          ),
          glow,
          this.rigid(`${side}Arm`),
        );
      }
    }
  }

  // ------------------------------------------------------------------ cloth (spring bones)

  private cloth(): void {
    const J = this.J;
    const t = this.p.torsoRadius;
    const cape = this.O.cape;
    if (cape !== undefined) this.cape(cape);
    if (this.O.scarf !== undefined) {
      const col = SURF.cloth(this.O.scarf);
      this.body.add(
        place(
          new TorusGeometry(t * 0.62, 0.035, 8, 20),
          [0, J.Neck.y + 0.025, 0.005],
          [Math.PI / 2 + 0.12, 0, 0],
          [1.05, 1, 1],
        ),
        col,
        this.mix('Neck', 0.5, 'Chest'),
      );
      for (const s of [1, -1]) {
        const top = new Vector3(s * 0.035, J.Neck.y + 0.0, -t * 0.62);
        const dir = new Vector3(s * 0.18, -1, -0.3).normalize();
        const len = 0.42;
        const bones = this.addChain(
          'scarf',
          `Scarf${s > 0 ? 'L' : 'R'}`,
          'Chest',
          top,
          dir,
          len / 2,
          2,
          s,
        );
        const g = clothPanel(0.075, len, 1, 6, {
          taper: 0.75,
          tattered: true,
          seed: s > 0 ? 3 : 9,
        });
        this.body.add(orientPanel(g, top, dir), col, this.chainW(bones, top, dir, len / 2));
      }
    }
    if (this.O.tabard !== undefined) {
      const col = this.O.tabard;
      for (const front of [true, false]) {
        const zSurf = front ? t * 0.8 + 0.012 : -(t * 0.8 + 0.012);
        const top = new Vector3(0, J.Hips.y + 0.02, zSurf);
        const dir = new Vector3(0, -1, front ? 0.06 : -0.06).normalize();
        const len = J.Hips.y - 0.32;
        const bones = this.addChain(
          front ? 'tabardFront' : 'tabardBack',
          front ? 'TabardF' : 'TabardB',
          'Hips',
          top,
          dir,
          len / 2,
          2,
          0,
        );
        const g = clothPanel(t * 1.25, len, 2, 6, { taper: 0.92, curve: front ? -0.02 : 0.02 });
        if (!front) g.rotateY(Math.PI);
        const hem = SURF.gold(this.L.trim);
        const cloth = SURF.cloth(col);
        this.body.add(
          orientPanel(g, top, dir),
          (v) => (v.y < top.y - len * 0.9 ? hem : cloth),
          this.chainW(bones, top, dir, len / 2),
        );
      }
    }
    if (this.O.armor === 'rags' || this.O.armor === 'hide') {
      // Loincloth front + back (spring panels).
      for (const front of [true, false]) {
        const zSurf = front ? t * 0.74 + 0.01 : -(t * 0.74 + 0.01);
        const top = new Vector3(0, J.Hips.y + 0.0, zSurf);
        const dir = new Vector3(0, -1, front ? 0.05 : -0.05).normalize();
        const len = 0.3;
        const bones = this.addChain(
          front ? 'tabardFront' : 'tabardBack',
          front ? 'LoinF' : 'LoinB',
          'Hips',
          top,
          dir,
          len / 2,
          2,
          0,
        );
        const g = clothPanel(t * 0.9, len, 2, 4, {
          taper: 0.7,
          tattered: true,
          seed: front ? 5 : 13,
        });
        if (!front) g.rotateY(Math.PI);
        this.body.add(
          orientPanel(g, top, dir),
          SURF.cloth(this.L.body),
          this.chainW(bones, top, dir, len / 2),
        );
      }
    }
  }

  private cape(c: ClothDef): void {
    const J = this.J;
    const t = this.p.torsoRadius;
    const cw = this.p.chestWidth;
    const hunch = this.O.hunch ?? 0;
    const top = new Vector3(0, J.Neck.y - 0.035, -(0.78 * t + hunch * 0.04) - 0.025);
    const dir = new Vector3(0, -1, -0.16).normalize();
    const seg = c.length / 3;
    const bones = this.addChain('cape', 'Cape', 'Chest', top, dir, seg, 3, 0);
    const g = clothPanel(c.width, c.length, 4, 9, {
      curve: 0.07,
      taper: 1.25,
      tattered: c.tattered,
      seed: 21,
    });
    const outer = SURF.cloth(c.color);
    const hem = SURF.cloth(darken(c.color, 0.7));
    this.body.add(
      orientPanel(g, top, dir),
      (v) => (v.y < top.y - c.length * 0.9 ? hem : outer),
      this.chainW(bones, top, dir, seg),
    );
    // Collar fold hides where the cape meets the shoulders.
    this.body.add(
      place(
        new TorusGeometry(t * cw * 0.72, 0.03, 6, 18, Math.PI),
        [0, J.Neck.y - 0.02, -0.01],
        [Math.PI / 2 + 0.25, 0, Math.PI],
        [1, 0.9, 1],
      ),
      SURF.cloth(c.color),
      this.torsoW,
    );
  }

  private extras(): void {
    const J = this.J;
    const t = this.p.torsoRadius;
    const r = this.p.limbRadius;
    if (this.O.quiver === true) {
      const g = loft(
        [
          { y: 0.26, rx: 0.06, rz: 0.06 },
          { y: 0.0, rx: 0.055, rz: 0.055 },
          { y: -0.26, rx: 0.045, rz: 0.045 },
        ],
        12,
      );
      const at: [number, number, number] = [-0.06, J.Chest.y + 0.08, -t * 0.85 - 0.06];
      const rot: [number, number, number] = [0.15, 0, -0.45];
      this.body.add(place(g, at, rot), SURF.leather(darken(this.L.trim, 0.6)), this.rigid('Chest'));
      for (let i = 0; i < 4; i++) {
        const shaft = place(new CylinderGeometry(0.004, 0.004, 0.3, 4), [0, 0.38, 0], [0, 0, 0]);
        const fl = place(new ConeGeometry(0.018, 0.06, 3), [0, 0.5, 0], [0, i, 0]);
        for (const piece of [shaft, fl]) {
          place(piece, [at[0] + (i - 1.5) * 0.018, at[1], at[2] + (i % 2) * 0.012], rot);
        }
        this.body.add(shaft, SURF.leather(0x6a5030), this.rigid('Chest'));
        this.glow.add(fl, SURF.glow(this.accent), this.rigid('Chest'));
      }
    }
    if (this.O.tail === true) {
      const top = new Vector3(0, J.Hips.y - 0.02, -t * 0.7);
      const dir = new Vector3(0, -0.45, -1).normalize();
      const seg = 0.16;
      const bones = this.addChain('tail', 'Tail', 'Hips', top, dir, seg, 4, 0);
      const len = seg * 4;
      const pts = [0, 0.33, 0.66, 1].map((k) => top.clone().addScaledVector(dir, len * k));
      const g = sweep(pts, (k) => r * (1.0 - 0.8 * k) + 0.004, 12, 8);
      const q = new Quaternion().setFromUnitVectors(new Vector3(0, -1, 0), dir);
      const tip = place(
        new ConeGeometry(r * 0.9, r * 2.2, 4),
        [0, -r, 0],
        [Math.PI, 0, 0],
        [1, 1, 0.35],
      );
      tip.applyQuaternion(q);
      const end = pts[3] ?? top;
      tip.translate(end.x, end.y, end.z);
      const w = this.chainW(bones, top, dir, seg);
      this.body.add(g, SURF.skin(this.L.skin), w);
      this.body.add(tip, SURF.bone(this.L.trim), w);
    }
    if (this.L.wings === true) {
      for (const s of [1, -1]) {
        const top = new Vector3(s * 0.08, J.Chest.y + this.p.chestLen * 0.7, -t * 0.75);
        const dir = new Vector3(s * 0.82, 0.42, -0.38).normalize();
        const seg = 0.62;
        const bones = this.addChain(
          'wing',
          `Wing${s > 0 ? 'L' : 'R'}`,
          'Chest',
          top,
          dir,
          seg,
          2,
          s,
        );
        const w = this.chainW(bones, top, dir, seg);
        const q = new Quaternion().setFromUnitVectors(new Vector3(0, -1, 0), dir);
        // Arm spar (thin, bony) and three finger spars fanning down from the wrist joint.
        const joint = top.clone().addScaledVector(dir, seg);
        const tipPt = top.clone().addScaledVector(dir, seg * 2);
        this.body.add(
          sweep([top, joint, tipPt], (k) => r * (0.75 - 0.5 * k), 10, 7),
          SURF.bone(darken(this.L.metal, 0.55)),
          w,
        );
        const fingerW = this.rigid(bones[1] ?? bones[0] ?? 'Chest');
        for (let f = 0; f < 3; f++) {
          const down = 0.35 + f * 0.42;
          const end = joint
            .clone()
            .addScaledVector(dir, seg * (1.05 - f * 0.18))
            .add(new Vector3(0, -seg * down, -seg * 0.15 * f));
          const mid = joint
            .clone()
            .lerp(end, 0.5)
            .add(new Vector3(0, seg * 0.08, 0));
          this.body.add(
            sweep([joint, mid, end], (k) => r * (0.42 - 0.3 * k), 8, 6),
            SURF.bone(darken(this.L.metal, 0.55)),
            fingerW,
          );
        }
        // Membrane hanging from the spar, long near the body and short at the tip.
        const width = seg * 2;
        const mem = clothPanel(width, 0.9, 6, 4, {
          tattered: true,
          seed: s > 0 ? 31 : 37,
          thickness: 0.01,
        });
        const pos = mem.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
          const u = (pos.getX(i) + width / 2) / width;
          pos.setY(i, pos.getY(i) * (1 - 0.72 * u));
        }
        mem.computeVertexNormals();
        mem.translate(width / 2, 0, 0);
        // Panel +X runs along the spar, −Y droops down and back.
        const xAxis = dir.clone();
        const yAxis = new Vector3(0, 1, 0.25).projectOnPlane(xAxis).normalize();
        const zAxis = new Vector3().crossVectors(xAxis, yAxis);
        const m = new Float32Array([
          xAxis.x,
          yAxis.x,
          zAxis.x,
          xAxis.y,
          yAxis.y,
          zAxis.y,
          xAxis.z,
          yAxis.z,
          zAxis.z,
        ]);
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          const y = pos.getY(i);
          const z = pos.getZ(i);
          pos.setXYZ(
            i,
            top.x + (m[0] ?? 0) * x + (m[1] ?? 0) * y + (m[2] ?? 0) * z,
            top.y + (m[3] ?? 0) * x + (m[4] ?? 0) * y + (m[5] ?? 0) * z,
            top.z + (m[6] ?? 0) * x + (m[7] ?? 0) * y + (m[8] ?? 0) * z,
          );
        }
        mem.computeVertexNormals();
        this.body.add(mem, SURF.cloth(this.L.body), w);
        this.glow.add(
          (() => {
            const vein = limb(0, 0, 0, -seg * 1.9, () => [0.006, 0.006], 4, 4);
            vein.applyQuaternion(q);
            vein.translate(top.x, top.y - 0.04, top.z - 0.01);
            return vein;
          })(),
          SURF.glow(this.L.rim),
          w,
        );
      }
    }
    if (this.L.extraArms === true) {
      for (const sd of [1, -1]) {
        for (const k of [0, 1]) {
          const y = J.Chest.y + this.p.chestLen * (0.12 + k * 0.32);
          const base = new Vector3(sd * this.p.shoulderX * 0.75, y, -0.03 - k * 0.04);
          const len = this.p.upperArm;
          const elbow = base
            .clone()
            .add(new Vector3(sd * len * 0.95, -len * (0.25 + k * 0.2), -len * 0.15));
          const wrist = elbow
            .clone()
            .add(new Vector3(sd * len * 0.25, -len * 0.35, len * (0.75 - k * 0.3)));
          const arm = sweep(
            [
              base,
              base
                .clone()
                .lerp(elbow, 0.5)
                .add(new Vector3(0, len * 0.06, 0)),
              elbow,
              wrist,
            ],
            (u) => r * (1.3 - 0.55 * u),
            14,
            9,
          );
          this.body.add(arm, SURF.skin(this.L.skin), this.rigid('Chest'));
          this.body.add(
            ellipsoid([elbow.x, elbow.y, elbow.z], [r * 1.0, r * 1.0, r * 1.0], [8, 6]),
            SURF.plate(this.L.metal),
            this.rigid('Chest'),
          );
          const fwd = wrist.clone().sub(elbow).normalize();
          for (let c = -1; c <= 1; c++) {
            const a = wrist.clone().add(new Vector3(0, 0, c * r * 0.45));
            const b = a
              .clone()
              .addScaledVector(fwd, r * 2.4)
              .add(new Vector3(0, -r * 0.9, 0));
            this.body.add(
              sweep(
                [
                  a,
                  a
                    .clone()
                    .lerp(b, 0.5)
                    .add(new Vector3(0, r * 0.4, 0)),
                  b,
                ],
                (u) => r * 0.28 * (1 - 0.9 * u),
                6,
                5,
              ),
              SURF.bone(this.def.weaponColor),
              this.rigid('Chest'),
            );
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------ weapons

  private weapon(): void {
    const r = this.p.limbRadius;
    const metal = SURF.steel(this.def.weaponColor);
    const trim = SURF.gold(this.L.trim);
    const grip = SURF.leather(0x3a2a20);
    let tilt = 0;
    const rotX = (v: readonly [number, number, number]): [number, number, number] => [
      v[0],
      v[1] * Math.cos(tilt) - v[2] * Math.sin(tilt),
      v[1] * Math.sin(tilt) + v[2] * Math.cos(tilt),
    ];
    /** Adds a part built along +Z in grip space (origin = grip point inside the fist). */
    const inHand = (
      hand: BoneName,
      g: BufferGeometry,
      surf: Surf,
      glow = false,
      bone?: string,
    ): void => {
      g.translate(0, -r, 0);
      g.rotateX(tilt);
      const b = this.J[hand];
      g.translate(b.x, b.y, b.z);
      (glow ? this.glow : this.body).add(
        g,
        glow ? SURF.glow(surf.color) : surf,
        this.rigid(bone ?? hand),
      );
    };
    const socket = (
      name: SocketName,
      bone: BoneName,
      v: readonly [number, number, number],
    ): void => {
      const [x, y, z] = rotX(v);
      this.sockets[name] = { bone, offset: new Vector3(x, y, z) };
    };
    const mirrorSockets = (): void => {
      this.sockets.leftBase = {
        bone: this.sockets.rightBase.bone,
        offset: this.sockets.rightBase.offset.clone(),
      };
      this.sockets.leftTip = {
        bone: this.sockets.rightTip.bone,
        offset: this.sockets.rightTip.offset.clone(),
      };
    };
    switch (this.def.weapon) {
      case 'dualBlades': {
        tilt = 0.75;
        for (const side of ['Left', 'Right'] as const) {
          const hand = `${side}Hand` as const;
          inHand(hand, blade(0.68, 0.042, 0.009, 0.35, 0.1), metal);
          inHand(
            hand,
            place(new RoundedBoxGeometry(0.16, 0.026, 0.035, 1, 0.008), [0, 0, 0.07]),
            trim,
          );
          inHand(
            hand,
            place(new CylinderGeometry(0.016, 0.018, 0.13, 8), [0, 0, 0.0], [Math.PI / 2, 0, 0]),
            grip,
          );
          inHand(
            hand,
            place(new RoundedBoxGeometry(0.004, 0.012, 0.5, 1, 0.002), [0, 0.025, 0.42]),
            SURF.glow(this.L.rim),
            true,
          );
        }
        socket('rightBase', 'RightHand', [0, -r, 0.12]);
        socket('rightTip', 'RightHand', [0, -r, 0.8]);
        socket('leftBase', 'LeftHand', [0, -r, 0.12]);
        socket('leftTip', 'LeftHand', [0, -r, 0.8]);
        break;
      }
      case 'greatsword': {
        tilt = 0.55;
        inHand('RightHand', blade(1.38, 0.13, 0.024, 0.12, 0.18), metal);
        inHand(
          'RightHand',
          place(new RoundedBoxGeometry(0.36, 0.05, 0.075, 1, 0.018), [0, 0, 0.13]),
          trim,
        );
        inHand(
          'RightHand',
          place(new CylinderGeometry(0.022, 0.024, 0.26, 8), [0, 0, -0.01], [Math.PI / 2, 0, 0]),
          grip,
        );
        inHand('RightHand', ellipsoid([0, 0, -0.16], [0.04, 0.04, 0.045], [8, 6]), trim);
        // Flame edge (hidden until phase 2 by scaling the FX bone).
        inHand(
          'RightHand',
          place(new RoundedBoxGeometry(0.06, 0.2, 1.42, 1, 0.02), [0, 0, 0.88]),
          SURF.glow(0xff6a1a),
          true,
          FX_BONE,
        );
        socket('rightBase', 'RightHand', [0, -r, 0.2]);
        socket('rightTip', 'RightHand', [0, -r, 1.6]);
        mirrorSockets();
        break;
      }
      case 'bowDagger': {
        // Recurve bow in the left fist: limbs run along the hand's ±Z, string toward the body.
        // Grip farthest from the archer (−Y in the fist), tips curving back toward the string.
        const R = 0.55;
        const pts = [
          new Vector3(0, 0.05, -R),
          new Vector3(0, 0.07, -R * 0.82),
          new Vector3(0, -0.01, -R * 0.45),
          new Vector3(0, -0.05, 0),
          new Vector3(0, -0.01, R * 0.45),
          new Vector3(0, 0.07, R * 0.82),
          new Vector3(0, 0.05, R),
        ];
        const bow = new TubeGeometry(new CatmullRomCurve3(pts), 28, 0.016, 6, false);
        const lh = this.J.LeftHand;
        bow.translate(lh.x, lh.y - r, lh.z);
        this.body.add(bow, SURF.leather(this.def.weaponColor), this.rigid('LeftHand'));
        const str = place(
          new CylinderGeometry(0.003, 0.003, 2 * R, 4),
          [lh.x, lh.y - r + 0.05, lh.z],
          [Math.PI / 2, 0, 0],
        );
        this.body.add(str, SURF.cloth(0xd8d0c0), this.rigid('LeftHand'));
        this.body.add(
          place(
            new CylinderGeometry(0.022, 0.022, 0.12, 8),
            [lh.x, lh.y - r - 0.05, lh.z],
            [Math.PI / 2, 0, 0],
          ),
          SURF.leather(0x2a1c14),
          this.rigid('LeftHand'),
        );
        tilt = 0.6;
        inHand('RightHand', blade(0.38, 0.032, 0.008, 0.25, 0.05), SURF.steel(0xc9ccd6));
        inHand(
          'RightHand',
          place(new RoundedBoxGeometry(0.11, 0.022, 0.03, 1, 0.006), [0, 0, 0.06]),
          trim,
        );
        socket('rightBase', 'RightHand', [0, -r, 0.1]);
        socket('rightTip', 'RightHand', [0, -r, 0.52]);
        mirrorSockets();
        break;
      }
      case 'shieldMace': {
        tilt = 0.6;
        const lh = this.J.LeftHand;
        const sh = new Shape();
        sh.moveTo(-0.24, 0.3);
        sh.lineTo(0.24, 0.3);
        sh.lineTo(0.24, -0.02);
        sh.quadraticCurveTo(0.22, -0.26, 0, -0.38);
        sh.quadraticCurveTo(-0.22, -0.26, -0.24, -0.02);
        sh.lineTo(-0.24, 0.3);
        const face = new ExtrudeGeometry(sh, {
          depth: 0.03,
          bevelEnabled: true,
          bevelThickness: 0.012,
          bevelSize: 0.012,
          bevelSegments: 2,
          curveSegments: 8,
        });
        face.translate(0, 0.0, 0.0);
        face.translate(lh.x, lh.y - r - 0.04, lh.z + 0.1);
        this.body.add(face, SURF.plate(this.L.metal), this.rigid('LeftHand'));
        const boss = ellipsoid(
          [lh.x, lh.y - r + 0.04, lh.z + 0.155],
          [0.07, 0.07, 0.04],
          [8, 6],
          { thetaLength: Math.PI * 0.5 },
          [Math.PI / 2, 0, 0],
        );
        this.body.add(boss, trim, this.rigid('LeftHand'));
        this.glow.add(
          place(new RoundedBoxGeometry(0.03, 0.12, 0.01, 1, 0.004), [
            lh.x,
            lh.y - r - 0.12,
            lh.z + 0.155,
          ]),
          SURF.glow(this.accent),
          this.rigid('LeftHand'),
        );
        inHand(
          'RightHand',
          place(new CylinderGeometry(0.02, 0.024, 0.6, 8), [0, 0, 0.28], [Math.PI / 2, 0, 0]),
          grip,
        );
        inHand('RightHand', ellipsoid([0, 0, 0.6], [0.07, 0.07, 0.09], [8, 6]), metal);
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          inHand(
            'RightHand',
            place(
              new RoundedBoxGeometry(0.02, 0.06, 0.14, 1, 0.006),
              [Math.sin(a) * 0.075, Math.cos(a) * 0.075, 0.6],
              [0, 0, -a],
            ),
            metal,
          );
        }
        socket('rightBase', 'RightHand', [0, -r, 0.15]);
        socket('rightTip', 'RightHand', [0, -r, 0.68]);
        mirrorSockets();
        break;
      }
      case 'staff': {
        tilt = 0.2;
        const pts: Vector3[] = [];
        for (let i = 0; i <= 8; i++) {
          const z = -0.38 + (i / 8) * 1.48;
          pts.push(new Vector3(Math.sin(i * 1.7) * 0.012, Math.cos(i * 1.3) * 0.012, z));
        }
        inHand(
          'RightHand',
          new TubeGeometry(new CatmullRomCurve3(pts), 24, 0.022, 6, false),
          SURF.leather(this.def.weaponColor),
        );
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * Math.PI * 2;
          inHand(
            'RightHand',
            place(
              new ConeGeometry(0.012, 0.16, 5),
              [Math.sin(a) * 0.05, Math.cos(a) * 0.05, 1.14],
              [Math.PI / 2 - 0.4 * Math.cos(a), 0, 0.4 * Math.sin(a)],
            ),
            SURF.bone(this.L.trim),
          );
        }
        inHand(
          'RightHand',
          ellipsoid([0, 0, 1.15], [0.07, 0.07, 0.07], [10, 8]),
          SURF.glow(this.L.rim),
          true,
        );
        socket('rightBase', 'RightHand', [0, -r, 0.9]);
        socket('rightTip', 'RightHand', [0, -r, 1.15]);
        mirrorSockets();
        break;
      }
      case 'claws': {
        for (const side of ['Left', 'Right'] as const) {
          const b = this.J[`${side}Hand`];
          for (let i = -1; i <= 1; i++) {
            const g = place(
              new ConeGeometry(0.016, 0.17, 5),
              [b.x + i * 0.028, b.y - r * 2.3, b.z + 0.035],
              [0.45, 0, 0],
            );
            this.body.add(g, SURF.bone(this.def.weaponColor), this.rigid(`${side}Hand`));
          }
        }
        this.sockets.rightBase = { bone: 'RightHand', offset: new Vector3(0, -r * 2, 0.02) };
        this.sockets.rightTip = { bone: 'RightHand', offset: new Vector3(0, -r * 3.2, 0.1) };
        this.sockets.leftBase = { bone: 'LeftHand', offset: new Vector3(0, -r * 2, 0.02) };
        this.sockets.leftTip = { bone: 'LeftHand', offset: new Vector3(0, -r * 3.2, 0.1) };
        break;
      }
      case 'club': {
        tilt = 0.6;
        const g = limb(0, 0, 0, -0.78, (k) => [0.03 + 0.04 * k * k, 0.03 + 0.04 * k * k], 7, 9);
        g.rotateX(-Math.PI / 2);
        inHand('RightHand', g, SURF.leather(this.def.weaponColor));
        for (let k = 0; k < 7; k++) {
          const a = k * 2.4;
          const z = 0.5 + (k % 3) * 0.09;
          inHand(
            'RightHand',
            place(
              new ConeGeometry(0.012, 0.07, 5),
              [Math.sin(a) * 0.06, Math.cos(a) * 0.06, z],
              [Math.cos(a) * 1.3, 0, -Math.sin(a) * 1.3],
            ),
            SURF.steel(this.L.metal),
          );
        }
        socket('rightBase', 'RightHand', [0, -r, 0.15]);
        socket('rightTip', 'RightHand', [0, -r, 0.8]);
        mirrorSockets();
        break;
      }
      case 'none':
        break;
    }
  }
}

// ------------------------------------------------------------------ helpers

const SURF = {
  cloth: (color: number): Surf => ({ color, rough: 0.9, metal: 0 }),
  leather: (color: number): Surf => ({ color, rough: 0.6, metal: 0.04 }),
  skin: (color: number): Surf => ({ color, rough: 0.62, metal: 0 }),
  fur: (color: number): Surf => ({ color, rough: 1, metal: 0 }),
  bone: (color: number): Surf => ({ color, rough: 0.5, metal: 0.05 }),
  plate: (color: number): Surf => ({ color, rough: 0.36, metal: 0.85 }),
  steel: (color: number): Surf => ({ color, rough: 0.22, metal: 0.95 }),
  gold: (color: number): Surf => ({ color, rough: 0.32, metal: 0.92 }),
  glow: (color: number): Surf => ({ color, rough: 1, metal: 0 }),
  void: { color: 0x040305, rough: 1, metal: 0 } as Surf,
};

function darken(hex: number, k: number): number {
  const r = Math.round(((hex >> 16) & 255) * k);
  const g = Math.round(((hex >> 8) & 255) * k);
  const b = Math.round((hex & 255) * k);
  return (r << 16) | (g << 8) | b;
}

/** Bevelled blade along +Z from `guardZ`: `len` long, `width` tall (edges up/down), tip from `tipFrac`. */
function blade(
  len: number,
  width: number,
  thick: number,
  tipFrac: number,
  guardZ: number,
): BufferGeometry {
  const s = new Shape();
  const w = width / 2;
  const tipStart = len * (1 - tipFrac);
  s.moveTo(-w, 0);
  s.lineTo(w, 0);
  s.lineTo(w * 0.92, tipStart);
  s.quadraticCurveTo(w * 0.7, tipStart + (len - tipStart) * 0.6, 0, len);
  s.quadraticCurveTo(-w * 0.85, tipStart + (len - tipStart) * 0.4, -w * 0.96, tipStart);
  s.lineTo(-w, 0);
  const g = new ExtrudeGeometry(s, {
    depth: thick,
    bevelEnabled: true,
    bevelThickness: thick * 0.6,
    bevelSize: Math.min(w * 0.45, 0.012),
    bevelSegments: 1,
    curveSegments: 6,
  });
  g.translate(0, guardZ, -thick / 2);
  // Shape width → Y, shape length → Z, extrusion (thickness) → X.
  g.applyMatrix4(new Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
  return g;
}

/** Orients a hanging panel (top edge at origin, hanging −Y) so −Y follows `dir`, at `top`. */
function orientPanel(g: BufferGeometry, top: Vector3, dir: Vector3): BufferGeometry {
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, -1, 0), dir);
  g.applyQuaternion(q);
  g.translate(top.x, top.y, top.z);
  return g;
}

/** Outfit for rigs that only set the older look flags. */
function legacyOutfit(def: RigDef): RigOutfit {
  return {
    ...DEFAULT_OUTFIT,
    head: def.look.hood ? 'hood' : 'bare',
    armor: def.look.pauldrons ? 'plate' : 'leather',
  };
}
