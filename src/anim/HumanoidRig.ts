import type { MeshDepthMaterial, Vector3 } from 'three';
import {
  Bone,
  Color,
  Euler,
  Group,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  Skeleton,
  SkinnedMesh,
} from 'three';
import { CHARACTER_CONFIG } from '../data/config';
import type { RigDef } from '../data/rigs';
import { getCharacterEnvironment } from '../render/characterEnv';
import {
  applyDissolve,
  createDissolveUniforms,
  setDissolveEdge,
  type DissolveUniforms,
} from '../render/dissolve';
import { applyCharacterShading } from '../render/rimLight';
import { buildRigTemplate, type ChainSpec, type RigTemplate, type SocketName } from './rigBuilder';
import { BONE_SPECS, FX_BONE, type BoneName } from './skeletonDef';

export { BONE_NAMES, type BoneName } from './skeletonDef';
export type { SocketName } from './rigBuilder';

const templateCache = new Map<string, RigTemplate>();

function getTemplate(def: RigDef): RigTemplate {
  let t = templateCache.get(def.id);
  if (t === undefined) {
    t = buildRigTemplate(def);
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

/** Spring parameters per chain kind: stiffness, damping, how much motion swings it. */
const CHAIN_TUNING: Readonly<
  Record<ChainSpec['kind'], { k: number; c: number; swing: number; flutter: number }>
> = {
  cape: { k: 55, c: 7, swing: 0.11, flutter: 0.05 },
  scarf: { k: 40, c: 5, swing: 0.13, flutter: 0.09 },
  tabardFront: { k: 90, c: 10, swing: 0.03, flutter: 0.02 },
  tabardBack: { k: 80, c: 9, swing: 0.06, flutter: 0.03 },
  tail: { k: 30, c: 4, swing: 0.03, flutter: 0.22 },
  wing: { k: 35, c: 5, swing: 0.02, flutter: 0.3 },
};

interface ChainState {
  readonly spec: ChainSpec;
  readonly bones: Bone[];
  readonly pitch: Float32Array;
  readonly pitchV: Float32Array;
  readonly roll: Float32Array;
  readonly rollV: Float32Array;
}

const SUBSTEP = 1 / 120;

const tmpQ = new Quaternion();
const tmpE = new Euler();

/**
 * One instance of a procedural character: a skinned body mesh + an unlit glow mesh (eyes,
 * visors, runes, weapon flames) sharing one skeleton. Geometry is shared per rig type;
 * materials and bones are per instance (hit flash, telegraph glow, independent animation).
 * Cloth, tails and wings hang on extra bones that springs drive after the animation each frame.
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
  private readonly chains: ChainState[] = [];
  private readonly dissolve: DissolveUniforms;
  private readonly depthMaterial: MeshDepthMaterial;
  private time = Math.random() * 10;

  /** Standing height in metres (proportions are built for ~1.9 m at scale 1). */
  get height(): number {
    return 1.9 * this.def.scale;
  }

  constructor(
    readonly def: RigDef,
    /** Translucent shadow-clone look (ultimate VFX). */
    ghost = false,
  ) {
    this.template = getTemplate(def);
    const p = def.proportions;
    const boneList: Bone[] = [];
    const make = (
      name: string,
      pos: readonly [number, number, number],
      parent: string | null,
    ): void => {
      const b = new Bone();
      b.name = name;
      b.position.set(pos[0], pos[1], pos[2]);
      boneList.push(b);
      this.bones.set(name, b);
      if (parent !== null) this.bones.get(parent)?.add(b);
    };
    for (const spec of BONE_SPECS) make(spec.name, spec.pos(p), spec.parent);
    make(FX_BONE, [0, 0, 0], 'RightHand');
    for (const e of this.template.extraBones) make(e.name, e.pos, e.parent);
    const rootBone = boneList[0];
    const fx = this.bones.get(FX_BONE);
    if (rootBone === undefined || fx === undefined) throw new Error('rig bones missing');
    this.fxBone = fx;
    this.skeleton = new Skeleton(boneList);
    for (const spec of this.template.chains) {
      const n = spec.bones.length;
      this.chains.push({
        spec,
        bones: spec.bones.map((b) => this.bone2(b)),
        pitch: new Float32Array(n),
        pitchV: new Float32Array(n),
        roll: new Float32Array(n),
        rollV: new Float32Array(n),
      });
    }

    this.material = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1 });
    const env = getCharacterEnvironment();
    if (env !== null) {
      this.material.envMap = env;
      this.material.envMapIntensity = CHARACTER_CONFIG.envIntensity;
    }
    if (ghost) {
      this.material.transparent = true;
      this.material.opacity = 0.6;
      this.material.depthWrite = false;
      this.material.color.setRGB(0.35, 0.22, 0.6);
      this.material.emissive.setRGB(0.25, 0.08, 0.45);
      applyCharacterShading(this.material, 0xb070ff, 2.0, 1.4);
    } else {
      applyCharacterShading(
        this.material,
        def.look.rim,
        CHARACTER_CONFIG.rimPower,
        CHARACTER_CONFIG.rimStrength,
        CHARACTER_CONFIG.cameraFill,
      );
    }
    this.glowMaterial = new MeshBasicMaterial({ vertexColors: true, color: this.baseGlow });
    this.glowMaterial.color.setScalar(2.2);
    this.dissolve = createDissolveUniforms(1.95);
    this.depthMaterial = applyDissolve(this.material, this.glowMaterial, this.dissolve);

    this.mesh = new SkinnedMesh(this.template.geometry, this.material);
    this.mesh.customDepthMaterial = this.depthMaterial;
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
    // Bounding spheres from the bind pose, enlarged to cover animated poses, capes and wings.
    this.mesh.computeBoundingSphere();
    this.mesh.boundingSphere.radius *= 1.8;
    this.glow.computeBoundingSphere();
    this.glow.boundingSphere.copy(this.mesh.boundingSphere);
    this.setWeaponFx(false);
  }

  private bone2(name: string): Bone {
    const b = this.bones.get(name);
    if (b === undefined) throw new Error(`bone ${name} missing`);
    return b;
  }

  bone(name: BoneName): Bone {
    return this.bone2(name);
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

  setDissolve(amount: number, edgeColor?: number): void {
    this.dissolve.uDissolve.value = Math.min(1, Math.max(0, amount));
    if (edgeColor !== undefined) setDissolveEdge(this.dissolve, edgeColor);
  }

  /** Puts every cloth / tail / wing bone back at rest (after teleports). */
  resetSecondary(): void {
    for (const c of this.chains) {
      c.pitch.fill(0);
      c.pitchV.fill(0);
      c.roll.fill(0);
      c.rollV.fill(0);
      for (const b of c.bones) b.quaternion.identity();
    }
  }

  /**
   * Drives cloth, tails and wings with springs. Call after the animation update.
   * @param forward speed along the facing (m/s, + = forward)
   * @param right speed to the character's right (m/s)
   * @param turnRate yaw rate (rad/s, + = turning left)
   */
  updateSecondary(dtSec: number, forward: number, right: number, turnRate: number): void {
    if (dtSec <= 0 || this.chains.length === 0) return;
    const dt = Math.min(dtSec, 0.1);
    this.time += dt;
    // Torso and thigh angles from the current pose (bind rotations are identity, so the
    // product of local rotations is the orientation relative to the rig root).
    tmpQ.copy(this.bone('Hips').quaternion);
    tmpE.setFromQuaternion(tmpQ, 'XYZ');
    const hipsPitch = tmpE.x;
    tmpQ.multiply(this.bone('Spine').quaternion).multiply(this.bone('Chest').quaternion);
    tmpE.setFromQuaternion(tmpQ, 'XYZ');
    const chestPitch = tmpE.x;
    tmpE.setFromQuaternion(this.bone('LeftUpLeg').quaternion, 'XYZ');
    const legL = tmpE.x + hipsPitch;
    tmpE.setFromQuaternion(this.bone('RightUpLeg').quaternion, 'XYZ');
    const legR = tmpE.x + hipsPitch;
    const legBack = Math.max(0, legL, legR);
    const legFwd = Math.min(0, legL, legR);
    const speed = Math.hypot(forward, right);
    const sp = Math.min(speed, 9);
    const time = this.time;

    for (const c of this.chains) {
      const tune = CHAIN_TUNING[c.spec.kind];
      const n = c.bones.length;
      for (let i = 0; i < n; i++) {
        const k = (i + 1) / n;
        const flutter = Math.sin(time * (5 + i * 1.3) + i * 0.9) * tune.flutter * (0.25 + sp / 8);
        let pt = 0;
        let rt = 0;
        switch (c.spec.kind) {
          case 'cape':
          case 'scarf': {
            // Hang with gravity (undo the chest's lean on the root), stream back with speed,
            // swing out to the side when strafing or turning, clear the legs.
            const stream = Math.min(1.1, Math.max(-0.25, forward * tune.swing)) * (0.6 + 0.4 * k);
            pt = (i === 0 ? 0.06 - chestPitch : 0.04) + stream + flutter;
            if (i > 0) pt = Math.max(pt, legBack * 0.45);
            rt = Math.max(-0.5, Math.min(0.5, right * 0.06 + turnRate * 0.05)) * k;
            if (c.spec.kind === 'scarf') rt += c.spec.side * 0.12;
            break;
          }
          case 'tabardFront':
            pt =
              (i === 0 ? -hipsPitch : 0) +
              legFwd * 0.85 +
              Math.max(0, forward) * 0.015 +
              flutter * 0.5;
            break;
          case 'tabardBack':
            pt =
              (i === 0 ? -hipsPitch : 0) +
              legBack * 0.85 +
              Math.max(0, forward) * tune.swing +
              flutter * 0.5;
            break;
          case 'tail':
            pt = -0.12 + Math.max(0, forward) * 0.03 + Math.sin(time * 1.7 + i) * 0.08;
            rt = Math.sin(time * 2.1 - i * 0.8) * tune.flutter + turnRate * 0.08;
            break;
          case 'wing': {
            // Slow beats; the second joint lags behind the first.
            const beat = Math.sin(time * (2.4 + sp * 0.1) - i * 0.9);
            rt = -c.spec.side * (beat * tune.flutter * (1 + sp * 0.05) + 0.1);
            pt = 0.05 + forward * 0.02;
            break;
          }
        }
        let t = dt;
        const kk = tune.k * (1 - 0.25 * k);
        while (t > 1e-6) {
          const h = Math.min(SUBSTEP, t);
          const pv =
            (c.pitchV[i] ?? 0) + (kk * (pt - (c.pitch[i] ?? 0)) - tune.c * (c.pitchV[i] ?? 0)) * h;
          c.pitchV[i] = pv;
          c.pitch[i] = (c.pitch[i] ?? 0) + pv * h;
          const rv =
            (c.rollV[i] ?? 0) + (kk * (rt - (c.roll[i] ?? 0)) - tune.c * (c.rollV[i] ?? 0)) * h;
          c.rollV[i] = rv;
          c.roll[i] = (c.roll[i] ?? 0) + rv * h;
          t -= h;
        }
        const b = c.bones[i];
        if (b !== undefined) {
          tmpE.set(c.pitch[i] ?? 0, 0, c.roll[i] ?? 0, 'XYZ');
          b.quaternion.setFromEuler(tmpE);
        }
      }
    }
  }

  dispose(): void {
    this.material.dispose();
    this.glowMaterial.dispose();
    this.depthMaterial.dispose();
    this.skeleton.dispose();
    this.root.removeFromParent();
  }
}
