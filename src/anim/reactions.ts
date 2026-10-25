import type { AnimationClip } from 'three';
import { buildPoseClip, type ClipKey } from './clipBuilder';
import type { DeathKind, MotionStyle, SpawnKind } from './motionStyles';
import { CROUCH, LYING, NEUTRAL, STAGGERED, addPose, mirror, pose, type Pose } from './poses';

/** Where a hit came from, relative to the body: 'front' = the attacker stands in front. */
export type HitSide = 'front' | 'back' | 'left' | 'right';
export const HIT_SIDES: readonly HitSide[] = ['front', 'back', 'left', 'right'];
/** Clip names per side (no string building on hits). */
export const FLINCH_CLIPS: Readonly<Record<HitSide, string>> = {
  front: 'flinch_front',
  back: 'flinch_back',
  left: 'flinch_left',
  right: 'flinch_right',
};
export const HEAVY_CLIPS: Readonly<Record<HitSide, string>> = {
  front: 'hit_front',
  back: 'hit_back',
  left: 'hit_left',
  right: 'hit_right',
};
export const HURT_CLIPS: Readonly<Record<HitSide, string>> = {
  front: 'hurt_front',
  back: 'hurt_back',
  left: 'hurt_left',
  right: 'hurt_right',
};

/**
 * Side a hit came from. (dirX, dirZ) is the world direction the hit pushes the target, `yaw`
 * the target's facing (0 = +Z). Pushed backward = hit from the front.
 */
export function hitSide(dirX: number, dirZ: number, yaw: number): HitSide {
  const len = Math.hypot(dirX, dirZ);
  if (len < 1e-6) return 'front';
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const forward = (dirX * fx + dirZ * fz) / len;
  // Character right = (−fz, 0, fx).
  const right = (dirX * -fz + dirZ * fx) / len;
  if (Math.abs(forward) >= Math.abs(right)) return forward < 0 ? 'front' : 'back';
  // Pushed toward the right = the attacker is on the left.
  return right > 0 ? 'left' : 'right';
}

// ---- Light flinches: offsets added to the stance (pushed back / forward / sideways) ----
const FLINCH_FRONT: Pose = {
  r: {
    Spine: [-10, 0, 0],
    Chest: [-8, 0, 0],
    Head: [-18, 0, 0],
    LeftArm: [-12, 0, 14],
    RightArm: [-12, 0, -14],
    LeftForeArm: [-14, 0, 0],
    RightForeArm: [-14, 0, 0],
    LeftUpLeg: [-6, 0, 0],
    LeftLeg: [10, 0, 0],
    RightLeg: [8, 0, 0],
  },
  root: [0, -0.04, -0.05],
};
const FLINCH_BACK: Pose = {
  r: {
    Spine: [16, 0, 0],
    Chest: [8, 0, 0],
    Head: [-10, 0, 0],
    LeftArm: [24, 0, 10],
    RightArm: [24, 0, -10],
    LeftUpLeg: [-10, 0, 0],
    LeftLeg: [14, 0, 0],
    RightLeg: [10, 0, 0],
  },
  root: [0, -0.04, 0.05],
};
/** Attacker on the left: the body is shoved to the right and twists away. */
const FLINCH_LEFT: Pose = {
  r: {
    Spine: [2, -10, 12],
    Chest: [0, -6, 6],
    Head: [0, 8, -12],
    LeftArm: [-22, 0, 24],
    RightArm: [6, 0, -14],
    LeftUpLeg: [0, 0, 8],
    RightUpLeg: [0, 0, -6],
    RightLeg: [8, 0, 0],
  },
  root: [-0.05, -0.03, 0],
};

// ---- Heavy hits: bigger recoil with a step to catch the weight ----
const HIT_FRONT: Pose = {
  r: {
    Spine: [-22, 0, 0],
    Chest: [-12, 0, 0],
    Head: [-24, 0, 0],
    LeftArm: [-48, 0, 32],
    RightArm: [-48, 0, -32],
    LeftForeArm: [-20, 0, 0],
    RightForeArm: [-20, 0, 0],
    LeftUpLeg: [-18, 0, 4],
    LeftLeg: [22, 0, 0],
    RightUpLeg: [28, 0, -4],
    RightLeg: [30, 0, 0],
  },
  root: [0, -0.08, -0.12],
};
const HIT_BACK: Pose = {
  r: {
    Spine: [30, 0, 0],
    Chest: [12, 0, 0],
    Head: [-16, 0, 0],
    LeftArm: [36, 0, 16],
    RightArm: [36, 0, -16],
    LeftUpLeg: [-36, 0, 4],
    LeftLeg: [40, 0, 0],
    RightUpLeg: [14, 0, -2],
    RightLeg: [16, 0, 0],
  },
  root: [0, -0.1, 0.12],
};
const HIT_LEFT: Pose = {
  r: {
    Spine: [4, -16, 20],
    Chest: [0, -10, 8],
    Head: [0, 10, -14],
    LeftArm: [-40, 0, 48],
    RightArm: [10, 0, -24],
    LeftUpLeg: [0, 0, 10],
    LeftLeg: [16, 0, 0],
    RightUpLeg: [0, 0, -14],
    RightLeg: [12, 0, 0],
  },
  root: [-0.12, -0.08, 0],
};
/** After a heavy hit: knees bent, leaning back in to recover. */
const CATCH: Pose = {
  r: {
    Spine: [10, 0, 0],
    Head: [6, 0, 0],
    LeftUpLeg: [-16, 0, 0],
    LeftLeg: [26, 0, 0],
    RightUpLeg: [-8, 0, 0],
    RightLeg: [22, 0, 0],
  },
  root: [0, -0.09, 0],
};

const FLINCH: Readonly<Record<HitSide, Pose>> = {
  front: FLINCH_FRONT,
  back: FLINCH_BACK,
  left: FLINCH_LEFT,
  right: mirror(FLINCH_LEFT),
};
const HEAVY: Readonly<Record<HitSide, Pose>> = {
  front: HIT_FRONT,
  back: HIT_BACK,
  left: HIT_LEFT,
  right: mirror(HIT_LEFT),
};

// ---- Full-body poses: falls, lying, kneeling ----
const ZERO: Pose = { r: {}, root: [0, 0, 0] };

/** Knocked off the feet, falling backward. */
const KD_AIR: Pose = pose(
  NEUTRAL,
  {
    Hips: [-45, 0, 0],
    Spine: [-8, 0, 0],
    Head: [22, 0, 0],
    LeftArm: [-110, 0, 40],
    RightArm: [-110, 0, -40],
    LeftForeArm: [-30, 0, 0],
    RightForeArm: [-30, 0, 0],
    LeftUpLeg: [-62, 0, 8],
    RightUpLeg: [-36, 0, -8],
    LeftLeg: [52, 0, 0],
    RightLeg: [30, 0, 0],
  },
  [0, -0.16, -0.3],
);
/** Back slams into the ground: legs still up, head whipping. */
const KD_IMPACT: Pose = pose(
  LYING,
  {
    Head: [26, 0, 0],
    LeftArm: [-30, 0, 78],
    RightArm: [-30, 0, -78],
    LeftUpLeg: [-42, 0, 10],
    RightUpLeg: [-26, 0, -10],
    LeftLeg: [40, 0, 0],
    RightLeg: [20, 0, 0],
  },
  [0, -0.79, -0.42],
);
/** Small bounce off the ground. */
const KD_BOUNCE: Pose = pose(
  LYING,
  {
    Hips: [-76, 0, 0],
    Head: [14, 0, 0],
    LeftArm: [-36, 0, 64],
    RightArm: [-36, 0, -64],
    LeftUpLeg: [-55, 0, 10],
    RightUpLeg: [-40, 0, -10],
    LeftLeg: [50, 0, 0],
    RightLeg: [36, 0, 0],
  },
  [0, -0.72, -0.44],
);
const KD_LIE: Pose = pose(LYING, { Head: [8, 14, 0] }, [0, -0.78, -0.45]);
/** Sitting up, one hand pushing on the ground behind, one knee up. */
const GU_SIT: Pose = pose(
  NEUTRAL,
  {
    Hips: [-35, 0, 0],
    Spine: [26, 0, 0],
    Chest: [10, 0, 0],
    Head: [8, 0, 0],
    LeftArm: [42, 0, 30],
    LeftForeArm: [-8, 0, 0],
    RightArm: [-24, 0, -22],
    RightForeArm: [-40, 0, 0],
    LeftUpLeg: [-52, 0, 10],
    LeftLeg: [22, 0, 0],
    RightUpLeg: [-95, 0, -8],
    RightLeg: [100, 0, 0],
  },
  [0, -0.78, -0.25],
);
/** One knee down, hand on the other knee. */
const KNEEL: Pose = pose(
  NEUTRAL,
  {
    Hips: [10, 0, 0],
    Spine: [20, 0, 0],
    Chest: [6, 0, 0],
    Head: [-4, 0, 0],
    RightUpLeg: [-80, 0, -6],
    RightLeg: [85, 0, 0],
    LeftUpLeg: [15, 0, 8],
    LeftLeg: [110, 0, 0],
    RightArm: [-40, 0, -20],
    RightForeArm: [-30, 0, 0],
    LeftArm: [6, 0, 16],
    LeftForeArm: [-20, 0, 0],
  },
  [0, -0.45, -0.04],
);
/** Both knees down, slumped. */
const KNEEL_SLUMP: Pose = pose(
  NEUTRAL,
  {
    Hips: [6, 0, 0],
    Spine: [34, 0, 0],
    Chest: [10, 0, 0],
    Head: [30, 0, 0],
    LeftUpLeg: [-6, 0, 8],
    RightUpLeg: [4, 0, -8],
    LeftLeg: [120, 0, 0],
    RightLeg: [120, 0, 0],
    LeftArm: [10, 0, 10],
    RightArm: [12, 0, -10],
    LeftForeArm: [-10, 0, 0],
    RightForeArm: [-12, 0, 0],
  },
  [0, -0.5, 0],
);
/** Face down, head turned to the side. */
const DEAD_FRONT: Pose = pose(
  NEUTRAL,
  {
    Hips: [82, 0, 0],
    Spine: [4, 0, 0],
    Chest: [2, 0, 0],
    Head: [-6, 70, 0],
    LeftArm: [-20, 0, 40],
    RightArm: [8, 0, -14],
    LeftForeArm: [-40, 0, 0],
    RightForeArm: [-6, 0, 0],
    LeftUpLeg: [-4, 0, 6],
    RightUpLeg: [2, 0, -10],
    LeftLeg: [12, 0, 0],
    RightLeg: [30, 0, 0],
  },
  [0, -0.8, 0.5],
);
/** On the right side, legs curled. */
const DEAD_SIDE: Pose = pose(
  NEUTRAL,
  {
    Hips: [0, 250, 84],
    Spine: [16, 0, 0],
    Chest: [6, 0, 0],
    Head: [14, 0, -10],
    LeftArm: [-50, 0, 10],
    RightArm: [-70, 0, -20],
    LeftForeArm: [-30, 0, 0],
    RightForeArm: [-20, 0, 0],
    LeftUpLeg: [-40, 0, 4],
    RightUpLeg: [-20, 0, -4],
    LeftLeg: [60, 0, 0],
    RightLeg: [40, 0, 0],
  },
  [0, -0.76, 0],
);
const DEAD_BACK: Pose = pose(
  LYING,
  {
    Head: [6, 32, 0],
    LeftArm: [-10, 0, 82],
    RightArm: [-40, 0, -52],
    RightForeArm: [-50, 0, 0],
    LeftUpLeg: [-8, 0, 12],
    LeftLeg: [10, 0, 0],
    RightUpLeg: [-24, 0, -6],
    RightLeg: [44, 0, 0],
  },
  [0, -0.79, -0.55],
);

/** Root drop on landings for heavy bodies. */
function weighted(p: Pose, style: MotionStyle, extraDrop: number): Pose {
  const r = p.root ?? [0, 0, 0];
  return { r: p.r, root: [r[0], r[1] - extraDrop * style.weight, r[2]] };
}

/** Light hit: snap away from the blow, recover into the stance. */
function flinchClip(idle: Pose, side: HitSide, style: MotionStyle): AnimationClip {
  const k = style.flinch;
  const r = addPose(idle, FLINCH[side], k);
  return buildPoseClip(`flinch_${side}`, 0.32, [
    { t: 0, pose: idle },
    { t: 0.16, pose: r, ease: 'snap' },
    { t: 0.5, pose: addPose(idle, FLINCH[side], k * 0.45), ease: 'out' },
    { t: 1, pose: idle, ease: 'inOut' },
  ]);
}

/** Heavy hit: big recoil, a stumbling step that catches the weight, then recover. */
function heavyClip(idle: Pose, side: HitSide, style: MotionStyle): AnimationClip {
  const k = Math.min(1.3, style.flinch);
  const r = addPose(idle, HEAVY[side], k);
  return buildPoseClip(`hit_${side}`, 0.5, [
    { t: 0, pose: idle },
    { t: 0.12, pose: r, ease: 'snap' },
    { t: 0.24, pose: addPose(r, HEAVY[side], 0.15), ease: 'out' },
    { t: 0.55, pose: weighted(addPose(idle, CATCH, 1), style, 0.04), ease: 'inOut' },
    { t: 1, pose: idle, ease: 'inOut' },
  ]);
}

/** Additive flinch for bodies that do not lose their action (super armor, bosses). */
function additiveFlinch(side: HitSide): AnimationClip {
  const d = FLINCH[side];
  return buildPoseClip(`hurt_${side}`, 0.3, [
    { t: 0, pose: ZERO },
    { t: 0.25, pose: { r: d.r, root: [0, 0, 0] }, ease: 'snap' },
    { t: 1, pose: ZERO, ease: 'inOut' },
  ]);
}

/** Thrown backward off the feet, slam, bounce, lie still. */
function knockdownClip(idle: Pose, style: MotionStyle): AnimationClip {
  return buildPoseClip('knockdown', 1, [
    { t: 0, pose: idle },
    { t: 0.08, pose: pose(addPose(idle, HIT_FRONT, 1.2), {}, [0, 0.02, -0.08]), ease: 'snap' },
    { t: 0.3, pose: KD_AIR, ease: 'out' },
    { t: 0.42, pose: KD_IMPACT, ease: 'in' },
    { t: 0.52, pose: weighted(KD_BOUNCE, style, -0.04), ease: 'out' },
    { t: 0.64, pose: KD_LIE, ease: 'in' },
    { t: 0.82, pose: pose(KD_LIE, { Head: [14, 10, 0], Chest: [-3, 0, 0] }), ease: 'inOut' },
    { t: 1, pose: KD_LIE, ease: 'inOut' },
  ]);
}

/** Sit up, roll onto a knee, push up, settle into the stance. */
function getupClip(idle: Pose): AnimationClip {
  return buildPoseClip('getup', 1, [
    { t: 0, pose: KD_LIE },
    { t: 0.3, pose: GU_SIT, ease: 'inOut' },
    { t: 0.58, pose: KNEEL, ease: 'inOut' },
    { t: 0.8, pose: pose(CROUCH, { Head: [-8, 0, 0] }, [0, -0.2, 0]), ease: 'out' },
    { t: 1, pose: idle, ease: 'out' },
  ]);
}

function deathKeys(kind: DeathKind, idle: Pose, style: MotionStyle): ClipKey[] {
  switch (kind) {
    case 'back':
      return [
        { t: 0, pose: idle },
        { t: 0.1, pose: addPose(idle, HIT_FRONT, 1.3), ease: 'snap' },
        {
          t: 0.3,
          pose: pose(
            NEUTRAL,
            {
              Hips: [-26, 0, 0],
              Spine: [-14, 0, 0],
              Head: [22, 0, 0],
              LeftArm: [-140, 0, 40],
              RightArm: [-128, 0, -50],
              LeftUpLeg: [-34, 0, 6],
              RightUpLeg: [-20, 0, -6],
              LeftLeg: [62, 0, 0],
              RightLeg: [48, 0, 0],
            },
            [0, -0.32, -0.22],
          ),
          ease: 'out',
        },
        { t: 0.48, pose: pose(KD_IMPACT, {}, [0, -0.79, -0.55]), ease: 'in' },
        {
          t: 0.58,
          pose: weighted(pose(KD_BOUNCE, {}, [0, -0.73, -0.56]), style, -0.03),
          ease: 'out',
        },
        { t: 0.74, pose: DEAD_BACK, ease: 'in' },
        { t: 1, pose: DEAD_BACK },
      ];
    case 'crumple':
      return [
        { t: 0, pose: idle },
        {
          t: 0.12,
          pose: addPose(idle, {
            r: {
              Spine: [28, 0, 0],
              Chest: [10, 0, 0],
              Head: [18, 0, 0],
              LeftArm: [-26, 0, -12],
              LeftForeArm: [-70, 0, 0],
              RightArm: [-22, 0, 12],
              RightForeArm: [-60, 0, 0],
              LeftLeg: [16, 0, 0],
              RightLeg: [12, 0, 0],
            },
            root: [0, -0.06, 0],
          }),
          ease: 'snap',
        },
        { t: 0.38, pose: KNEEL_SLUMP, ease: 'in' },
        {
          t: 0.56,
          pose: pose(KNEEL_SLUMP, { Spine: [40, 0, 6], Head: [38, 0, 6] }),
          ease: 'inOut',
        },
        { t: 0.78, pose: DEAD_FRONT, ease: 'in' },
        {
          t: 0.86,
          pose: weighted(pose(DEAD_FRONT, {}, [0, -0.76, 0.5]), style, -0.02),
          ease: 'out',
        },
        { t: 1, pose: DEAD_FRONT, ease: 'in' },
      ];
    case 'spin':
      return [
        { t: 0, pose: idle },
        {
          t: 0.12,
          pose: pose(
            addPose(idle, { r: { Spine: [0, 40, 0], Chest: [0, 30, 0], Head: [0, 30, 0] } }),
            {
              LeftArm: [-80, 0, 80],
              RightArm: [-40, 0, -70],
            },
          ),
          ease: 'snap',
        },
        {
          t: 0.4,
          pose: pose(
            NEUTRAL,
            {
              Hips: [0, 160, 20],
              Spine: [12, 30, 0],
              Head: [10, 20, 0],
              LeftArm: [-70, 0, 90],
              RightArm: [-30, 0, -80],
              LeftUpLeg: [-30, 0, 8],
              RightUpLeg: [-10, 0, -8],
              LeftLeg: [60, 0, 0],
              RightLeg: [40, 0, 0],
            },
            [0, -0.36, 0],
          ),
          ease: 'out',
        },
        { t: 0.6, pose: DEAD_SIDE, ease: 'in' },
        { t: 0.7, pose: weighted(pose(DEAD_SIDE, {}, [0, -0.7, 0]), style, -0.03), ease: 'out' },
        { t: 0.84, pose: pose(DEAD_SIDE, { LeftLeg: [70, 0, 0], Head: [20, 0, -14] }), ease: 'in' },
        { t: 1, pose: pose(DEAD_SIDE, { LeftLeg: [70, 0, 0], Head: [20, 0, -14] }) },
      ];
    case 'forward':
      return [
        { t: 0, pose: idle },
        { t: 0.1, pose: addPose(idle, HIT_BACK, 1.1), ease: 'snap' },
        {
          t: 0.3,
          pose: pose(
            NEUTRAL,
            {
              Spine: [40, 0, 0],
              Head: [-14, 0, 0],
              LeftUpLeg: [-46, 0, 4],
              LeftLeg: [30, 0, 0],
              RightUpLeg: [26, 0, -4],
              RightLeg: [44, 0, 0],
              LeftArm: [30, 0, 20],
              RightArm: [36, 0, -20],
            },
            [0, -0.14, 0.3],
          ),
          ease: 'out',
        },
        {
          t: 0.5,
          pose: pose(
            NEUTRAL,
            {
              Hips: [48, 0, 0],
              Spine: [10, 0, 0],
              Head: [-24, 0, 0],
              LeftArm: [-120, 0, 26],
              RightArm: [-112, 0, -26],
              LeftUpLeg: [-10, 0, 4],
              RightUpLeg: [16, 0, -4],
              LeftLeg: [20, 0, 0],
              RightLeg: [36, 0, 0],
            },
            [0, -0.42, 0.55],
          ),
          ease: 'in',
        },
        { t: 0.62, pose: pose(DEAD_FRONT, {}, [0, -0.8, 0.78]), ease: 'in' },
        {
          t: 0.72,
          pose: weighted(pose(DEAD_FRONT, {}, [0, -0.75, 0.78]), style, -0.03),
          ease: 'out',
        },
        { t: 1, pose: pose(DEAD_FRONT, {}, [0, -0.8, 0.78]), ease: 'in' },
      ];
    case 'kneel':
      // Heroes and humanoid bosses: sink to the knees, a last breath, topple onto the side.
      return [
        { t: 0, pose: idle },
        { t: 0.1, pose: addPose(idle, HIT_FRONT, 0.9), ease: 'snap' },
        { t: 0.34, pose: pose(KNEEL, { Head: [22, 0, 0], Spine: [28, 0, 0] }), ease: 'in' },
        {
          t: 0.6,
          pose: pose(KNEEL, { Head: [34, 0, 4], Spine: [36, 0, 4], RightArm: [0, 0, -12] }),
          ease: 'inOut',
        },
        { t: 0.82, pose: DEAD_SIDE, ease: 'in' },
        { t: 0.9, pose: weighted(pose(DEAD_SIDE, {}, [0, -0.71, 0]), style, -0.03), ease: 'out' },
        { t: 1, pose: DEAD_SIDE, ease: 'in' },
      ];
  }
}

export function deathClip(
  name: string,
  kind: DeathKind,
  idle: Pose,
  style: MotionStyle,
): AnimationClip {
  return buildPoseClip(name, 1.1, deathKeys(kind, idle, style));
}

/** Dazed loop: head lolling, knees wobbling, arms hanging. */
function staggerClip(style: MotionStyle): AnimationClip {
  const s = (spine: Rot3, head: Rot3, drop: number): Pose =>
    pose(STAGGERED, { Spine: spine, Head: head }, [0, -0.1 - drop - 0.04 * style.weight, 0]);
  const a = s([28, 0, 6], [25, 10, 8], 0);
  return buildPoseClip('stagger', 1.4, [
    { t: 0, pose: a },
    { t: 0.25, pose: s([24, 6, 0], [20, 0, -6], 0.03), ease: 'inOut' },
    { t: 0.5, pose: s([28, 0, -6], [28, -10, -8], 0), ease: 'inOut' },
    { t: 0.75, pose: s([32, -6, 0], [22, 0, 6], 0.03), ease: 'inOut' },
    { t: 1, pose: a, ease: 'inOut' },
  ]);
}
type Rot3 = readonly [number, number, number];

/**
 * Boss break: knocked down onto one knee, heaving for breath, then pushing back up. Played
 * stretched over the whole break window.
 */
function heavyStaggerClip(idle: Pose): AnimationClip {
  const pant = (k: number): Pose =>
    pose(
      KNEEL,
      {
        Spine: [30 + 6 * k, 0, 0],
        Chest: [8 - 6 * k, 0, 0],
        Head: [26 - 10 * k, 0, 0],
        RightArm: [-30, 0, -16],
        LeftArm: [14, 0, 14],
      },
      [0, -0.45 + 0.02 * k, -0.04],
    );
  const keys: ClipKey[] = [
    { t: 0, pose: idle },
    { t: 0.05, pose: addPose(idle, HIT_FRONT, 1.2), ease: 'snap' },
    { t: 0.14, pose: pant(0), ease: 'in' },
  ];
  const breaths = 5;
  for (let i = 0; i < breaths; i++) {
    const t0 = 0.14 + (0.72 * (i + 0.5)) / breaths;
    keys.push({ t: t0, pose: pant(1), ease: 'inOut' });
    keys.push({ t: 0.14 + (0.72 * (i + 1)) / breaths, pose: pant(0), ease: 'inOut' });
  }
  keys.push(
    { t: 0.93, pose: pose(CROUCH, { Head: [-10, 0, 0] }, [0, -0.2, 0]), ease: 'out' },
    { t: 1, pose: idle, ease: 'out' },
  );
  return buildPoseClip('stagger_heavy', 1, keys);
}

const SPAWN_KNEEL: Pose = pose(KNEEL, {
  Spine: [44, 0, 0],
  Head: [40, 0, 0],
  RightArm: [10, 0, -14],
  LeftArm: [10, 0, 14],
});

function spawnKeys(kind: SpawnKind, idle: Pose): ClipKey[] {
  switch (kind) {
    case 'claw':
      // A hand breaks the ground, both arms haul the body out, a shake of the head.
      return [
        {
          t: 0,
          pose: pose(
            NEUTRAL,
            {
              RightArm: [-178, 0, -8],
              RightForeArm: [-10, 0, 0],
              LeftArm: [-30, 0, 10],
              Spine: [-6, 0, 0],
              Head: [-24, 0, 0],
            },
            [0, -2.2, 0],
          ),
        },
        {
          t: 0.22,
          pose: pose(
            NEUTRAL,
            {
              RightArm: [-170, 0, -14],
              RightForeArm: [-30, 0, 0],
              LeftArm: [-120, 0, 20],
              Spine: [10, 0, 0],
              Head: [-30, 0, 0],
            },
            [0, -1.72, 0],
          ),
          ease: 'out',
        },
        {
          t: 0.44,
          pose: pose(
            NEUTRAL,
            {
              Spine: [46, 0, 0],
              Chest: [10, 0, 0],
              Head: [-36, 0, 0],
              LeftArm: [-64, 0, 26],
              RightArm: [-60, 0, -26],
              LeftForeArm: [-30, 0, 0],
              RightForeArm: [-30, 0, 0],
            },
            [0, -1.15, 0.1],
          ),
          ease: 'inOut',
        },
        {
          t: 0.64,
          pose: pose(
            SPAWN_KNEEL,
            {
              Head: [-10, 0, 0],
              LeftArm: [-20, 0, 26],
              RightArm: [-18, 0, -26],
            },
            [0, -0.62, 0.05],
          ),
          ease: 'out',
        },
        { t: 0.8, pose: pose(CROUCH, { Head: [6, 16, 0] }, [0, -0.24, 0]), ease: 'out' },
        { t: 0.9, pose: pose(CROUCH, { Head: [4, -14, 0] }, [0, -0.16, 0]), ease: 'inOut' },
        { t: 1, pose: idle, ease: 'out' },
      ];
    case 'drop':
      // Drops out of the air into a three-point landing, then springs up.
      return [
        {
          t: 0,
          pose: pose(
            CROUCH,
            {
              LeftUpLeg: [-80, 0, 10],
              RightUpLeg: [-70, 0, -10],
              LeftLeg: [100, 0, 0],
              RightLeg: [95, 0, 0],
              LeftArm: [-150, 0, 30],
              RightArm: [-150, 0, -30],
            },
            [0, 1.6, 0],
          ),
        },
        {
          t: 0.38,
          pose: pose(CROUCH, { LeftArm: [-60, 0, 30], RightArm: [-70, 0, -30] }, [0, 0.25, 0]),
          ease: 'in',
        },
        {
          t: 0.46,
          pose: pose(
            CROUCH,
            {
              Spine: [40, 0, 0],
              RightArm: [-40, 0, -20],
              RightForeArm: [-10, 0, 0],
              LeftArm: [10, 0, 30],
              LeftUpLeg: [-70, 0, 14],
              RightUpLeg: [-50, 0, -14],
              LeftLeg: [110, 0, 0],
              RightLeg: [100, 0, 0],
            },
            [0, -0.42, 0],
          ),
          ease: 'in',
        },
        { t: 0.72, pose: pose(CROUCH, { Head: [-16, 0, 0] }, [0, -0.3, 0]), ease: 'out' },
        { t: 1, pose: idle, ease: 'out' },
      ];
    case 'rise':
      // Forms out of the ash kneeling, head bowed; rises and squares up.
      return [
        { t: 0, pose: SPAWN_KNEEL },
        {
          t: 0.4,
          pose: pose(SPAWN_KNEEL, {
            Head: [8, 0, 0],
            Spine: [30, 0, 0],
            RightArm: [-10, 0, -26],
            LeftArm: [-8, 0, 26],
          }),
          ease: 'inOut',
        },
        {
          t: 0.72,
          pose: pose(
            CROUCH,
            { Spine: [12, 0, 0], Chest: [-6, 0, 0], Head: [-8, 0, 0] },
            [0, -0.14, 0],
          ),
          ease: 'inOut',
        },
        { t: 1, pose: idle, ease: 'out' },
      ];
  }
}

/**
 * Hit reactions, knockdown / get-up, deaths, stagger and spawn clips for a humanoid stance.
 * Names: flinch_<side> / hit_<side> (base clips), hurt_<side> + hurt (additive), knockdown,
 * getup, death + death_<kind> for every kind in the style, stagger, stagger_heavy, spawn.
 */
export function buildReactionClips(
  idle: Pose,
  style: MotionStyle,
): { clips: AnimationClip[]; additive: AnimationClip[] } {
  const clips: AnimationClip[] = [];
  const additive: AnimationClip[] = [];
  for (const side of HIT_SIDES) {
    clips.push(flinchClip(idle, side, style), heavyClip(idle, side, style));
    additive.push(additiveFlinch(side));
  }
  additive.push(
    buildPoseClip('hurt', 0.32, [
      { t: 0, pose: ZERO },
      {
        t: 0.3,
        pose: { r: { Spine: [-18, 0, 0], Chest: [-10, 0, 0], Head: [-16, 0, 0] } },
        ease: 'snap',
      },
      { t: 1, pose: ZERO, ease: 'inOut' },
    ]),
  );
  clips.push(knockdownClip(idle, style), getupClip(idle));
  const kinds = style.deaths.length > 0 ? style.deaths : (['back'] as const);
  clips.push(deathClip('death', kinds[0] ?? 'back', idle, style));
  for (const k of kinds) clips.push(deathClip(`death_${k}`, k, idle, style));
  clips.push(staggerClip(style), heavyStaggerClip(idle));
  clips.push(buildPoseClip('spawn', 1, spawnKeys(style.spawn, idle)));
  return { clips, additive };
}

/** Lying pose the knockdown ends in (the get-up starts from it). */
export const KNOCKED_DOWN: Pose = KD_LIE;
