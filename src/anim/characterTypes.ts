import type { Bone, Group, MeshStandardMaterial, SkinnedMesh, Vector3 } from 'three';
import type { PlayOptions } from './AnimationController';
import type { SocketName } from './rigBuilder';

/** Bones every body exposes under these names (body dynamics, head look-at). */
export type CoreBone = 'Spine' | 'Chest' | 'Head';

/**
 * What actors, VFX and modes need from a character body: humanoid rigs (heroes, most enemies)
 * and creature rigs (spiders, beasts, wyrms) both implement it.
 */
export interface CharacterRig {
  readonly root: Group;
  readonly mesh: SkinnedMesh;
  readonly material: MeshStandardMaterial;
  readonly def: { readonly scale: number };
  /** Standing height in metres (camera framing). */
  readonly height: number;
  bone(name: CoreBone): Bone;
  /** World position of a weapon / claw / jaw socket (weapon trails). */
  socketWorld(name: SocketName, out: Vector3): Vector3;
  setFlash(intensity: number, color?: number): void;
  setWeaponFx(on: boolean): void;
  setGlowIntensity(v: number): void;
  setVisible(v: boolean): void;
  /**
   * Burn-away dissolve (0 = whole, 1 = gone): deaths crumble into embers, spawns form out of
   * ash. Uniform-only, never recompiles a shader.
   */
  setDissolve(amount: number, edgeColor?: number): void;
  updateSecondary(dtSec: number, forward: number, right: number, turnRate: number): void;
  resetSecondary(): void;
  dispose(): void;
}

/** What actors need from an animation player (clip-based or procedural). */
export interface CharacterAnimator {
  readonly playing: string;
  readonly normalizedTime: number;
  has(name: string): boolean;
  /** Natural length of a clip in seconds (0 when unknown or procedural). */
  clipDuration(name: string): number;
  /** True once a non-looping current clip has played to its end. */
  readonly finished: boolean;
  play(name: string, opts?: PlayOptions): void;
  react(name: string, strength?: number, durationSec?: number): void;
  setPaused(paused: boolean): void;
  setLookBone(bone: Bone | null): void;
  setLookYaw(relativeYaw: number): void;
  onEvent(clip: string, at: number, fn: () => void): void;
  update(dtSec: number): void;
  stopAll(): void;
  dispose(): void;
}
