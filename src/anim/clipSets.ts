import type { AnimationClip } from 'three';
import type { ActionDef } from '../data/combatTypes';
import type { EnemyAttackDef } from '../data/enemies';
import { buildPoseClip, transitionClip, type ClipKey } from './clipBuilder';
import { buildHeroClip } from './heroClips';
import {
  AIM_UP,
  AIM_UP_RELEASE,
  ARMS_WIDE,
  CHARGE_HOLD,
  CROSS_HIT,
  CROSS_WIND,
  CROUCH,
  GS_SIDE_HIT,
  LYING,
  OVERHEAD_HIT,
  OVERHEAD_WIND,
  POSE_LIBRARY,
  ROAR,
  STAGGERED,
  STRIDE_A,
  STRIDE_PASS,
  blendPose,
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
  const idleRoot = idle.root ?? [0, 0, 0];
  const hips = idle.r.Hips ?? [0, 0, 0];
  const breathe = pose(idle, { Chest: [(idle.r.Chest?.[0] ?? 0) + 3, 0, 0] }, [
    idleRoot[0],
    idleRoot[1] - 0.012,
    idleRoot[2],
  ]);
  // Weight shifts from one foot to the other between breaths.
  const shiftL = pose(breathe, { Hips: [hips[0], hips[1], hips[2] + 2.5] }, [
    idleRoot[0] + 0.012,
    idleRoot[1] - 0.012,
    idleRoot[2],
  ]);
  const shiftR = pose(breathe, { Hips: [hips[0], hips[1], hips[2] - 2.5] }, [
    idleRoot[0] - 0.012,
    idleRoot[1] - 0.012,
    idleRoot[2],
  ]);
  // Run: contact → pass (stance leg under the body, swing leg tucked) → flight → mirrored.
  // Hips twist with the legs while the chest counter-twists.
  const runA = pose(
    STRIDE_A,
    { Spine: [(idle.r.Spine?.[0] ?? 0) + 8, 0, 0], Hips: [0, 8, 0], Chest: [0, -12, 0] },
    [0, -0.03, 0],
  );
  const runB = mirror(runA);
  const passL = pose(STRIDE_PASS, { Spine: [(idle.r.Spine?.[0] ?? 0) + 9, 0, 0] });
  const passR = mirror(passL);
  // Flight: both feet off the ground between pass and the next contact.
  const flyL = pose(blendPose(passL, runB, 0.55), {}, [0, 0.045, 0]);
  const flyR = mirror(flyL);
  const lean = pose(
    idle,
    { Spine: [-25, 0, 0], Chest: [-10, 0, 0], Head: [-15, 0, 0] },
    [0, -0.05, 0],
  );
  const clips = [
    buildPoseClip('idle', 4.8, [
      { t: 0, pose: idle },
      { t: 0.25, pose: shiftL },
      { t: 0.5, pose: idle },
      { t: 0.75, pose: shiftR },
      { t: 1, pose: idle },
    ]),
    buildPoseClip('run', 0.6, [
      { t: 0, pose: runA },
      { t: 0.2, pose: passL },
      { t: 0.36, pose: flyL },
      { t: 0.5, pose: runB },
      { t: 0.7, pose: passR },
      { t: 0.86, pose: flyR },
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

/** Follow-through: the strike swings this far past its hit pose before settling. */
const OVERSHOOT = 1.12;

/**
 * Keys for wind → strike → recover with animation principles instead of linear blends: the
 * wind-up eases in (most of the motion early, then a short settle = anticipation), the strike
 * snaps (most of the arc in the first part of the active window), overshoots the hit pose
 * (follow-through), holds, then eases back to idle.
 */
export function strikeKeys(
  idle: Pose,
  wind: Pose,
  hit: Pose,
  startFrac: number,
  activeEndFrac: number,
  includeWindUp = true,
): ClipKey[] {
  const holdFrac = activeEndFrac + (1 - activeEndFrac) * 0.4;
  const keys: ClipKey[] = [];
  if (includeWindUp) {
    keys.push({ t: 0, pose: idle });
    if (startFrac > 0.02) keys.push({ t: startFrac * 0.55, pose: blendPose(idle, wind, 0.82) });
  }
  keys.push(
    { t: startFrac, pose: wind },
    { t: startFrac + (activeEndFrac - startFrac) * 0.4, pose: blendPose(wind, hit, 0.88) },
    { t: activeEndFrac, pose: blendPose(wind, hit, OVERSHOOT) },
    { t: holdFrac, pose: hit },
    { t: holdFrac + (1 - holdFrac) * 0.45, pose: blendPose(hit, idle, 0.3) },
    { t: 1, pose: idle },
  );
  return keys;
}

/** Whole-action clip (startup → active → recovery) aligned to the action's timing data. */
export function buildActionClip(def: ActionDef, idle: Pose, speed = 1): AnimationClip {
  const total = (def.startupMs + def.activeMs + def.recoveryMs) / speed;
  const startupFrac = def.startupMs / speed / total;
  const activeEndFrac = (def.startupMs + def.activeMs) / speed / total;
  const wind = POSE_LIBRARY[def.windPose];
  const hit = POSE_LIBRARY[def.hitPose];
  return buildPoseClip(
    def.id,
    total / 1000,
    strikeKeys(idle, wind, hit, startupFrac, activeEndFrac),
  );
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
    case 'brann_spin':
      return buildPoseClip(name, total, [
        { t: 0, pose: idle },
        ...spinKeys(GS_SIDE_HIT, s, a, 1.5, 0),
        { t: 1, pose: idle },
      ]);
    case 'brann_ult':
      // Crouch, leap high with the sword raised, crash down.
      return buildPoseClip(name, total, [
        { t: 0, pose: idle },
        { t: s * 0.3, pose: pose(CROUCH, {}, [0, -0.35, 0]) },
        { t: s * 0.7, pose: pose(OVERHEAD_WIND, {}, [0, 1.3, 0]) },
        { t: s, pose: pose(CHARGE_HOLD, {}, [0, 0.9, 0]) },
        { t: s + (a - s) * 0.4, pose: OVERHEAD_HIT },
        { t: a + (1 - a) * 0.5, pose: OVERHEAD_HIT },
        { t: 1, pose: idle },
      ]);
    case 'lyra_backflip': {
      const flip = (deg: number, lift: number): Pose =>
        pose(
          CROUCH,
          {
            Hips: [deg, 0, 0],
            LeftUpLeg: [-80, 0, 6],
            RightUpLeg: [-80, 0, -6],
            LeftLeg: [100, 0, 0],
            RightLeg: [100, 0, 0],
            LeftArm: [-150, 0, 20],
            RightArm: [-150, 0, -20],
          },
          [0, lift, 0],
        );
      return buildPoseClip(name, total, [
        { t: 0, pose: idle },
        { t: 0.08, pose: pose(CROUCH, {}, [0, -0.2, 0]) },
        { t: 0.25, pose: flip(-90, 0.6) },
        { t: 0.45, pose: flip(-200, 0.85) },
        { t: 0.65, pose: flip(-320, 0.35) },
        { t: 0.8, pose: pose(CROUCH, {}, [0, -0.25, 0]) },
        { t: 1, pose: idle },
      ]);
    }
    case 'lyra_ult': {
      const keys: ClipKey[] = [
        { t: 0, pose: idle },
        { t: s, pose: AIM_UP },
      ];
      const shots = 8;
      for (let i = 0; i < shots; i++) {
        keys.push({ t: s + ((a - s) * (i + 0.4)) / shots, pose: AIM_UP_RELEASE });
        keys.push({ t: s + ((a - s) * (i + 0.9)) / shots, pose: AIM_UP });
      }
      keys.push({ t: a, pose: AIM_UP_RELEASE }, { t: 1, pose: idle });
      return buildPoseClip(name, total, keys);
    }
    default:
      return buildHeroClip(name, total, s, a, idle) ?? buildActionClip(def, idle);
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
    buildPoseClip(
      `${atk.id}:strike`,
      strikeTotal,
      strikeKeys(idle, wind, hit, 0, activeFrac, false),
    ),
  );
  return clips;
}
