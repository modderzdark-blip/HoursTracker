import {
  Bone,
  Color,
  Group,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Skeleton,
  SkinnedMesh,
  Vector3,
  type BufferGeometry,
} from 'three';
import { CHARACTER_CONFIG } from '../../data/config';
import type { CreatureDef } from '../../data/creatures';
import { getCharacterEnvironment } from '../../render/characterEnv';
import { applyCharacterShading } from '../../render/rimLight';
import type { CharacterRig, CoreBone } from '../characterTypes';
import { SkinBuilder } from '../meshKit';
import type { SocketName } from '../rigBuilder';
import { beastPlan } from './beast';
import { spiderPlan } from './spider';
import type { CreaturePlan } from './types';
import { wyrmPlan } from './wyrm';

export function planFor(def: CreatureDef): CreaturePlan {
  switch (def.plan) {
    case 'spider':
      return spiderPlan;
    case 'beast':
      return beastPlan;
    case 'wyrm':
      return wyrmPlan;
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
    this.glowMaterial.color.setScalar(2.2);
    this.mesh = new SkinnedMesh(t.geometry, this.material);
    this.mesh.add(rootBone);
    this.mesh.castShadow = true;
    this.mesh.name = `creature:${def.id}`;
    this.glow = new SkinnedMesh(t.glowGeometry, this.glowMaterial);
    this.root.add(this.mesh, this.glow);
    this.root.scale.setScalar(def.scale);
    this.root.updateMatrixWorld(true);
    this.mesh.bind(this.skeleton);
    this.glow.bind(this.skeleton, this.mesh.bindMatrix);
    t.geometry.computeBoundingBox();
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

  updateSecondary(): void {
    // Tails, wings and legs are animated procedurally by CreatureAnimator.
  }

  resetSecondary(): void {
    // Nothing to reset: CreatureAnimator rewrites every bone each frame.
  }

  dispose(): void {
    this.material.dispose();
    this.glowMaterial.dispose();
    this.skeleton.dispose();
    this.root.removeFromParent();
  }
}
