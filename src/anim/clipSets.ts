import type { AnimationClip } from 'three';
import type { ActionDef } from '../data/combatTypes';
import type { EnemyAttackDef } from '../data/enemies';
import { buildPoseClip, transitionClip, type ClipKey } from './clipBuilder';
import {
  ARMS_WIDE,
  CROSS_HIT,
  CROSS_WIND,
  CROUCH,
  LYING,
  OVERHEAD_HIT,
  OVERHEAD_WIND,
  POSE_LIBRARY,
  ROAR,
  STAGGERED,
  STRIDE_A,
  STRIDE_PASS,
  mirror,
  pose,
  type Pose,
} from './poses';

const ZERO: Pose = { r: {}, root: [0, 0, 0] };

/** Shared clips for every humanoid: idle, run, hurt (additive), knockdown, getup, death, stagger, spawn, roar. */
export function buildHumanoidClips(idle: Pose): {
  clips: AnimationClip[];
  additive: AnimationClip[];
} {
  const breathe = pose(idle, { Chest: [(idle.r.Chest?.[0] ?? 0) + 3, 0, 0] }, [
    0,
    (idle.root?.[1] ?? 0) - 0.012,
    0,
  ]);
  const runA = pose(STRIDE_A, { Spine: [(idle.r.Spine?.[0] ?? 0) + 8, 0, 0] });
  const runB = mirror(runA);
  const lean = pose(
    idle,
    { Spine: [-25, 0, 0], Chest: [-10, 0, 0], Head: [-15, 0, 0] },
    [0, -0.05, 0],
  );
  const clips = [
    buildPoseClip('idle', 2.4, [
      { t: 0, pose: idle },
      { t: 0.5, pose: breathe },
      { t: 1, pose: idle },
    ]),
    buildPoseClip('run', 0.72, [
      { t: 0, pose: runA },
      { t: 0.25, pose: STRIDE_PASS },
      { t: 0.5, pose: runB },
      { t: 0.75, pose: STRIDE_PASS },
      { t: 1, pose: runA },
    ]),
    buildPoseClip('knockdown', 1, [
      { t: 0, pose: idle },
      { t: 0.15, pose: lean },
      { t: 0.42, pose: LYING },
      { t: 1, pose: LYING },
    ]),
    buildPoseClip('getup', 1, [
      { t: 0, pose: LYING },
      { t: 0.55, pose: CROUCH },
      { t: 1, pose: idle },
    ]),
    buildPoseClip('death', 1, [
      { t: 0, pose: idle },
      { t: 0.2, pose: STAGGERED },
      { t: 0.55, pose: LYING },
      { t: 1, pose: LYING },
    ]),
    buildPoseClip('stagger', 1.2, [
      { t: 0, pose: STAGGERED },
      { t: 0.5, pose: pose(STAGGERED, { Chest: [10, 12, 0] }) },
      { t: 1, pose: STAGGERED },
    ]),
    buildPoseClip('spawn', 1, [
      { t: 0, pose: pose(CROUCH, {}, [0, -2.1, 0]) },
      { t: 0.7, pose: CROUCH },
      { t: 1, pose: idle },
    ]),
    buildPoseClip('roar', 1, [
      { t: 0, pose: idle },
      { t: 0.25, pose: ROAR },
      { t: 0.8, pose: ROAR },
      { t: 1, pose: idle },
    ]),
  ];
  const additive = [
    buildPoseClip('hurt', 0.32, [
      { t: 0, pose: ZERO },
      { t: 0.3, pose: { r: { Spine: [-18, 0, 0], Chest: [-10, 0, 0], Head: [-16, 0, 0] } } },
      { t: 1, pose: ZERO },
    ]),
  ];
  return { clips, additive };
}

/** Whole-action clip (startup → active → recovery) aligned to the action's timing data. */
export function buildActionClip(def: ActionDef, idle: Pose, speed = 1): AnimationClip {
  const total = (def.startupMs + def.activeMs + def.recoveryMs) / speed;
  const startupFrac = def.startupMs / speed / total;
  const activeEndFrac = (def.startupMs + def.activeMs) / speed / total;
  const holdFrac = activeEndFrac + (1 - activeEndFrac) * 0.4;
  const wind = POSE_LIBRARY[def.windPose];
  const hit = POSE_LIBRARY[def.hitPose];
  return buildPoseClip(def.id, total / 1000, [
    { t: 0, pose: idle },
    { t: startupFrac, pose: wind },
    { t: activeEndFrac, pose: hit },
    { t: holdFrac, pose: hit },
    { t: 1, pose: idle },
  ]);
}

function spinKeys(
  base: Pose,
  fromFrac: number,
  toFrac: number,
  turns: number,
  startDeg: number,
): ClipKey[] {
  const keys: ClipKey[] = [];
  const steps = Math.max(1, Math.round(turns * 3));
  for (let i = 0; i <= steps; i++) {
    const t = fromFrac + ((toFrac - fromFrac) * i) / steps;
    keys.push({ t, pose: pose(base, { Hips: [0, startDeg + (360 * turns * i) / steps, 0] }) });
  }
  return keys;
}

/** Spin clips and other actions that need more than a wind/hit transition. */
export function buildCustomActionClip(name: string, def: ActionDef, idle: Pose): AnimationClip {
  const total = (def.startupMs + def.activeMs + def.recoveryMs) / 1000;
  const s = def.startupMs / 1000 / total;
  const a = (def.startupMs + def.activeMs) / 1000 / total;
  switch (name) {
    case 'kael_spin':
      return buildPoseClip(name, total, [
        { t: 0, pose: idle },
        ...spinKeys(ARMS_WIDE, s, a, 1, -40),
        { t: 1, pose: idle },
      ]);
    case 'kael_gyre':
      return buildPoseClip(name, total, [
        { t: 0, pose: idle },
        ...spinKeys(ARMS_WIDE, s, a, 3, 0),
        { t: 1, pose: idle },
      ]);
    case 'kael_ult': {
      const keys: ClipKey[] = [
        { t: 0, pose: idle },
        { t: s * 0.6, pose: pose(OVERHEAD_WIND, {}, [0, 0.15, 0]) },
        { t: s, pose: OVERHEAD_WIND },
      ];
      const strikes = 6;
      for (let i = 0; i < strikes; i++) {
        const t = s + ((a - s) * (i + 0.5)) / strikes;
        keys.push({ t, pose: i % 2 === 0 ? OVERHEAD_HIT : CROSS_HIT });
        keys.push({
          t: s + ((a - s) * (i + 0.95)) / strikes,
          pose: i % 2 === 0 ? CROSS_WIND : OVERHEAD_WIND,
        });
      }
      keys.push({ t: a, pose: OVERHEAD_HIT }, { t: 1, pose: idle });
      return buildPoseClip(name, total, keys);
    }
    default:
      return buildActionClip(def, idle);
  }
}

export function buildDodgeClips(idle: Pose): AnimationClip[] {
  const tuck = (hipsX: number, rootY: number): Pose =>
    pose(
      CROUCH,
      {
        Hips: [hipsX, 0, 0],
        LeftUpLeg: [-95, 0, 6],
        RightUpLeg: [-95, 0, -6],
        LeftLeg: [115, 0, 0],
        RightLeg: [115, 0, 0],
        LeftArm: [-40, 0, 20],
        RightArm: [-40, 0, -20],
      },
      [0, rootY, 0],
    );
  return [
    buildPoseClip('dodge_roll', 1, [
      { t: 0, pose: idle },
      { t: 0.12, pose: tuck(40, -0.3) },
      { t: 0.35, pose: tuck(150, -0.45) },
      { t: 0.6, pose: tuck(270, -0.45) },
      { t: 0.82, pose: tuck(350, -0.25) },
      { t: 1, pose: idle },
    ]),
    buildPoseClip('dodge_back', 1, [
      { t: 0, pose: idle },
      { t: 0.25, pose: pose(CROUCH, { Spine: [-10, 0, 0] }, [0, -0.15, 0]) },
      {
        t: 0.55,
        pose: pose(
          idle,
          { Spine: [-22, 0, 0], LeftArm: [-60, 0, 30], RightArm: [-60, 0, -30] },
          [0, 0.18, 0],
        ),
      },
      { t: 1, pose: idle },
    ]),
  ];
}

/** Enemy attack = telegraph clip (idle → wind, held) + strike clip (wind → hit → idle). */
export function buildEnemyAttackClips(atk: EnemyAttackDef, idle: Pose): AnimationClip[] {
  const wind = POSE_LIBRARY[atk.windPose];
  const hit = POSE_LIBRARY[atk.hitPose];
  const strikeTotal = (atk.activeMs + atk.recoveryMs) / 1000;
  const activeFrac = atk.activeMs / (atk.activeMs + atk.recoveryMs);
  const clips: AnimationClip[] = [];
  if (atk.special === 'leap') {
    clips.push(
      buildPoseClip(`${atk.id}:tele`, atk.startupMs / 1000, [
        { t: 0, pose: idle },
        {
          t: 0.4,
          pose: pose(CROUCH, { LeftArm: [45, 0, 25], RightArm: [45, 0, -25] }, [0, -0.3, 0]),
        },
        {
          t: 0.5,
          pose: pose(CROUCH, { LeftArm: [45, 0, 25], RightArm: [45, 0, -25] }, [0, -0.3, 0]),
        },
        { t: 0.62, pose: wind },
        { t: 1, pose: wind },
      ]),
    );
  } else {
    clips.push(transitionClip(`${atk.id}:tele`, atk.startupMs / 1000, idle, wind, 0.15));
  }
  clips.push(
    buildPoseClip(`${atk.id}:strike`, strikeTotal, [
      { t: 0, pose: wind },
      { t: activeFrac, pose: hit },
      { t: activeFrac + (1 - activeFrac) * 0.45, pose: hit },
      { t: 1, pose: idle },
    ]),
  );
  return clips;
}
