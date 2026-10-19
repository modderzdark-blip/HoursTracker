import {
  Bone,
  BoxGeometry,
  BufferAttribute,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Group,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { RigDef, RigProportions } from '../data/rigs';
import { applyRimLight } from '../render/rimLight';

/** Mixamo-style bone names (Mixamo exports prefix them with "mixamorig"; the loader strips it). */
export const BONE_NAMES = [
  'Root',
  'Hips',
  'Spine',
  'Chest',
  'Neck',
  'Head',
  'LeftArm',
  'LeftForeArm',
  'LeftHand',
  'RightArm',
  'RightForeArm',
  'RightHand',
  'LeftUpLeg',
  'LeftLeg',
  'RightUpLeg',
  'RightLeg',
] as const;
export type BoneName = (typeof BONE_NAMES)[number];

/** Extra bone (not animated by clips) used to show/hide weapon FX geometry by scaling it. */
const FX_BONE = 'WeaponFX';

export type SocketName = 'rightBase' | 'rightTip' | 'leftBase' | 'leftTip';

interface BoneSpec {
  readonly name: BoneName | typeof FX_BONE;
  readonly parent: BoneName | null;
  readonly pos: (p: RigProportions) => [number, number, number];
}

const BONE_SPECS: readonly BoneSpec[] = [
  { name: 'Root', parent: null, pos: () => [0, 0, 0] },
  { name: 'Hips', parent: 'Root', pos: (p) => [0, p.hipsY, 0] },
  { name: 'Spine', parent: 'Hips', pos: () => [0, 0.08, 0] },
  { name: 'Chest', parent: 'Spine', pos: (p) => [0, p.spineLen, 0] },
  { name: 'Neck', parent: 'Chest', pos: (p) => [0, p.chestLen, 0] },
  { name: 'Head', parent: 'Neck', pos: (p) => [0, p.neckLen, 0] },
  { name: 'LeftArm', parent: 'Chest', pos: (p) => [p.shoulderX, p.chestLen * 0.86, 0] },
  { name: 'LeftForeArm', parent: 'LeftArm', pos: (p) => [0, -p.upperArm, 0] },
  { name: 'LeftHand', parent: 'LeftForeArm', pos: (p) => [0, -p.foreArm, 0] },
  { name: 'RightArm', parent: 'Chest', pos: (p) => [-p.shoulderX, p.chestLen * 0.86, 0] },
  { name: 'RightForeArm', parent: 'RightArm', pos: (p) => [0, -p.upperArm, 0] },
  { name: 'RightHand', parent: 'RightForeArm', pos: (p) => [0, -p.foreArm, 0] },
  { name: 'LeftUpLeg', parent: 'Hips', pos: (p) => [p.hipX, -0.04, 0] },
  { name: 'LeftLeg', parent: 'LeftUpLeg', pos: (p) => [0, -p.thigh, 0] },
  { name: 'RightUpLeg', parent: 'Hips', pos: (p) => [-p.hipX, -0.04, 0] },
  { name: 'RightLeg', parent: 'RightUpLeg', pos: (p) => [0, -p.thigh, 0] },
];
// FX bone hangs off the right hand; its parent is resolved separately (it isn't a BoneName).
const FX_SPEC = {
  name: FX_BONE,
  parent: 'RightHand' as BoneName,
  pos: (): [number, number, number] => [0, 0, 0],
};

interface RigTemplate {
  readonly geometry: BufferGeometry;
  readonly glowGeometry: BufferGeometry;
  readonly sockets: Readonly<Record<SocketName, { bone: BoneName; offset: Vector3 }>>;
  readonly boneCount: number;
}

const templateCache = new Map<string, RigTemplate>();

/** Accumulated bind-pose position of a bone (bind rotations are identity, so it's a sum). */
function bindPosition(name: BoneName, p: RigProportions): Vector3 {
  const v = new Vector3();
  let spec: BoneSpec | undefined = BONE_SPECS.find((b) => b.name === name);
  while (spec !== undefined) {
    const [x, y, z] = spec.pos(p);
    v.x += x;
    v.y += y;
    v.z += z;
    const parent = spec.parent;
    spec = parent === null ? undefined : BONE_SPECS.find((b) => b.name === parent);
  }
  return v;
}

function boneIndexOf(name: string): number {
  if (name === FX_BONE) return BONE_SPECS.length;
  return BONE_SPECS.findIndex((b) => b.name === name);
}

class PartBuilder {
  readonly parts: BufferGeometry[] = [];
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly s = new Vector3();
  private readonly t = new Vector3();
  private readonly e = new Euler();
  private readonly c = new Color();

  constructor(private readonly p: RigProportions) {}

  /**
   * Adds a part rigidly bound to `bone`. `offset` is in the bone's local (bind) frame.
   * Rotation is XYZ Euler in radians applied to the part before placing it.
   */
  add(
    geo: BufferGeometry,
    bone: BoneName,
    color: number,
    offset: [number, number, number] = [0, 0, 0],
    rot: [number, number, number] = [0, 0, 0],
    scale: [number, number, number] = [1, 1, 1],
    boneOverride?: string,
  ): void {
    const g = geo;
    const base = bindPosition(bone, this.p);
    this.e.set(rot[0], rot[1], rot[2]);
    this.q.setFromEuler(this.e);
    this.s.set(scale[0], scale[1], scale[2]);
    this.t.set(base.x + offset[0], base.y + offset[1], base.z + offset[2]);
    this.m.compose(this.t, this.q, this.s);
    g.applyMatrix4(this.m);
    const n = g.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    this.c.setHex(color);
    // Vertex colours live in linear space inside the shader; convert from sRGB hex.
    this.c.convertSRGBToLinear();
    for (let i = 0; i < n; i++) {
      colors[i * 3] = this.c.r;
      colors[i * 3 + 1] = this.c.g;
      colors[i * 3 + 2] = this.c.b;
    }
    g.setAttribute('color', new BufferAttribute(colors, 3));
    const idx = new Uint16Array(n * 4);
    const w = new Float32Array(n * 4);
    const bi = boneIndexOf(boneOverride ?? bone);
    for (let i = 0; i < n; i++) {
      idx[i * 4] = bi;
      w[i * 4] = 1;
    }
    g.setAttribute('skinIndex', new BufferAttribute(idx, 4));
    g.setAttribute('skinWeight', new BufferAttribute(w, 4));
    if (g.getAttribute('uv') === undefined) {
      g.setAttribute('uv', new BufferAttribute(new Float32Array(n * 2), 2));
    }
    this.parts.push(g);
  }
}

function buildTemplate(def: RigDef): RigTemplate {
  const p = def.proportions;
  const L = def.look;
  const body = new PartBuilder(p);
  const glow = new PartBuilder(p);
  const r = p.limbRadius;
  const t = p.torsoRadius;
  const cap = (radius: number, length: number): CapsuleGeometry =>
    new CapsuleGeometry(radius, Math.max(0.001, length), 3, 8);

  // Torso.
  body.add(cap(t * 0.95, 0.06), 'Hips', L.body, [0, 0.02, 0], [0, 0, Math.PI / 2], [1, 1.05, 0.8]);
  body.add(
    cap(t * 0.9, p.spineLen * 0.6),
    'Spine',
    L.body,
    [0, p.spineLen * 0.5, 0],
    [0, 0, 0],
    [1.05, 1, 0.75],
  );
  body.add(
    cap(t, p.chestLen * 0.55),
    'Chest',
    L.body,
    [0, p.chestLen * 0.5, 0],
    [0, 0, 0],
    [p.chestWidth, 1, 0.78],
  );
  // Belt.
  body.add(
    new CylinderGeometry(t * 1.02, t * 1.02, 0.06, 12),
    'Spine',
    L.trim,
    [0, 0.0, 0],
    [0, 0, 0],
    [1.05, 1, 0.82],
  );
  // Neck + head.
  body.add(cap(r * 0.9, p.neckLen * 0.6), 'Neck', L.skin, [0, p.neckLen * 0.4, 0]);
  body.add(
    new SphereGeometry(p.headRadius, 12, 9),
    'Head',
    L.skin,
    [0, p.headRadius * 0.9, 0],
    [0, 0, 0],
    [0.92, 1, 1],
  );
  if (L.hood) {
    body.add(
      new SphereGeometry(p.headRadius * 1.18, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62),
      'Head',
      L.body,
      [0, p.headRadius * 1.0, -0.015],
      [-0.25, 0, 0],
    );
  }
  if (L.horns) {
    for (const side of [1, -1]) {
      body.add(
        new ConeGeometry(p.headRadius * 0.28, p.headRadius * 1.2, 6),
        'Head',
        L.trim,
        [side * p.headRadius * 0.7, p.headRadius * 1.5, -0.02],
        [-0.35, 0, -side * 0.5],
      );
    }
  }
  // Eyes (unlit glow mesh).
  if (L.eyes !== 0) {
    for (const side of [1, -1]) {
      // Pushed out of the head sphere so the glow reads from the front at any distance.
      glow.add(new SphereGeometry(p.headRadius * 0.2, 6, 5), 'Head', L.eyes, [
        side * p.headRadius * 0.36,
        p.headRadius * 1.0,
        p.headRadius * 0.98,
      ]);
    }
  }
  if (L.wings === true) {
    for (const side of [1, -1]) {
      body.add(
        new BoxGeometry(1.25, 0.04, 0.55),
        'Chest',
        L.trim,
        [side * 0.62, p.chestLen * 0.85, -0.2],
        [0, side * -0.35, side * 0.45],
      );
      body.add(
        new BoxGeometry(0.95, 0.035, 0.45),
        'Chest',
        L.body,
        [side * 1.28, p.chestLen * 1.25, -0.42],
        [0, side * -0.6, side * 0.75],
      );
      glow.add(
        new BoxGeometry(1.9, 0.03, 0.04),
        'Chest',
        L.rim,
        [side * 0.95, p.chestLen * 1.05, -0.08],
        [0, side * -0.45, side * 0.55],
      );
    }
  }
  if (L.extraArms === true) {
    for (const side of [1, -1]) {
      for (const k of [0, 1]) {
        const y = p.chestLen * (0.15 + k * 0.3);
        body.add(
          cap(r * 1.05, p.upperArm * 1.1),
          'Chest',
          L.skin,
          [side * (p.shoulderX + 0.18), y, -0.05 - k * 0.04],
          [0.4 - k * 0.6, 0, side * (1.2 + k * 0.25)],
        );
        body.add(
          new ConeGeometry(r * 0.9, p.foreArm * 0.7, 5),
          'Chest',
          L.trim,
          [side * (p.shoulderX + 0.48), y - 0.12, 0.05 - k * 0.08],
          [Math.PI, 0, side * 0.5],
        );
      }
    }
  }
  // Arms.
  for (const side of ['Left', 'Right'] as const) {
    const sx = side === 'Left' ? 1 : -1;
    body.add(cap(r, p.upperArm * 0.75), `${side}Arm`, L.body, [0, -p.upperArm * 0.5, 0]);
    body.add(cap(r * 0.9, p.foreArm * 0.75), `${side}ForeArm`, L.skin, [0, -p.foreArm * 0.5, 0]);
    body.add(new BoxGeometry(r * 1.7, r * 2.2, r * 1.9), `${side}Hand`, L.skin, [
      0,
      -r * 0.9,
      0.01,
    ]);
    // Bracer.
    body.add(
      new CylinderGeometry(r * 1.15, r * 1.25, p.foreArm * 0.35, 8),
      `${side}ForeArm`,
      L.trim,
      [0, -p.foreArm * 0.65, 0],
    );
    if (L.pauldrons) {
      body.add(
        new SphereGeometry(r * 2.4, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55),
        `${side}Arm`,
        L.trim,
        [sx * r * 0.4, r * 0.8, 0],
        [0, 0, -sx * 0.35],
      );
    }
  }
  // Legs.
  for (const side of ['Left', 'Right'] as const) {
    body.add(cap(r * 1.25, p.thigh * 0.75), `${side}UpLeg`, L.body, [0, -p.thigh * 0.5, 0]);
    body.add(cap(r * 1.05, p.shin * 0.75), `${side}Leg`, L.body, [0, -p.shin * 0.5, 0]);
    body.add(new BoxGeometry(r * 2.1, r * 1.4, r * 4.2), `${side}Leg`, L.trim, [
      0,
      -p.shin - r * 0.2,
      r * 1.2,
    ]);
  }

  // Weapons + sockets (blade base/tip in hand-local coordinates, used for trails).
  const sockets: Record<SocketName, { bone: BoneName; offset: Vector3 }> = {
    rightBase: { bone: 'RightHand', offset: new Vector3(0, -r, 0.08) },
    rightTip: { bone: 'RightHand', offset: new Vector3(0, -r, 0.5) },
    leftBase: { bone: 'LeftHand', offset: new Vector3(0, -r, 0.08) },
    leftTip: { bone: 'LeftHand', offset: new Vector3(0, -r, 0.5) },
  };
  const metal = def.weaponColor;
  // Weapons are angled forward-down in the grip (rotation about the wrist's X axis) so guard
  // stances, which raise the forearm ~90°, hold the blade forward instead of straight up.
  let tilt = 0;
  const rotX = (v: [number, number, number]): [number, number, number] => [
    v[0],
    v[1] * Math.cos(tilt) - v[2] * Math.sin(tilt),
    v[1] * Math.sin(tilt) + v[2] * Math.cos(tilt),
  ];
  const at = (v: [number, number, number]): [number, number, number] => rotX(v);
  const tiltRot = (x = 0): [number, number, number] => [x + tilt, 0, 0];
  const socket = (name: SocketName, v: [number, number, number]): void => {
    const [x, y, z] = rotX(v);
    sockets[name].offset.set(x, y, z);
  };
  switch (def.weapon) {
    case 'dualBlades': {
      tilt = 0.75;
      for (const side of ['Left', 'Right'] as const) {
        const hand = `${side}Hand` as const;
        body.add(new BoxGeometry(0.03, 0.06, 0.72), hand, metal, at([0, -r, 0.44]), tiltRot());
        body.add(new BoxGeometry(0.15, 0.03, 0.04), hand, L.trim, at([0, -r, 0.07]), tiltRot());
      }
      socket('rightBase', [0, -r, 0.12]);
      socket('rightTip', [0, -r, 0.8]);
      socket('leftBase', [0, -r, 0.12]);
      socket('leftTip', [0, -r, 0.8]);
      break;
    }
    case 'greatsword': {
      tilt = 0.55;
      body.add(new BoxGeometry(0.05, 0.16, 1.45), 'RightHand', metal, at([0, -r, 0.88]), tiltRot());
      body.add(
        new BoxGeometry(0.34, 0.05, 0.07),
        'RightHand',
        L.trim,
        at([0, -r, 0.13]),
        tiltRot(),
      );
      body.add(
        new CylinderGeometry(0.03, 0.03, 0.22, 6),
        'RightHand',
        L.trim,
        at([0, -r, -0.02]),
        tiltRot(Math.PI / 2),
      );
      // Flame edge (hidden until phase 2 by scaling the FX bone).
      glow.add(
        new BoxGeometry(0.07, 0.22, 1.5),
        'RightHand',
        0xff6a1a,
        at([0, -r, 0.88]),
        tiltRot(),
        [1, 1, 1],
        FX_BONE,
      );
      socket('rightBase', [0, -r, 0.2]);
      socket('rightTip', [0, -r, 1.6]);
      sockets.leftBase.offset.copy(sockets.rightBase.offset);
      sockets.leftTip.offset.copy(sockets.rightTip.offset);
      sockets.leftBase.bone = 'RightHand';
      sockets.leftTip.bone = 'RightHand';
      break;
    }
    case 'bowDagger': {
      // Bow in the left hand: an arc whose grip is the fist, limbs along the hand's Z axis.
      const R = 0.55;
      const A = Math.PI * 0.85;
      const bow = new TorusGeometry(R, 0.022, 4, 16, A);
      bow.rotateZ(-Math.PI / 2 - A / 2);
      bow.translate(0, R, 0);
      body.add(bow, 'LeftHand', def.weaponColor, [0, -r, 0], [0, Math.PI / 2, 0]);
      body.add(new BoxGeometry(0.008, 0.008, 2 * R * Math.sin(A / 2)), 'LeftHand', 0xd8d0c0, [
        0,
        R * (1 - Math.cos(A / 2)) - r,
        0,
      ]);
      // Dagger in the right hand.
      tilt = 0.6;
      body.add(
        new BoxGeometry(0.03, 0.05, 0.42),
        'RightHand',
        0xc9ccd6,
        at([0, -r, 0.3]),
        tiltRot(),
      );
      body.add(
        new BoxGeometry(0.12, 0.03, 0.04),
        'RightHand',
        L.trim,
        at([0, -r, 0.07]),
        tiltRot(),
      );
      socket('rightBase', [0, -r, 0.1]);
      socket('rightTip', [0, -r, 0.52]);
      sockets.leftBase.offset.copy(sockets.rightBase.offset);
      sockets.leftTip.offset.copy(sockets.rightTip.offset);
      sockets.leftBase.bone = 'RightHand';
      sockets.leftTip.bone = 'RightHand';
      break;
    }
    case 'shieldMace': {
      tilt = 0.6;
      body.add(new BoxGeometry(0.46, 0.62, 0.05), 'LeftHand', L.trim, [0, -r - 0.06, 0.1]);
      body.add(new BoxGeometry(0.32, 0.44, 0.06), 'LeftHand', metal, [0, -r - 0.06, 0.13]);
      body.add(
        new CylinderGeometry(0.035, 0.03, 0.6, 6),
        'RightHand',
        L.trim,
        at([0, -r, 0.3]),
        tiltRot(Math.PI / 2),
      );
      body.add(new SphereGeometry(0.1, 8, 6), 'RightHand', metal, at([0, -r, 0.62]));
      socket('rightBase', [0, -r, 0.15]);
      socket('rightTip', [0, -r, 0.68]);
      sockets.leftBase.offset.copy(sockets.rightBase.offset);
      sockets.leftTip.offset.copy(sockets.rightTip.offset);
      sockets.leftBase.bone = 'RightHand';
      sockets.leftTip.bone = 'RightHand';
      break;
    }
    case 'staff': {
      tilt = 0.2;
      body.add(
        new CylinderGeometry(0.025, 0.03, 1.5, 6),
        'RightHand',
        metal,
        at([0, -r, 0.35]),
        tiltRot(Math.PI / 2),
      );
      glow.add(new SphereGeometry(0.09, 8, 6), 'RightHand', L.rim, at([0, -r, 1.12]));
      socket('rightBase', [0, -r, 0.9]);
      socket('rightTip', [0, -r, 1.15]);
      sockets.leftBase.offset.copy(sockets.rightBase.offset);
      sockets.leftTip.offset.copy(sockets.rightTip.offset);
      sockets.leftBase.bone = 'RightHand';
      sockets.leftTip.bone = 'RightHand';
      break;
    }
    case 'claws': {
      for (const side of ['Left', 'Right'] as const) {
        for (let i = -1; i <= 1; i++) {
          body.add(
            new ConeGeometry(0.018, 0.16, 4),
            `${side}Hand`,
            metal,
            [i * 0.03, -r * 2.2, 0.03],
            [0.4, 0, 0],
          );
        }
      }
      sockets.rightBase.offset.set(0, -r * 2, 0.02);
      sockets.rightTip.offset.set(0, -r * 3.2, 0.1);
      sockets.leftBase.offset.set(0, -r * 2, 0.02);
      sockets.leftTip.offset.set(0, -r * 3.2, 0.1);
      break;
    }
    case 'club': {
      tilt = 0.6;
      body.add(
        new CylinderGeometry(0.06, 0.035, 0.75, 7),
        'RightHand',
        metal,
        at([0, -r, 0.38]),
        tiltRot(Math.PI / 2),
      );
      body.add(
        new BoxGeometry(0.13, 0.13, 0.2),
        'RightHand',
        L.metal,
        at([0, -r, 0.72]),
        tiltRot(),
      );
      socket('rightBase', [0, -r, 0.15]);
      socket('rightTip', [0, -r, 0.8]);
      sockets.leftBase.offset.copy(sockets.rightBase.offset);
      sockets.leftTip.offset.copy(sockets.rightTip.offset);
      sockets.leftBase.bone = 'RightHand';
      sockets.leftTip.bone = 'RightHand';
      break;
    }
    case 'none':
      break;
  }
  if (glow.parts.length === 0) {
    // Keep a degenerate part so the glow mesh is always valid.
    glow.add(new BoxGeometry(0.0001, 0.0001, 0.0001), 'Head', 0x000000);
  }

  const geometry = mergeGeometries(body.parts, false);
  const glowGeometry = mergeGeometries(glow.parts, false);
  for (const g of [...body.parts, ...glow.parts]) g.dispose();
  return { geometry, glowGeometry, sockets, boneCount: BONE_SPECS.length + 1 };
}

function getTemplate(def: RigDef): RigTemplate {
  let t = templateCache.get(def.id);
  if (t === undefined) {
    t = buildTemplate(def);
    templateCache.set(def.id, t);
  }
  return t;
}

/** Frees cached rig geometry (call when no rig of that type will be created again). */
export function disposeRigTemplates(): void {
  for (const t of templateCache.values()) {
    t.geometry.dispose();
    t.glowGeometry.dispose();
  }
  templateCache.clear();
}

/**
 * One instance of a placeholder character: a skinned body mesh + an unlit glow mesh (eyes,
 * weapon flames) sharing one skeleton. Geometry is shared per rig type; materials and bones are
 * per instance (hit flash, telegraph glow, independent animation).
 */
export class HumanoidRig {
  readonly root = new Group();
  readonly mesh: SkinnedMesh;
  readonly glow: SkinnedMesh;
  readonly skeleton: Skeleton;
  readonly bones = new Map<string, Bone>();
  readonly material: MeshStandardMaterial;
  readonly glowMaterial: MeshBasicMaterial;
  private readonly template: RigTemplate;
  private readonly fxBone: Bone;
  private readonly flashColor = new Color();
  private readonly baseGlow = new Color(1, 1, 1);

  constructor(
    readonly def: RigDef,
    /** Translucent shadow-clone look (ultimate VFX). */
    ghost = false,
  ) {
    this.template = getTemplate(def);
    const p = def.proportions;
    const boneList: Bone[] = [];
    for (const spec of [...BONE_SPECS, FX_SPEC]) {
      const b = new Bone();
      b.name = spec.name;
      const [x, y, z] = spec.pos(p);
      b.position.set(x, y, z);
      boneList.push(b);
      this.bones.set(spec.name, b);
      if (spec.parent !== null) this.bones.get(spec.parent)?.add(b);
    }
    const rootBone = boneList[0];
    const fx = this.bones.get(FX_BONE);
    if (rootBone === undefined || fx === undefined) throw new Error('rig bones missing');
    this.fxBone = fx;
    this.skeleton = new Skeleton(boneList);

    this.material = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.58,
      metalness: 0.25,
    });
    if (ghost) {
      this.material.transparent = true;
      this.material.opacity = 0.6;
      this.material.depthWrite = false;
      this.material.color.setRGB(0.35, 0.22, 0.6);
      this.material.emissive.setRGB(0.25, 0.08, 0.45);
      applyRimLight(this.material, 0xb070ff, 2.0, 1.4);
    } else {
      applyRimLight(this.material, def.look.rim, 3.0, 0.45);
    }
    this.glowMaterial = new MeshBasicMaterial({ vertexColors: true, color: this.baseGlow });
    this.glowMaterial.color.setScalar(2.2);

    this.mesh = new SkinnedMesh(this.template.geometry, this.material);
    this.mesh.add(rootBone);
    this.mesh.castShadow = !ghost;
    this.mesh.name = `rig:${def.id}`;
    this.glow = new SkinnedMesh(this.template.glowGeometry, this.glowMaterial);
    this.glow.castShadow = false;
    this.root.add(this.mesh, this.glow);
    this.root.scale.setScalar(def.scale);
    this.root.updateMatrixWorld(true);
    this.mesh.bind(this.skeleton);
    this.glow.bind(this.skeleton, this.mesh.bindMatrix);
    // Bounding spheres from the bind pose, enlarged to cover animated poses.
    this.mesh.computeBoundingSphere();
    this.mesh.boundingSphere.radius *= 1.7;
    this.glow.computeBoundingSphere();
    this.glow.boundingSphere.copy(this.mesh.boundingSphere);
    this.setWeaponFx(false);
  }

  bone(name: BoneName): Bone {
    const b = this.bones.get(name);
    if (b === undefined) throw new Error(`bone ${name} missing`);
    return b;
  }

  /** World position of a weapon socket (blade base / tip). Writes into `out`. */
  socketWorld(name: SocketName, out: Vector3): Vector3 {
    const s = this.template.sockets[name];
    const b = this.bone(s.bone);
    out.copy(s.offset);
    return b.localToWorld(out);
  }

  /** Emissive flash on the body (hit flash = white, telegraph = red). intensity 0..1. */
  setFlash(intensity: number, color = 0xffffff): void {
    this.flashColor.setHex(color);
    this.material.emissive.copy(this.flashColor).multiplyScalar(Math.max(0, intensity));
  }

  setWeaponFx(on: boolean): void {
    this.fxBone.scale.setScalar(on ? 1 : 0.0001);
  }

  setGlowIntensity(v: number): void {
    this.glowMaterial.color.setScalar(v);
  }

  setVisible(v: boolean): void {
    this.root.visible = v;
  }

  dispose(): void {
    this.material.dispose();
    this.glowMaterial.dispose();
    this.skeleton.dispose();
    this.root.removeFromParent();
  }
}
