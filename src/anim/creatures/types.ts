import type { Vector3 } from 'three';
import type { CreatureDef, CreatureMotion } from '../../data/creatures';
import type { SkinBuilder } from '../meshKit';
import type { SocketName } from '../rigBuilder';
import type { CoreBone } from '../characterTypes';

/** What a creature is doing (from the clip name the AI asked for). */
export type CreatureMode =
  | 'idle'
  | 'run'
  | 'tele'
  | 'strike'
  | 'stagger'
  | 'death'
  | 'roar'
  | 'spawn'
  | 'knockdown'
  | 'getup';

export interface PoseInput {
  readonly mode: CreatureMode;
  /** Motion of the current attack (tele / strike). */
  readonly motion: CreatureMotion | null;
  /** Progress through the current clip, 0..1. */
  readonly t: number;
  /** Seconds since creation (idle breathing, sway). */
  readonly time: number;
  /** Gait cycle position, 0..1 (advances while running). */
  readonly gait: number;
  /** 0 standing → 1 full speed (blends gait amplitude). */
  readonly moving: number;
  /** Head yaw toward the target (radians, relative to the body). */
  readonly look: number;
}

/** Euler XYZ angles (radians) per bone; bones not listed rest at identity. */
export type PoseOut = Map<string, [number, number, number]>;

export interface PlanBone {
  readonly name: string;
  readonly parent: string | null;
  /** Bind position relative to the parent (body-plan units, before the creature scale). */
  readonly pos: readonly [number, number, number];
}

/** A body plan: skeleton, mesh, sockets and procedural animation. */
export interface CreaturePlan {
  readonly bones: readonly PlanBone[];
  /** Plan bones standing in for Spine / Chest / Head. */
  readonly core: Readonly<Record<CoreBone, string>>;
  /** Bone whose position is lifted / lowered by the pose (body bob, crouch, death sink). */
  readonly bodyBone: string;
  readonly sockets: Readonly<Record<SocketName, { bone: string; offset: Vector3 }>>;
  build(
    def: CreatureDef,
    body: SkinBuilder,
    glow: SkinBuilder,
    bi: (bone: string) => number,
    bind: (bone: string) => Vector3,
  ): void;
  /** Writes bone rotations into `out` and returns the body bone's vertical offset (plan units). */
  pose(inp: PoseInput, out: PoseOut): number;
}
