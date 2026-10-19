import {
  AnimationClip,
  Euler,
  Quaternion,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
} from 'three';
import { BONE_NAMES } from './skeletonDef';
import type { Pose } from './poses';

export interface ClipKey {
  /** Normalised time 0..1. */
  readonly t: number;
  readonly pose: Pose;
}

const DEG = Math.PI / 180;
const ANIMATED_BONES = BONE_NAMES.filter((b) => b !== 'Root');

/**
 * Builds a THREE.AnimationClip from pose keyframes. Every clip animates every bone (unspecified
 * bones = rest) so crossfades never leave stale rotations behind, plus Root.position for
 * crouch/jump/lying offsets. Quaternion signs are kept continuous so slerp takes the short arc.
 */
export function buildPoseClip(
  name: string,
  durationSec: number,
  keys: readonly ClipKey[],
): AnimationClip {
  if (keys.length === 0) throw new Error(`clip ${name} has no keys`);
  const times = keys.map((k) => Math.min(Math.max(k.t, 0), 1) * durationSec);
  const e = new Euler();
  const q = new Quaternion();
  const prev = new Quaternion();
  const tracks = [];
  for (const bone of ANIMATED_BONES) {
    const values: number[] = [];
    keys.forEach((k, i) => {
      const r = k.pose.r[bone] ?? [0, 0, 0];
      e.set(r[0] * DEG, r[1] * DEG, r[2] * DEG, 'XYZ');
      q.setFromEuler(e);
      if (i > 0 && q.dot(prev) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      prev.copy(q);
      values.push(q.x, q.y, q.z, q.w);
    });
    tracks.push(new QuaternionKeyframeTrack(`${bone}.quaternion`, times, values));
  }
  const rootValues: number[] = [];
  for (const k of keys) {
    const r = k.pose.root ?? [0, 0, 0];
    rootValues.push(r[0], r[1], r[2]);
  }
  tracks.push(new VectorKeyframeTrack('Root.position', times, rootValues));
  return new AnimationClip(name, durationSec, tracks);
}

/** Two-key clip blending from one pose to another (telegraph wind-ups, strikes, recoveries). */
export function transitionClip(
  name: string,
  durationSec: number,
  from: Pose,
  to: Pose,
  holdFrac = 0,
): AnimationClip {
  const keys: ClipKey[] = [
    { t: 0, pose: from },
    { t: 1 - holdFrac, pose: to },
  ];
  if (holdFrac > 0) keys.push({ t: 1, pose: to });
  return buildPoseClip(name, durationSec, keys);
}
