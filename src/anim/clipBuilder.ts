import {
  AnimationClip,
  Euler,
  Quaternion,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
} from 'three';
import { BONE_NAMES } from './skeletonDef';
import { blendPose, type Pose } from './poses';

/**
 * How a segment travels from the previous key to this one. Quaternion tracks only interpolate
 * linearly, so non-linear segments are baked into a few in-between keys.
 * - `in`: starts slow, ends fast (falling, the last part of a wind-up).
 * - `out`: starts fast, settles (recoveries, landing).
 * - `inOut`: slow → fast → slow (weight shifts, breathing).
 * - `snap`: most of the motion in the first fifth (strikes: the blade arrives almost at once).
 * - `back`: overshoots slightly past the key, then settles onto it (follow-through on a stop).
 */
export type Ease = 'linear' | 'in' | 'out' | 'inOut' | 'snap' | 'back';

export interface ClipKey {
  /** Normalised time 0..1. */
  readonly t: number;
  readonly pose: Pose;
  /** Easing of the segment arriving at this key (default linear). */
  readonly ease?: Ease;
}

const DEG = Math.PI / 180;
const ANIMATED_BONES = BONE_NAMES.filter((b) => b !== 'Root');
/** In-between keys baked per eased segment. */
const EASE_STEPS = 4;

export function easeValue(ease: Ease, u: number): number {
  const x = Math.min(1, Math.max(0, u));
  switch (ease) {
    case 'linear':
      return x;
    case 'in':
      return x * x * x;
    case 'out':
      return 1 - (1 - x) * (1 - x) * (1 - x);
    case 'inOut':
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    case 'snap':
      return 1 - Math.pow(1 - x, 5);
    case 'back': {
      const c = 1.6;
      return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
    }
  }
}

/** Expands eased segments into linear in-between keys (pose blends in Euler space). */
export function expandKeys(keys: readonly ClipKey[]): ClipKey[] {
  const out: ClipKey[] = [];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (k === undefined) continue;
    const prev = keys[i - 1];
    const ease = k.ease ?? 'linear';
    if (prev !== undefined && ease !== 'linear' && k.t - prev.t > 1e-4) {
      for (let s = 1; s < EASE_STEPS; s++) {
        const u = s / EASE_STEPS;
        out.push({
          t: prev.t + (k.t - prev.t) * u,
          pose: blendPose(prev.pose, k.pose, easeValue(ease, u)),
        });
      }
    }
    out.push({ t: k.t, pose: k.pose });
  }
  return out;
}

/**
 * Builds a THREE.AnimationClip from pose keyframes. Every clip animates every bone (unspecified
 * bones = rest) so crossfades never leave stale rotations behind, plus Root.position for
 * crouch/jump/lying offsets. Quaternion signs are kept continuous so slerp takes the short arc.
 */
export function buildPoseClip(
  name: string,
  durationSec: number,
  rawKeys: readonly ClipKey[],
): AnimationClip {
  if (rawKeys.length === 0) throw new Error(`clip ${name} has no keys`);
  const keys = expandKeys(rawKeys);
  const times = keys.map((k) => Math.min(Math.max(k.t, 0), 1) * durationSec);
  // Keyframe times must not decrease (rounding can make neighbours equal; that is allowed).
  for (let i = 1; i < times.length; i++) {
    const prev = times[i - 1] ?? 0;
    if ((times[i] ?? 0) < prev) times[i] = prev;
  }
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
  ease: Ease = 'linear',
): AnimationClip {
  const keys: ClipKey[] = [
    { t: 0, pose: from },
    { t: 1 - holdFrac, pose: to, ease },
  ];
  if (holdFrac > 0) keys.push({ t: 1, pose: to });
  return buildPoseClip(name, durationSec, keys);
}

/** True when every track value is finite and the times never decrease (unit tests, debug). */
export function clipIsValid(clip: AnimationClip): boolean {
  if (!Number.isFinite(clip.duration) || clip.duration <= 0) return false;
  for (const tr of clip.tracks) {
    for (let i = 0; i < tr.times.length; i++) {
      const t = tr.times[i] ?? NaN;
      if (!Number.isFinite(t) || t < 0 || t > clip.duration + 1e-6) return false;
      if (i > 0 && t < (tr.times[i - 1] ?? 0)) return false;
    }
    for (let i = 0; i < tr.values.length; i++) if (!Number.isFinite(tr.values[i])) return false;
  }
  return true;
}
