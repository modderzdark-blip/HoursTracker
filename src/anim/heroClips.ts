import type { AnimationClip } from 'three';
import { buildPoseClip, type ClipKey } from './clipBuilder';
import {
  CROUCH,
  FIST_READY,
  HEX_HIT,
  JAB_HIT,
  PALM_HIT,
  PALM_WIND,
  PUNCH_R_HIT,
  REAP_HIT,
  ROUNDHOUSE,
  SCYTHE_RAISE,
  SHIELD_SLAM_HIT,
  SHIELD_SLAM_WIND,
  SPEAR_IMPALE,
  SPEAR_RAISE,
  SPEAR_SWEEP_HIT,
  STAFF_CAST_HIT,
  STAFF_RAISE,
  pose,
  type Pose,
} from './poses';

/** `base` turned around the hips `turns` times between two clip fractions. */
function spin(
  base: Pose,
  fromFrac: number,
  toFrac: number,
  turns: number,
  startDeg = 0,
): ClipKey[] {
  const keys: ClipKey[] = [];
  const steps = Math.max(1, Math.round(turns * 3));
  for (let i = 0; i <= steps; i++) {
    const t = fromFrac + ((toFrac - fromFrac) * i) / steps;
    keys.push({ t, pose: pose(base, { Hips: [0, startDeg + (360 * turns * i) / steps, 0] }) });
  }
  return keys;
}

/** Alternating poses `a`/`b` struck `n` times between two clip fractions. */
function flurry(a: Pose, b: Pose, fromFrac: number, toFrac: number, n: number): ClipKey[] {
  const keys: ClipKey[] = [];
  for (let i = 0; i < n; i++) {
    keys.push({ t: fromFrac + ((toFrac - fromFrac) * (i + 0.5)) / n, pose: i % 2 === 0 ? a : b });
  }
  return keys;
}

/**
 * Clips for the hero kits that need more than a wind-up → strike transition (leaps, spins,
 * flurries, channelled ultimates). `s` / `a` are the clip fractions where the startup and the
 * active phase end. Returns null for names it does not know.
 */
export function buildHeroClip(
  name: string,
  total: number,
  s: number,
  a: number,
  idle: Pose,
): AnimationClip | null {
  switch (name) {
    case 'garrick_ult':
      // Crouch, vault high with the shield raised, crash it into the ground.
      return buildPoseClip(name, total, [
        { t: 0, pose: idle },
        { t: s * 0.3, pose: pose(CROUCH, {}, [0, -0.35, 0]), ease: 'inOut' },
        { t: s * 0.75, pose: pose(SHIELD_SLAM_WIND, {}, [0, 1.6, 0]), ease: 'out' },
        { t: s, pose: pose(SHIELD_SLAM_WIND, {}, [0, 1.0, 0]), ease: 'in' },
        { t: s + (a - s) * 0.25, pose: SHIELD_SLAM_HIT, ease: 'in' },
        { t: a + (1 - a) * 0.5, pose: SHIELD_SLAM_HIT, ease: 'out' },
        { t: 1, pose: idle, ease: 'inOut' },
      ]);
    case 'seraphine_ult':
      // Staff raised, pumping it skyward with every falling star.
      return buildPoseClip(name, total, [
        { t: 0, pose: idle },
        { t: s, pose: STAFF_RAISE },
        ...flurry(pose(STAFF_RAISE, {}, [0, 0.06, 0]), STAFF_RAISE, s, a, 7),
        { t: a, pose: STAFF_CAST_HIT },
        { t: 1, pose: idle },
      ]);
    case 'ryn_spin':
      return buildPoseClip(name, total, [
        { t: 0, pose: idle },
        ...spin(ROUNDHOUSE, s, a, 1, -30),
        { t: 1, pose: idle },
      ]);
    case 'ryn_cyclone':
      return buildPoseClip(name, total, [
        { t: 0, pose: idle },
        ...spin(pose(ROUNDHOUSE, {}, [0, 0.12, 0]), s, a, 3),
        { t: 1, pose: idle },
      ]);
    case 'ryn_ult':
      // A blur of alternating straight punches, then a two-palm blast.
      return buildPoseClip(name, total, [
        { t: 0, pose: idle },
        { t: s, pose: FIST_READY },
        ...flurry(JAB_HIT, PUNCH_R_HIT, s, s + (a - s) * 0.92, 16),
        { t: s + (a - s) * 0.94, pose: PALM_WIND },
        { t: a, pose: PALM_HIT },
        { t: a + (1 - a) * 0.5, pose: PALM_HIT },
        { t: 1, pose: idle },
      ]);
    case 'valka_dive':
      // Spring up with the spear raised, drop onto the target point-first.
      return buildPoseClip(name, total, [
        { t: 0, pose: idle },
        { t: s * 0.18, pose: pose(CROUCH, {}, [0, -0.3, 0]), ease: 'inOut' },
        { t: s * 0.6, pose: pose(SPEAR_RAISE, {}, [0, 1.8, 0]), ease: 'out' },
        { t: s * 0.85, pose: pose(SPEAR_IMPALE, {}, [0, 0.9, 0]), ease: 'in' },
        { t: s, pose: SPEAR_IMPALE, ease: 'in' },
        { t: a + (1 - a) * 0.5, pose: SPEAR_IMPALE, ease: 'out' },
        { t: 1, pose: idle, ease: 'inOut' },
      ]);
    case 'valka_wheel':
      return buildPoseClip(name, total, [
        { t: 0, pose: idle },
        ...spin(SPEAR_SWEEP_HIT, s, a, 2),
        { t: 1, pose: idle },
      ]);
    case 'valka_ult':
      // Spear raised to the storm, a lance falling with each pump, then driven into the ground.
      return buildPoseClip(name, total, [
        { t: 0, pose: idle },
        { t: s * 0.5, pose: pose(SPEAR_RAISE, {}, [0, 0.4, 0]) },
        { t: s, pose: SPEAR_RAISE },
        ...flurry(pose(SPEAR_RAISE, {}, [0, 0.08, 0]), SPEAR_RAISE, s, s + (a - s) * 0.85, 6),
        { t: s + (a - s) * 0.94, pose: SPEAR_IMPALE },
        { t: a + (1 - a) * 0.5, pose: SPEAR_IMPALE },
        { t: 1, pose: idle },
      ]);
    case 'morrow_spin':
      return buildPoseClip(name, total, [
        { t: 0, pose: idle },
        ...spin(REAP_HIT, s, a, 1, -40),
        { t: 1, pose: idle },
      ]);
    case 'morrow_ult':
      // Rise with the scythe raised while graves split open, then reap down.
      return buildPoseClip(name, total, [
        { t: 0, pose: idle },
        { t: s, pose: pose(SCYTHE_RAISE, {}, [0, 0.3, 0]) },
        ...flurry(pose(SCYTHE_RAISE, {}, [0, 0.4, 0]), HEX_HIT, s, s + (a - s) * 0.8, 5),
        { t: s + (a - s) * 0.86, pose: pose(SCYTHE_RAISE, {}, [0, 0.35, 0]) },
        { t: a, pose: REAP_HIT },
        { t: 1, pose: idle },
      ]);
    default:
      return null;
  }
}
