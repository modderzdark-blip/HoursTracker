import type { AnimationClip } from 'three';
import type { ActionDef } from '../data/combatTypes';
import type { EnemyAttackDef } from '../data/enemies';
import { buildPoseClip, type ClipKey } from './clipBuilder';
import { buildHeroClip } from './heroClips';
import { buildIdleClip, buildRunClip, buildRunStopClip } from './locomotionClips';
import { heroStyle, type MotionStyle } from './motionStyles';
import { buildReactionClips } from './reactions';
import {
  AIM_UP,
  AIM_UP_RELEASE,
  ARMS_WIDE,
  CHARGE_HOLD,
  CROSS_HIT,
  CROSS_WIND,
  CROUCH,
  GS_SIDE_HIT,
  OVERHEAD_HIT,
  OVERHEAD_WIND,
  POSE_LIBRARY,
  ROAR,
  blendPose,
  addPose,
  pose,
  type Pose,
  type Rot,
} from './poses';

const DEFAULT_STYLE: MotionStyle = heroStyle('');

/** Bones that lead a strike (hips and torso turn first; the arms whip through after). */
const LEAD_BONES = new Set(['Hips', 'Spine', 'LeftUpLeg', 'LeftLeg', 'RightUpLeg', 'RightLeg']);
const LAG = new Map<string, number>([
  ['Chest', 0.95],
  ['Head', 0.9],
  ['LeftArm', 0.82],
  ['RightArm', 0.82],
  ['LeftForeArm', 0.68],
  ['RightForeArm', 0.68],
  ['LeftHand', 0.6],
  ['RightHand', 0.6],
]);

/**
 * Wind → hit blend with overlapping action: the hips and legs are already through (×1.15 of
 * `k`, capped at 1), the chest follows, the arms and the weapon hand trail behind. Reads as the
 * body driving the weapon instead of every joint moving in lockstep.
 */
export function overlapPose(wind: Pose, hit: Pose, k: number): Pose {
  const out: Record<string, Rot> = {};
  const names = new Set([...Object.keys(wind.r), ...Object.keys(hit.r)]);
  for (const name of names) {
    const a = (wind.r as Record<string, Rot | undefined>)[name] ?? [0, 0, 0];
    const b = (hit.r as Record<string, Rot | undefined>)[name] ?? [0, 0, 0];
    const kk = LEAD_BONES.has(name) ? Math.min(1, k * 1.15) : k * (LAG.get(name) ?? 1);
    out[name] = [a[0] + (b[0] - a[0]) * kk, a[1] + (b[1] - a[1]) * kk, a[2] + (b[2] - a[2]) * kk];
  }
  const pa = wind.root ?? [0, 0, 0];
  const pb = hit.root ?? [0, 0, 0];
  const kr = Math.min(1, k * 1.15);
  return {
    r: out,
    root: [
      pa[0] + (pb[0] - pa[0]) * kr,
      pa[1] + (pb[1] - pa[1]) * kr,
      pa[2] + (pb[2] - pa[2]) * kr,
    ],
  };
}

/** Big boss / brute roar: gather in, explode outward, shake with it, settle. */
function roarKeys(idle: Pose, from: number, to: number): ClipKey[] {
  const at = (u: number): number => from + (to - from) * u;
  const gather = addPose(idle, {
    r: {
      Spine: [22, 0, 0],
      Chest: [10, 0, 0],
      Head: [20, 0, 0],
      LeftArm: [-30, 0, -18],
      RightArm: [-30, 0, 18],
      LeftForeArm: [-50, 0, 0],
      RightForeArm: [-50, 0, 0],
    },
    root: [0, -0.12, 0],
  });
  const big = pose(
    ROAR,
    {
      Spine: [-26, 0, 0],
      Chest: [-12, 0, 0],
      Head: [-34, 0, 0],
      LeftArm: [-62, 0, 84],
      RightArm: [-62, 0, -84],
      LeftForeArm: [-30, 0, 0],
      RightForeArm: [-30, 0, 0],
      LeftUpLeg: [-14, 0, 12],
      RightUpLeg: [-4, 0, -12],
      LeftLeg: [18, 0, 0],
      RightLeg: [10, 0, 0],
    },
    [0, -0.05, 0],
  );
  const keys: ClipKey[] = [
    { t: at(0), pose: idle },
    { t: at(0.2), pose: gather, ease: 'inOut' },
    { t: at(0.32), pose: big, ease: 'snap' },
  ];
  for (let i = 0; i < 6; i++) {
    const s = i % 2 === 0 ? 1 : -1;
    keys.push({
      t: at(0.38 + i * 0.07),
      pose: addPose(big, { r: { Chest: [s * 2, s * 3, s * 2], Head: [s * 3, -s * 4, 0] } }),
    });
  }
  keys.push(
    { t: at(0.86), pose: blendPose(big, idle, 0.5), ease: 'inOut' },
    { t: at(1), pose: idle, ease: 'inOut' },
  );
  return keys;
}

/** Points the weapon at the enemy, then beckons with the free hand. */
function tauntKeys(idle: Pose, from: number, to: number): ClipKey[] {
  const at = (u: number): number => from + (to - from) * u;
  const point = pose(idle, {
    Spine: [2, -10, 0],
    Chest: [-4, -14, 0],
    Head: [-8, 10, 0],
    RightArm: [-96, 0, -6],
    RightForeArm: [-6, 0, 0],
  });
  const open = pose(point, { LeftArm: [-74, 0, 22], LeftForeArm: [-16, 0, 0] });
  const curl = pose(point, { LeftArm: [-74, 0, 22], LeftForeArm: [-104, 0, 0] });
  return [
    { t: at(0), pose: idle },
    { t: at(0.22), pose: point, ease: 'inOut' },
    { t: at(0.42), pose: open, ease: 'inOut' },
    { t: at(0.54), pose: curl, ease: 'inOut' },
    { t: at(0.64), pose: open, ease: 'inOut' },
    { t: at(0.74), pose: curl, ease: 'inOut' },
    { t: at(1), pose: idle, ease: 'inOut' },
  ];
}

/**
 * Shared clips for every humanoid, shaped by its motion style: idle, run, run_stop, hit
 * reactions (flinch_/hit_<side>, additive hurt_<side> + hurt), knockdown, getup, deaths, stagger,
 * stagger_heavy, spawn, roar, taunt and intro (taunt → roar, for bosses).
 */
export function buildHumanoidClips(
  idle: Pose,
  style: MotionStyle = DEFAULT_STYLE,
): {
  clips: AnimationClip[];
  additive: AnimationClip[];
} {
  const reactions = buildReactionClips(idle, style);
  const clips = [
    buildIdleClip(idle, style),
    buildRunClip(idle, style),
    buildRunStopClip(idle, style),
    ...reactions.clips,
    buildPoseClip('roar', 1, roarKeys(idle, 0, 1)),
    buildPoseClip('taunt', 2, tauntKeys(idle, 0, 1)),
    buildPoseClip('intro', 1, [...tauntKeys(idle, 0, 0.42), ...roarKeys(idle, 0.46, 1)]),
  ];
  return { clips, additive: reactions.additive };
}

/** Follow-through: the strike swings this far past its hit pose before settling. */
const OVERSHOOT = 1.12;

/**
 * Keys for wind → strike → recover with animation principles instead of linear blends: the
 * wind-up eases in and settles (anticipation), the strike snaps with the hips leading and the
 * weapon arm whipping through last (overlapping action), overshoots the hit pose with the weight
 * dropping onto the front foot (follow-through), holds, then eases back to idle.
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
    if (startFrac > 0.02)
      keys.push({ t: startFrac * 0.6, pose: blendPose(idle, wind, 0.86), ease: 'inOut' });
  }
  const over = blendPose(wind, hit, OVERSHOOT);
  const overRoot = over.root ?? [0, 0, 0];
  keys.push(
    { t: startFrac, pose: wind, ease: includeWindUp ? 'out' : 'linear' },
    {
      t: startFrac + (activeEndFrac - startFrac) * 0.4,
      pose: overlapPose(wind, hit, 0.9),
      ease: 'snap',
    },
    {
      t: activeEndFrac,
      pose: pose(over, {}, [overRoot[0], overRoot[1] - 0.025, overRoot[2]]),
      ease: 'out',
    },
    { t: holdFrac, pose: hit, ease: 'inOut' },
    { t: holdFrac + (1 - holdFrac) * 0.45, pose: blendPose(hit, idle, 0.35), ease: 'inOut' },
    { t: 1, pose: idle, ease: 'inOut' },
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

/**
 * The telegraph's held pose: the wind-up pushed further (deeper coil, lower stance) so big hits
 * read from across the arena. `windup` 0..1 comes from the motion style.
 */
export function telegraphPose(idle: Pose, wind: Pose, windup: number): Pose {
  // Coil further only where it reads as loading the blow: the torso twist and the legs (a lower,
  // wider stance). Pitch and the arms keep the wind-up (overhead arms must not fold back).
  const k = 1 + 0.2 * windup;
  const big = blendPose(idle, wind, k);
  const r: Record<string, Rot> = { ...big.r };
  for (const b of ['Spine', 'Chest'] as const) {
    const w = wind.r[b] ?? [0, 0, 0];
    const e = big.r[b] ?? [0, 0, 0];
    r[b] = [w[0], e[1], w[2]];
  }
  for (const b of ARM_BONES) {
    const w = wind.r[b];
    if (w !== undefined) r[b] = w;
  }
  const root = big.root ?? [0, 0, 0];
  return { r, root: [root[0], root[1] - 0.035 * windup, root[2]] };
}

const ARM_BONES = [
  'LeftArm',
  'LeftForeArm',
  'LeftHand',
  'RightArm',
  'RightForeArm',
  'RightHand',
] as const;

/**
 * Telegraph keys: a small counter-move away from the wind-up (the anticipation of the
 * anticipation), a slow heavy coil into the exaggerated wind pose, then, for long wind-ups,
 * a tremble while it is held, so the player sees the blow is about to land.
 */
export function telegraphKeys(
  idle: Pose,
  wind: Pose,
  startupMs: number,
  windup: number,
): ClipKey[] {
  const big = telegraphPose(idle, wind, windup);
  const counter = blendPose(idle, wind, -0.12 * windup);
  const keys: ClipKey[] = [
    { t: 0, pose: idle },
    { t: 0.14, pose: counter, ease: 'out' },
    { t: 0.62, pose: big, ease: 'inOut' },
  ];
  if (startupMs >= 550 && windup >= 0.5) {
    for (let i = 0; i < 4; i++) {
      const s = i % 2 === 0 ? 1 : -1;
      keys.push({
        t: 0.7 + i * 0.075,
        pose: addPose(big, {
          r: {
            Chest: [s * 1.5, 0, s * 2.5],
            LeftArm: [s * 3, 0, 0],
            RightArm: [-s * 3, 0, 0],
            Head: [0, s * 2, 0],
          },
        }),
      });
    }
  }
  keys.push({ t: 1, pose: big, ease: 'inOut' });
  return keys;
}

/** Enemy attack = telegraph clip (idle -> exaggerated wind, held) + strike (wind -> hit -> idle). */
export function buildEnemyAttackClips(
  atk: EnemyAttackDef,
  idle: Pose,
  style: MotionStyle = DEFAULT_STYLE,
): AnimationClip[] {
  const wind = POSE_LIBRARY[atk.windPose];
  const hit = POSE_LIBRARY[atk.hitPose];
  const strikeTotal = (atk.activeMs + atk.recoveryMs) / 1000;
  const activeFrac = atk.activeMs / (atk.activeMs + atk.recoveryMs);
  const windup = style.windup;
  const big = telegraphPose(idle, wind, windup);
  const clips: AnimationClip[] = [];
  if (atk.special === 'leap') {
    // Crouch and spring (the brain lifts the body off at half the telegraph), coil in the air.
    const crouch = pose(CROUCH, { LeftArm: [45, 0, 25], RightArm: [45, 0, -25] }, [0, -0.32, 0]);
    clips.push(
      buildPoseClip(`${atk.id}:tele`, atk.startupMs / 1000, [
        { t: 0, pose: idle },
        { t: 0.4, pose: crouch, ease: 'inOut' },
        { t: 0.5, pose: pose(crouch, {}, [0, -0.36, 0]), ease: 'out' },
        { t: 0.62, pose: big, ease: 'out' },
        { t: 1, pose: big, ease: 'inOut' },
      ]),
    );
  } else {
    clips.push(
      buildPoseClip(
        `${atk.id}:tele`,
        atk.startupMs / 1000,
        telegraphKeys(idle, wind, atk.startupMs, windup),
      ),
    );
  }
  clips.push(
    buildPoseClip(
      `${atk.id}:strike`,
      strikeTotal,
      strikeKeys(idle, big, hit, 0, activeFrac, false),
    ),
  );
  return clips;
}
