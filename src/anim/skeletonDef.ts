import { Vector3 } from 'three';
import type { RigProportions } from '../data/rigs';

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
export const FX_BONE = 'WeaponFX';

export interface BoneSpec {
  readonly name: BoneName;
  readonly parent: BoneName | null;
  readonly pos: (p: RigProportions) => [number, number, number];
}

/** Bind pose: every bone has identity rotation; positions are offsets from the parent. */
export const BONE_SPECS: readonly BoneSpec[] = [
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

/** Accumulated bind-pose position of a bone (bind rotations are identity, so it's a sum). */
export function bindPosition(name: BoneName, p: RigProportions): Vector3 {
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
