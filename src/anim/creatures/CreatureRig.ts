import {
  AdditiveBlending,
  Bone,
  Color,
  Euler,
  Group,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  Vector3,
  type BufferGeometry,
  type MeshDepthMaterial,
} from 'three';
import { CHARACTER_CONFIG } from '../../data/config';
import type { CreatureDef } from '../../data/creatures';
import { getCharacterEnvironment } from '../../render/characterEnv';
import {
  applyDissolve,
  createDissolveUniforms,
  setDissolveEdge,
  type DissolveUniforms,
} from '../../render/dissolve';
import { applyCharacterShading } from '../../render/rimLight';
import type { CharacterRig, CoreBone } from '../characterTypes';
import { SkinBuilder } from '../meshKit';
import type { SocketName } from '../rigBuilder';
import { batPlan } from './bat';
import { beastPlan } from './beast';
import { spiderPlan } from './spider';
import type { CreaturePlan } from './types';
import { wispPlan } from './wisp';
import { wyrmPlan } from './wyrm';

const tmpQ = new Quaternion();
const tmpE = new Euler();

export function planFor(def: CreatureDef): CreaturePlan {
  switch (def.plan) {
    case 'spider':
      return spiderPlan;
    case 'beast':
      return beastPlan;
    case 'wyrm':
      return wyrmPlan;
    case 'wisp':
      return wispPlan;
    case 'bat':
      return batPlan;
  }
}

interface Template {
  readonly geometry: BufferGeometry;
  readonly glowGeometry: BufferGeometry;
}

const cache = new Map<string, Template>();

function template(def: CreatureDef, plan: CreaturePlan): Template {
  const hit = cache.get(def.id);
  if (hit !== undefined) return hit;
  const names = plan.bones.map((b) => b.name);
  const bindCache = new Map<string, Vector3>();
  const bind = (name: string): Vector3 => {
    const c = bindCache.get(name);
    if (c !== undefined) return c.clone();
    const v = new Vector3();
    let b = plan.bones.find((x) => x.name === name);
    while (b !== undefined) {
      v.x += b.pos[0];
      v.y += b.pos[1];
      v.z += b.pos[2];
      const parent = b.parent;
      b = parent === null ? undefined : plan.bones.find((x) => x.name === parent);
    }
    bindCache.set(name, v.clone());
    return v;
  };
  const bi = (name: string): number => {
    const i = names.indexOf(name);
    if (i < 0) throw new Error(`creature ${def.id}: unknown bone ${name}`);
    return i;
  };
  const body = new SkinBuilder(true, CHARACTER_CONFIG.albedoLift);
  const glow = new SkinBuilder(false);
  plan.build(def, body, glow, bi, bind);
  const t = { geometry: body.build(), glowGeometry: glow.build() };
  cache.set(def.id, t);
  return t;
}

/**
 * A creature body (spider, beast, wyrm): one skinned mesh + one glow mesh on the plan's own
 * skeleton, posed by CreatureAnimator. Same interface as the humanoid rig, so actors, AI,
 * weapon trails and VFX treat both alike.
 */
export class CreatureRig implements CharacterRig {
  readonly root = new Group();
  readonly mesh: SkinnedMesh;
  readonly glow: SkinnedMesh;
  readonly material: MeshStandardMaterial;
  readonly glowMaterial: MeshBasicMaterial;
  readonly skeleton: Skeleton;
  readonly bones = new Map<string, Bone>();
  readonly plan: CreaturePlan;
  readonly height: number;
  private readonly flashColor = new Color();
  private readonly tailBones: Bone[];
  private bank = 0;
  private bankV = 0;
  private swing = 0;
  private swingV = 0;
  private lift = 0;
  private readonly dissolve: DissolveUniforms;
  private readonly depthMaterial: MeshDepthMaterial;

  constructor(readonly def: CreatureDef) {
    this.plan = planFor(def);
    const t = template(def, this.plan);
    const list: Bone[] = [];
    for (const spec of this.plan.bones) {
      const b = new Bone();
      b.name = spec.name;
      b.position.set(spec.pos[0], spec.pos[1], spec.pos[2]);
      list.push(b);
      this.bones.set(spec.name, b);
      if (spec.parent !== null) this.bones.get(spec.parent)?.add(b);
    }
    const rootBone = list[0];
    if (rootBone === undefined) throw new Error('creature has no bones');
    this.skeleton = new Skeleton(list);
    this.tailBones = (this.plan.tail ?? [])
      .map((n) => this.bones.get(n))
      .filter((b): b is Bone => b !== undefined);
    this.material = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1 });
    const env = getCharacterEnvironment();
    if (env !== null) {
      this.material.envMap = env;
      this.material.envMapIntensity = CHARACTER_CONFIG.envIntensity;
    }
    applyCharacterShading(
      this.material,
      def.colors.rim,
      CHARACTER_CONFIG.rimPower,
      CHARACTER_CONFIG.rimStrength,
      CHARACTER_CONFIG.cameraFill,
    );
    this.glowMaterial = new MeshBasicMaterial({ vertexColors: true });
    if (this.plan.additiveGlow === true) {
      this.glowMaterial.blending = AdditiveBlending;
      this.glowMaterial.transparent = true;
      this.glowMaterial.depthWrite = false;
    }
    this.glowMaterial.color.setScalar(2.2);
    t.geometry.computeBoundingBox();
    this.dissolve = createDissolveUniforms(t.geometry.boundingBox?.max.y ?? 1);
    this.depthMaterial = applyDissolve(this.material, this.glowMaterial, this.dissolve);
    this.mesh = new SkinnedMesh(t.geometry, this.material);
    this.mesh.customDepthMaterial = this.depthMaterial;
    this.mesh.add(rootBone);
    this.mesh.castShadow = true;
    this.mesh.name = `creature:${def.id}`;
    this.glow = new SkinnedMesh(t.glowGeometry, this.glowMaterial);
    this.root.add(this.mesh, this.glow);
    this.root.scale.setScalar(def.scale);
    this.root.updateMatrixWorld(true);
    this.mesh.bind(this.skeleton);
    this.glow.bind(this.skeleton, this.mesh.bindMatrix);
    this.height = (t.geometry.boundingBox?.max.y ?? 1) * def.scale;
    this.mesh.computeBoundingSphere();
    this.mesh.boundingSphere.radius *= 1.6;
    this.glow.computeBoundingSphere();
    this.glow.boundingSphere.copy(this.mesh.boundingSphere);
  }

  bone(name: CoreBone): Bone {
    const b = this.bones.get(this.plan.core[name]);
    if (b === undefined) throw new Error(`creature bone ${name} missing`);
    return b;
  }

  socketWorld(name: SocketName, out: Vector3): Vector3 {
    const s = this.plan.sockets[name];
    const b = this.bones.get(s.bone);
    out.copy(s.offset);
    return b === undefined ? out : b.localToWorld(out);
  }

  setFlash(intensity: number, color = 0xffffff): void {
    this.flashColor.setHex(color);
    this.material.emissive.copy(this.flashColor).multiplyScalar(Math.max(0, intensity));
  }

  /** Phase "weapon FX" on creatures: the glowing markings flare. */
  setWeaponFx(on: boolean): void {
    this.glowMaterial.color.setScalar(on ? 3.2 : 2.2);
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

  /**
   * Weight on top of the procedural pose: the body banks into turns, the tail (or abdomen,
   * tendrils) swings out against the turn and streams back with speed, on springs.
   * Call after the animator update (it rewrites the bones every frame, so nothing accumulates).
   */
  updateSecondary(dtSec: number, forward: number, _right: number, turnRate: number): void {
    if (dtSec <= 0) return;
    const dt = Math.min(dtSec, 0.1);
    const bankTarget = Math.max(
      -0.22,
      Math.min(0.22, -turnRate * Math.min(6, Math.abs(forward) + 1) * 0.012),
    );
    const swingTarget = Math.max(-0.5, Math.min(0.5, turnRate * 0.09));
    const liftTarget = Math.max(-0.2, Math.min(0.25, forward * 0.03));
    let t = dt;
    while (t > 1e-6) {
      const h = Math.min(1 / 120, t);
      this.bankV += (60 * (bankTarget - this.bank) - 10 * this.bankV) * h;
      this.bank += this.bankV * h;
      this.swingV += (32 * (swingTarget - this.swing) - 5 * this.swingV) * h;
      this.swing += this.swingV * h;
      this.lift += (liftTarget - this.lift) * Math.min(1, h * 4);
      t -= h;
    }
    if (Math.abs(this.bank) > 1e-4) {
      const spine = this.bones.get(this.plan.core.Spine);
      if (spine !== undefined) {
        tmpQ.setFromEuler(tmpE.set(0, 0, this.bank));
        spine.quaternion.premultiply(tmpQ);
      }
    }
    const tail = this.tailBones;
    for (let i = 0; i < tail.length; i++) {
      const b = tail[i];
      if (b === undefined) continue;
      // Later segments lag more: the swing travels down the chain.
      const k = (i + 1) / tail.length;
      tmpQ.setFromEuler(tmpE.set(-this.lift * (0.5 + 0.5 * k), this.swing * (0.6 + 0.8 * k), 0));
      b.quaternion.multiply(tmpQ);
    }
  }

  resetSecondary(): void {
    this.bank = this.bankV = this.swing = this.swingV = this.lift = 0;
  }

  dispose(): void {
    this.material.dispose();
    this.glowMaterial.dispose();
    this.depthMaterial.dispose();
    this.skeleton.dispose();
    this.root.removeFromParent();
  }
}
