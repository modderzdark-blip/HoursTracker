import type { AnimationClip } from 'three';
import { buildPoseClip, type ClipKey } from './clipBuilder';
import type { MotionStyle } from './motionStyles';
import {
  STRIDE_A,
  STRIDE_PASS,
  addPose,
  blendPose,
  mirror,
  pose,
  type Pose,
  type Rot,
} from './poses';

const ARM_BONES = [
  'LeftArm',
  'LeftForeArm',
  'LeftHand',
  'RightArm',
  'RightForeArm',
  'RightHand',
] as const;

/** `p` with its arms blended `k` of the way toward the arms of `stance`. */
function holdArms(p: Pose, stance: Pose, k: number): Pose {
  if (k <= 0) return p;
  const r: Record<string, Rot> = { ...p.r };
  for (const b of ARM_BONES) {
    const a = p.r[b] ?? [0, 0, 0];
    const s = stance.r[b] ?? [0, 0, 0];
    r[b] = [a[0] + (s[0] - a[0]) * k, a[1] + (s[1] - a[1]) * k, a[2] + (s[2] - a[2]) * k];
  }
  return { r, root: p.root ?? [0, 0, 0] };
}

/** Pure offset pose (deltas for `addPose`). */
function d(r: Pose['r'], root: readonly [number, number, number] = [0, 0, 0]): Pose {
  return { r, root };
}

/**
 * Idle loop for a stance and personality. Heroes breathe and shift their weight; the risen dead
 * sway and loll; imps twitch; brutes heave; casters float with weaving hands.
 */
export function buildIdleClip(idle: Pose, style: MotionStyle): AnimationClip {
  const root = idle.root ?? [0, 0, 0];
  const hips = idle.r.Hips ?? [0, 0, 0];
  switch (style.idle) {
    case 'sway': {
      const left = addPose(
        idle,
        d({ Spine: [2, 0, 5], Chest: [3, 4, 2], Head: [8, 12, 10] }, [0.02, -0.01, 0]),
      );
      const right = addPose(
        idle,
        d({ Spine: [2, 0, -5], Chest: [3, -4, -2], Head: [10, -8, -12] }, [-0.02, -0.01, 0]),
      );
      const twitch = addPose(
        idle,
        d({ Head: [-6, -24, 4], Chest: [0, -6, 0], RightArm: [-8, 0, 0] }),
      );
      return buildPoseClip('idle', 3.8, [
        { t: 0, pose: idle },
        { t: 0.26, pose: left, ease: 'inOut' },
        { t: 0.5, pose: idle, ease: 'inOut' },
        { t: 0.56, pose: twitch, ease: 'snap' },
        { t: 0.64, pose: idle, ease: 'out' },
        { t: 0.82, pose: right, ease: 'inOut' },
        { t: 1, pose: idle, ease: 'inOut' },
      ]);
    }
    case 'twitch': {
      const breathIn = addPose(idle, d({ Chest: [-4, 0, 0], Spine: [-2, 0, 0] }, [0, 0.012, 0]));
      const look = (yaw: number, roll: number): Pose =>
        addPose(breathIn, d({ Head: [-4, yaw, roll], Chest: [0, yaw * 0.2, 0] }));
      return buildPoseClip('idle', 1.8, [
        { t: 0, pose: idle },
        { t: 0.12, pose: breathIn, ease: 'out' },
        { t: 0.2, pose: look(28, 8), ease: 'snap' },
        { t: 0.36, pose: addPose(idle, d({ Head: [0, 26, 8] })), ease: 'inOut' },
        { t: 0.46, pose: look(-24, -6), ease: 'snap' },
        { t: 0.62, pose: addPose(idle, d({ Head: [0, -22, -6] }, [0, -0.015, 0])), ease: 'inOut' },
        { t: 0.74, pose: look(6, 14), ease: 'snap' },
        { t: 1, pose: idle, ease: 'inOut' },
      ]);
    }
    case 'heave': {
      const inhale = addPose(
        idle,
        d(
          {
            Chest: [-7, 0, 0],
            Spine: [-3, 0, 0],
            Head: [-6, 0, 0],
            LeftArm: [0, 0, 6],
            RightArm: [0, 0, -6],
          },
          [0, 0.025, 0],
        ),
      );
      const exhale = addPose(
        idle,
        d(
          {
            Chest: [6, 0, 0],
            Spine: [4, 0, 0],
            Head: [8, 0, 0],
            LeftArm: [0, 0, -2],
            RightArm: [0, 0, 2],
          },
          [0, -0.035, 0],
        ),
      );
      const roll = addPose(exhale, d({ Chest: [0, 8, 4], Head: [0, -10, 0] }));
      return buildPoseClip('idle', 3.4, [
        { t: 0, pose: idle },
        { t: 0.3, pose: inhale, ease: 'inOut' },
        { t: 0.55, pose: exhale, ease: 'inOut' },
        { t: 0.75, pose: roll, ease: 'inOut' },
        { t: 1, pose: idle, ease: 'inOut' },
      ]);
    }
    case 'guard': {
      const scanL = addPose(
        idle,
        d({ Head: [0, 16, 0], Chest: [0, 4, 0], LeftArm: [-4, 0, 0] }, [0.01, -0.01, 0]),
      );
      const scanR = addPose(
        idle,
        d({ Head: [0, -14, 0], Chest: [0, -4, 0], LeftArm: [3, 0, 0] }, [-0.01, -0.01, 0]),
      );
      return buildPoseClip('idle', 3.6, [
        { t: 0, pose: idle },
        { t: 0.28, pose: scanL, ease: 'inOut' },
        { t: 0.5, pose: idle, ease: 'inOut' },
        { t: 0.78, pose: scanR, ease: 'inOut' },
        { t: 1, pose: idle, ease: 'inOut' },
      ]);
    }
    case 'hover': {
      const up = addPose(
        idle,
        d(
          {
            LeftArm: [-14, 0, 6],
            LeftForeArm: [-16, 0, 0],
            RightArm: [8, 0, -4],
            Chest: [-2, 0, 3],
            Head: [-4, 6, 0],
          },
          [0, 0.03, 0],
        ),
      );
      const down = addPose(
        idle,
        d(
          {
            LeftArm: [8, 0, -4],
            RightArm: [-14, 0, -6],
            RightForeArm: [-16, 0, 0],
            Chest: [-2, 0, -3],
            Head: [-4, -6, 0],
          },
          [0, -0.01, 0],
        ),
      );
      return buildPoseClip('idle', 3.4, [
        { t: 0, pose: idle },
        { t: 0.25, pose: up, ease: 'inOut' },
        { t: 0.5, pose: addPose(idle, d({}, [0, 0.01, 0])), ease: 'inOut' },
        { t: 0.75, pose: down, ease: 'inOut' },
        { t: 1, pose: idle, ease: 'inOut' },
      ]);
    }
    case 'stalk': {
      const shiftL = addPose(
        idle,
        d(
          { Hips: [0, 0, 3], Spine: [2, 8, -2], Head: [0, -8, 4], RightArm: [-6, 0, 0] },
          [0.025, -0.02, 0],
        ),
      );
      const shiftR = addPose(
        idle,
        d(
          { Hips: [0, 0, -3], Spine: [2, -6, 2], Head: [0, 10, -4], RightArm: [4, 0, 0] },
          [-0.025, -0.02, 0],
        ),
      );
      return buildPoseClip('idle', 3.2, [
        { t: 0, pose: idle },
        { t: 0.3, pose: shiftL, ease: 'inOut' },
        { t: 0.5, pose: idle, ease: 'inOut' },
        { t: 0.8, pose: shiftR, ease: 'inOut' },
        { t: 1, pose: idle, ease: 'inOut' },
      ]);
    }
    case 'ready':
    default: {
      const breathe = pose(idle, { Chest: [(idle.r.Chest?.[0] ?? 0) + 3, 0, 0] }, [
        root[0],
        root[1] - 0.012,
        root[2],
      ]);
      // Weight shifts from one foot to the other between breaths.
      const shiftL = pose(breathe, { Hips: [hips[0], hips[1], hips[2] + 2.5] }, [
        root[0] + 0.012,
        root[1] - 0.012,
        root[2],
      ]);
      const shiftR = pose(breathe, { Hips: [hips[0], hips[1], hips[2] - 2.5] }, [
        root[0] - 0.012,
        root[1] - 0.012,
        root[2],
      ]);
      return buildPoseClip('idle', 4.8, [
        { t: 0, pose: idle },
        { t: 0.25, pose: shiftL, ease: 'inOut' },
        { t: 0.5, pose: idle, ease: 'inOut' },
        { t: 0.75, pose: shiftR, ease: 'inOut' },
        { t: 1, pose: idle, ease: 'inOut' },
      ]);
    }
  }
}

/**
 * Run cycle: contact → pass (stance leg under the body, swing leg tucked) → flight → mirrored,
 * hips twisting with the legs while the chest counter-twists. The leg geometry is the same for
 * every gait (feet stay planted at the speed the actor moves); the gait reshapes the torso,
 * arms, bounce and rhythm.
 */
export function buildRunClip(idle: Pose, style: MotionStyle): AnimationClip {
  const spineX = idle.r.Spine?.[0] ?? 0;
  let runA = pose(
    STRIDE_A,
    { Spine: [spineX + 8, 0, 0], Hips: [0, 8, 0], Chest: [0, -12, 0] },
    [0, -0.03, 0],
  );
  let passL = pose(STRIDE_PASS, { Spine: [spineX + 9, 0, 0] });
  let lift = 0.045;
  let passR: Pose | null = null;
  const gait = style.gait;
  switch (gait) {
    case 'shamble': {
      // Lurching: the torso rolls over the stance leg, the head lolls, the right leg drags.
      runA = addPose(
        runA,
        d({ Spine: [6, 0, -7], Head: [10, -8, 10], Chest: [0, 6, 0] }, [0, -0.02, 0]),
      );
      passL = addPose(
        passL,
        d(
          { Spine: [8, 0, -9], Head: [14, 0, 12], RightLeg: [-40, 0, 0], RightUpLeg: [10, 0, 0] },
          [0, -0.04, 0],
        ),
      );
      passR = mirror(
        addPose(
          pose(STRIDE_PASS, { Spine: [spineX + 9, 0, 0] }),
          d({ Spine: [6, 0, -4], Head: [8, 0, 4] }),
        ),
      );
      lift = 0.015;
      break;
    }
    case 'scurry':
      runA = addPose(
        runA,
        d(
          {
            Spine: [22, 0, 0],
            Head: [-20, 0, 0],
            LeftArm: [30, 0, 8],
            RightArm: [62, 0, -8],
            LeftLeg: [12, 0, 0],
            RightLeg: [10, 0, 0],
          },
          [0, -0.1, 0],
        ),
      );
      passL = addPose(
        passL,
        d(
          {
            Spine: [24, 0, 0],
            Head: [-22, 0, 0],
            LeftArm: [46, 0, 10],
            RightArm: [46, 0, -10],
            LeftLeg: [14, 0, 0],
          },
          [0, -0.1, 0],
        ),
      );
      lift = 0.03;
      break;
    case 'stomp':
      runA = addPose(
        runA,
        d(
          {
            Spine: [6, 0, 5],
            Chest: [0, -6, 0],
            LeftUpLeg: [0, 0, 6],
            RightUpLeg: [0, 0, -6],
            LeftArm: [0, 0, 18],
            RightArm: [0, 0, -18],
          },
          [0, -0.06, 0],
        ),
      );
      passL = addPose(
        passL,
        d(
          {
            Spine: [6, 0, 7],
            LeftUpLeg: [0, 0, 6],
            RightUpLeg: [0, 0, -8],
            LeftArm: [0, 0, 16],
            RightArm: [0, 0, -16],
          },
          [0, -0.01, 0],
        ),
      );
      lift = 0.0;
      break;
    case 'march':
      runA = addPose(runA, d({ Spine: [-6, 0, 0], Chest: [0, 8, 0] }, [0, 0.005, 0]));
      passL = addPose(passL, d({ Spine: [-6, 0, 0], RightLeg: [-24, 0, 0] }));
      lift = 0.01;
      break;
    case 'glide':
      runA = addPose(
        runA,
        d({ Spine: [-6, 0, 0], Chest: [0, 10, 0], Hips: [0, -4, 0] }, [0, 0.015, 0]),
      );
      passL = addPose(passL, d({ Spine: [-6, 0, 0], RightLeg: [-30, 0, 0] }, [0, 0.012, 0]));
      lift = 0.02;
      break;
    case 'prowl':
      runA = addPose(
        runA,
        d(
          {
            Spine: [16, 0, 0],
            Head: [-16, 0, 0],
            RightArm: [70, 0, -10],
            RightForeArm: [30, 0, 0],
          },
          [0, -0.06, 0],
        ),
      );
      passL = addPose(
        passL,
        d({ Spine: [18, 0, 0], Head: [-18, 0, 0], RightArm: [30, 0, -6] }, [0, -0.06, 0]),
      );
      lift = 0.03;
      break;
    case 'run':
      break;
  }
  const runB = gait === 'prowl' ? keepRightArm(mirror(runA), runA) : mirror(runA);
  const pR = passR ?? (gait === 'prowl' ? keepRightArm(mirror(passL), passL) : mirror(passL));
  // Flight: both feet off the ground between pass and the next contact.
  const flyL = fly(passL, runB, gait, lift);
  const flyR = fly(pR, runA, gait, lift);
  const h = style.holdArms;
  const keys: ClipKey[] = [
    { t: 0, pose: holdArms(runA, idle, h) },
    { t: 0.2, pose: holdArms(passL, idle, h) },
    { t: 0.36, pose: holdArms(flyL, idle, h) },
    { t: 0.5, pose: holdArms(runB, idle, h) },
    { t: 0.7, pose: holdArms(pR, idle, h) },
    { t: 0.86, pose: holdArms(flyR, idle, h) },
    { t: 1, pose: holdArms(runA, idle, h) },
  ];
  return buildPoseClip('run', 0.6, keys);
}

/** Flight pose between a pass and the next contact (the plain run lifts to a fixed height). */
function fly(pass: Pose, next: Pose, gait: MotionStyle['gait'], lift: number): Pose {
  const b = blendPose(pass, next, 0.55);
  const r = b.root ?? [0, 0, 0];
  return pose(b, {}, gait === 'run' ? [0, lift, 0] : [r[0], r[1] + lift, r[2]]);
}

/** Mirrored stride that keeps one arm's trailing grip (blade held low behind). */
function keepRightArm(p: Pose, src: Pose): Pose {
  return pose(p, {
    RightArm: src.r.RightArm ?? [0, 0, 0],
    RightForeArm: src.r.RightForeArm ?? [0, 0, 0],
    RightHand: src.r.RightHand ?? [0, 0, 0],
  });
}

/** Braking from a run: the lead foot plants, the body leans back, then settles. */
export function buildRunStopClip(idle: Pose, style: MotionStyle): AnimationClip {
  const plant = addPose(
    idle,
    d(
      {
        Spine: [-10, 0, 0],
        Chest: [-4, 0, 0],
        Head: [4, 0, 0],
        LeftUpLeg: [-34, 0, 0],
        LeftLeg: [12, 0, 0],
        RightUpLeg: [22, 0, 0],
        RightLeg: [36, 0, 0],
        LeftArm: [-12, 0, 6],
        RightArm: [-12, 0, -6],
      },
      [0, -0.07 - 0.04 * style.weight, 0],
    ),
  );
  return buildPoseClip('run_stop', 0.42, [
    {
      t: 0,
      pose: holdArms(
        pose(STRIDE_A, { Spine: [(idle.r.Spine?.[0] ?? 0) + 12, 0, 0] }, [0, -0.03, 0]),
        idle,
        style.holdArms,
      ),
    },
    { t: 0.3, pose: holdArms(plant, idle, Math.max(0.5, style.holdArms)), ease: 'out' },
    { t: 1, pose: idle, ease: 'inOut' },
  ]);
}
