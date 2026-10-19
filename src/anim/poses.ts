import type { BoneName } from './HumanoidRig';

/** Euler XYZ rotation in degrees. Conventions (character faces +Z): arm/leg forward = −X,
 *  spine lean forward = +X, knee bend = +X, twist toward the character's left = +Y,
 *  left arm outward = +Z, right arm outward = −Z. */
export type Rot = readonly [number, number, number];

export interface Pose {
  readonly r: Partial<Record<Exclude<BoneName, 'Root'>, Rot>>;
  /** Offset of the whole body from the feet origin (crouch, jump, lying down). */
  readonly root?: readonly [number, number, number];
}

export function pose(base: Pose, r: Pose['r'], root?: readonly [number, number, number]): Pose {
  return { r: { ...base.r, ...r }, root: root ?? base.root ?? [0, 0, 0] };
}

/**
 * Per-bone linear blend of two poses (k = 0 → a, 1 → b). k > 1 extrapolates past `b`, used
 * for follow-through overshoot.
 */
export function blendPose(a: Pose, b: Pose, k: number): Pose {
  const out: Record<string, Rot> = {};
  const names = new Set([...Object.keys(a.r), ...Object.keys(b.r)]);
  for (const name of names) {
    const ra = (a.r as Record<string, Rot | undefined>)[name] ?? [0, 0, 0];
    const rb = (b.r as Record<string, Rot | undefined>)[name] ?? [0, 0, 0];
    out[name] = [
      ra[0] + (rb[0] - ra[0]) * k,
      ra[1] + (rb[1] - ra[1]) * k,
      ra[2] + (rb[2] - ra[2]) * k,
    ];
  }
  const pa = a.root ?? [0, 0, 0];
  const pb = b.root ?? [0, 0, 0];
  return {
    r: out,
    root: [pa[0] + (pb[0] - pa[0]) * k, pa[1] + (pb[1] - pa[1]) * k, pa[2] + (pb[2] - pa[2]) * k],
  };
}

/** Mirror a pose left↔right (negate Y/Z rotations, swap sides). */
export function mirror(p: Pose): Pose {
  const out: Record<string, Rot> = {};
  for (const [name, rot] of Object.entries<Rot>(p.r)) {
    const swapped = name.startsWith('Left')
      ? `Right${name.slice(4)}`
      : name.startsWith('Right')
        ? `Left${name.slice(5)}`
        : name;
    out[swapped] = [rot[0], -rot[1], -rot[2]];
  }
  const root = p.root ?? [0, 0, 0];
  return { r: out, root: [-root[0], root[1], root[2]] };
}

export const NEUTRAL: Pose = {
  r: {
    Spine: [3, 0, 0],
    Chest: [2, 0, 0],
    LeftArm: [-8, 0, 12],
    RightArm: [-8, 0, -12],
    LeftForeArm: [-20, 0, 0],
    RightForeArm: [-20, 0, 0],
    LeftUpLeg: [-2, 0, 3],
    RightUpLeg: [-2, 0, -3],
    LeftLeg: [4, 0, 0],
    RightLeg: [4, 0, 0],
  },
  root: [0, 0, 0],
};

/** Blades held forward, slight crouch: Kael's combat stance. */
export const READY: Pose = pose(
  NEUTRAL,
  {
    Spine: [8, 0, 0],
    LeftArm: [-35, 0, 22],
    RightArm: [-35, 0, -22],
    LeftForeArm: [-55, 0, 0],
    RightForeArm: [-55, 0, 0],
    LeftUpLeg: [-12, 0, 6],
    RightUpLeg: [-4, 0, -6],
    LeftLeg: [18, 0, 0],
    RightLeg: [12, 0, 0],
  },
  [0, -0.04, 0],
);

export const HUNCHED: Pose = pose(NEUTRAL, {
  Spine: [16, 0, 0],
  Chest: [8, 0, 0],
  Head: [-12, 0, 0],
  LeftArm: [-15, 0, 14],
  RightArm: [-22, 0, -14],
  LeftForeArm: [-35, 0, 0],
  RightForeArm: [-40, 0, 0],
});

export const STRIDE_A: Pose = pose(NEUTRAL, {
  Spine: [12, 0, 0],
  Chest: [0, -8, 0],
  LeftUpLeg: [-38, 0, 2],
  LeftLeg: [12, 0, 0],
  RightUpLeg: [28, 0, -2],
  RightLeg: [65, 0, 0],
  LeftArm: [30, 0, 10],
  RightArm: [-38, 0, -10],
  LeftForeArm: [-30, 0, 0],
  RightForeArm: [-60, 0, 0],
});

export const STRIDE_PASS: Pose = pose(
  NEUTRAL,
  {
    Spine: [12, 0, 0],
    LeftUpLeg: [-8, 0, 2],
    LeftLeg: [35, 0, 0],
    RightUpLeg: [-8, 0, -2],
    RightLeg: [35, 0, 0],
    LeftArm: [-4, 0, 10],
    RightArm: [-4, 0, -10],
    LeftForeArm: [-40, 0, 0],
    RightForeArm: [-40, 0, 0],
  },
  [0, 0.05, 0],
);

/** Lying on the back (knockdown / death). */
export const LYING: Pose = pose(
  NEUTRAL,
  {
    Hips: [-84, 0, 0],
    Spine: [-4, 0, 0],
    Head: [10, 0, 0],
    LeftArm: [-20, 0, 70],
    RightArm: [-20, 0, -70],
    LeftForeArm: [-10, 0, 0],
    RightForeArm: [-10, 0, 0],
    LeftUpLeg: [-15, 0, 8],
    RightUpLeg: [-5, 0, -8],
    LeftLeg: [25, 0, 0],
    RightLeg: [8, 0, 0],
  },
  [0, -0.78, 0],
);

export const CROUCH: Pose = pose(
  NEUTRAL,
  {
    Spine: [25, 0, 0],
    LeftUpLeg: [-55, 0, 8],
    RightUpLeg: [-40, 0, -8],
    LeftLeg: [80, 0, 0],
    RightLeg: [70, 0, 0],
    LeftArm: [20, 0, 20],
    RightArm: [20, 0, -20],
  },
  [0, -0.25, 0],
);

export const STAGGERED: Pose = pose(
  NEUTRAL,
  {
    Spine: [28, 0, 0],
    Chest: [10, 0, 0],
    Head: [25, 0, 0],
    LeftArm: [8, 0, 18],
    RightArm: [8, 0, -18],
    LeftForeArm: [-10, 0, 0],
    RightForeArm: [-10, 0, 0],
    LeftUpLeg: [-20, 0, 6],
    LeftLeg: [30, 0, 0],
  },
  [0, -0.1, 0],
);

// ---- Kael attack poses (right-hand versions; left versions are mirrored) ----
export const SLASH_R_WIND: Pose = pose(READY, {
  Spine: [6, -10, 0],
  Chest: [0, -42, 0],
  RightArm: [-70, 0, -78],
  RightForeArm: [-30, 0, 0],
  LeftArm: [-30, 0, 20],
});
export const SLASH_R_HIT: Pose = pose(READY, {
  Spine: [14, 12, 0],
  Chest: [4, 46, 0],
  RightArm: [-86, 0, -6],
  RightForeArm: [-8, 0, 0],
  LeftArm: [-20, 0, 25],
  LeftUpLeg: [-30, 0, 6],
  LeftLeg: [30, 0, 0],
});
export const CROSS_WIND: Pose = pose(READY, {
  Spine: [-6, 0, 0],
  LeftArm: [-115, 0, 70],
  RightArm: [-115, 0, -70],
  LeftForeArm: [-25, 0, 0],
  RightForeArm: [-25, 0, 0],
});
export const CROSS_HIT: Pose = pose(READY, {
  Spine: [26, 0, 0],
  LeftArm: [-60, 0, -28],
  RightArm: [-60, 0, 28],
  LeftForeArm: [-10, 0, 0],
  RightForeArm: [-10, 0, 0],
  LeftUpLeg: [-35, 0, 6],
  LeftLeg: [40, 0, 0],
});
export const ARMS_WIDE: Pose = pose(READY, {
  Spine: [12, 0, 0],
  LeftArm: [-10, 0, 85],
  RightArm: [-10, 0, -85],
  LeftForeArm: [0, 0, 0],
  RightForeArm: [0, 0, 0],
});
export const OVERHEAD_WIND: Pose = pose(
  READY,
  {
    Spine: [-16, 0, 0],
    LeftArm: [-168, 0, 16],
    RightArm: [-168, 0, -16],
    LeftForeArm: [-20, 0, 0],
    RightForeArm: [-20, 0, 0],
  },
  [0, -0.12, 0],
);
export const OVERHEAD_HIT: Pose = pose(
  READY,
  {
    Spine: [36, 0, 0],
    Chest: [10, 0, 0],
    LeftArm: [-35, 0, 12],
    RightArm: [-35, 0, -12],
    LeftForeArm: [-5, 0, 0],
    RightForeArm: [-5, 0, 0],
    LeftUpLeg: [-45, 0, 6],
    LeftLeg: [55, 0, 0],
    RightUpLeg: [10, 0, -6],
  },
  [0, -0.22, 0],
);
export const DASH_LEAN: Pose = pose(READY, {
  Spine: [42, 0, 0],
  Chest: [8, 0, 0],
  LeftArm: [55, 0, 35],
  RightArm: [55, 0, -35],
  LeftForeArm: [-10, 0, 0],
  RightForeArm: [-10, 0, 0],
  LeftUpLeg: [-50, 0, 4],
  LeftLeg: [30, 0, 0],
  RightUpLeg: [35, 0, -4],
  RightLeg: [50, 0, 0],
});

// ---- Brann (greatsword, two hands) ----
/** Low guard: the greatsword held across the body, point forward and down. */
export const GS_READY: Pose = pose(
  NEUTRAL,
  {
    Spine: [10, 10, 0],
    Chest: [2, 12, 0],
    RightArm: [-12, 0, -20],
    RightForeArm: [-15, 0, 0],
    LeftArm: [-30, 0, -10],
    LeftForeArm: [-45, 0, 0],
    LeftUpLeg: [-14, 0, 8],
    RightUpLeg: [-2, 0, -8],
    LeftLeg: [18, 0, 0],
  },
  [0, -0.08, 0],
);
export const GS_SIDE_WIND: Pose = pose(READY, {
  Spine: [6, -18, 0],
  Chest: [0, -48, 0],
  RightArm: [-55, 0, -75],
  RightForeArm: [-40, 0, 0],
  LeftArm: [-80, 0, -10],
  LeftForeArm: [-50, 0, 0],
});
export const GS_SIDE_HIT: Pose = pose(READY, {
  Spine: [16, 20, 0],
  Chest: [6, 50, 0],
  RightArm: [-80, 0, 10],
  RightForeArm: [-10, 0, 0],
  LeftArm: [-70, 0, 40],
  LeftForeArm: [-15, 0, 0],
  LeftUpLeg: [-35, 0, 6],
  LeftLeg: [35, 0, 0],
});
export const CHARGE_HOLD: Pose = pose(
  OVERHEAD_WIND,
  {
    Spine: [-24, 0, 0],
    Chest: [-8, 0, 0],
    LeftUpLeg: [-20, 0, 8],
    RightUpLeg: [15, 0, -8],
    RightLeg: [25, 0, 0],
  },
  [0, -0.2, 0],
);
export const SHOULDER: Pose = pose(DASH_LEAN, {
  Chest: [10, 30, 0],
  LeftArm: [-20, 0, 10],
  LeftForeArm: [-100, 0, 0],
  RightArm: [30, 0, -20],
});

// ---- Lyra (bow in the left hand, dagger in the right) ----
export const BOW_DRAW: Pose = pose(NEUTRAL, {
  Spine: [4, 30, 0],
  Chest: [0, 25, 0],
  Head: [0, -45, 0],
  LeftArm: [-90, 0, 20],
  LeftForeArm: [-5, 0, 0],
  RightArm: [-85, 0, -35],
  RightForeArm: [-125, 0, 0],
  LeftUpLeg: [-10, 0, 8],
  RightUpLeg: [6, 0, -8],
});
export const BOW_RELEASE: Pose = pose(BOW_DRAW, {
  RightArm: [-70, 0, -75],
  RightForeArm: [-30, 0, 0],
});
export const AIM_UP: Pose = pose(BOW_DRAW, {
  Spine: [-12, 30, 0],
  Chest: [-15, 25, 0],
  Head: [-30, -45, 0],
  LeftArm: [-150, 0, 20],
  RightArm: [-140, 0, -35],
});
export const AIM_UP_RELEASE: Pose = pose(AIM_UP, {
  RightArm: [-120, 0, -75],
  RightForeArm: [-30, 0, 0],
});

// ---- Casters ----
export const CAST_WIND: Pose = pose(NEUTRAL, {
  Spine: [-8, 0, 0],
  Chest: [-6, 0, 0],
  Head: [-12, 0, 0],
  LeftArm: [-150, 0, 30],
  RightArm: [-150, 0, -30],
  LeftForeArm: [-30, 0, 0],
  RightForeArm: [-30, 0, 0],
});
export const CAST_HIT: Pose = pose(NEUTRAL, {
  Spine: [18, 0, 0],
  Chest: [8, 0, 0],
  LeftArm: [-85, 0, 8],
  RightArm: [-85, 0, -8],
  LeftForeArm: [-5, 0, 0],
  RightForeArm: [-5, 0, 0],
  LeftUpLeg: [-25, 0, 6],
  LeftLeg: [25, 0, 0],
});

// ---- Enemy poses ----
export const CLUB_WIND: Pose = pose(HUNCHED, {
  Spine: [-10, 0, 0],
  Chest: [0, -22, 0],
  RightArm: [-165, 0, -14],
  RightForeArm: [-35, 0, 0],
  LeftArm: [-30, 0, 25],
});
export const CLUB_HIT: Pose = pose(HUNCHED, {
  Spine: [32, 0, 0],
  Chest: [0, 20, 0],
  RightArm: [-38, 0, -8],
  RightForeArm: [-8, 0, 0],
  LeftUpLeg: [-30, 0, 4],
  LeftLeg: [35, 0, 0],
});
export const POUNCE_WIND: Pose = pose(
  HUNCHED,
  {
    Spine: [36, 0, 0],
    LeftArm: [50, 0, 22],
    RightArm: [50, 0, -22],
    LeftUpLeg: [-50, 0, 8],
    RightUpLeg: [-50, 0, -8],
    LeftLeg: [75, 0, 0],
    RightLeg: [75, 0, 0],
  },
  [0, -0.16, 0],
);
export const POUNCE_HIT: Pose = pose(
  HUNCHED,
  {
    Spine: [44, 0, 0],
    LeftArm: [-105, 0, 12],
    RightArm: [-105, 0, -12],
    LeftForeArm: [-5, 0, 0],
    RightForeArm: [-5, 0, 0],
    LeftUpLeg: [-20, 0, 6],
    RightUpLeg: [25, 0, -6],
  },
  [0, -0.04, 0],
);
export const SLAM_WIND: Pose = pose(
  HUNCHED,
  {
    Spine: [-22, 0, 0],
    LeftArm: [-172, 0, 8],
    RightArm: [-172, 0, -8],
    LeftForeArm: [-25, 0, 0],
    RightForeArm: [-25, 0, 0],
  },
  [0, 0.04, 0],
);
export const SLAM_HIT: Pose = pose(
  HUNCHED,
  {
    Spine: [42, 0, 0],
    Chest: [10, 0, 0],
    LeftArm: [-40, 0, 6],
    RightArm: [-40, 0, -6],
    LeftForeArm: [-5, 0, 0],
    RightForeArm: [-5, 0, 0],
    LeftUpLeg: [-40, 0, 10],
    RightUpLeg: [-30, 0, -10],
    LeftLeg: [55, 0, 0],
    RightLeg: [45, 0, 0],
  },
  [0, -0.18, 0],
);
export const SWEEP_WIND: Pose = pose(NEUTRAL, {
  Spine: [6, -12, 0],
  Chest: [0, -62, 0],
  RightArm: [-78, 0, -82],
  RightForeArm: [-25, 0, 0],
  LeftArm: [-55, 0, -10],
  LeftForeArm: [-60, 0, 0],
});
export const SWEEP_HIT: Pose = pose(NEUTRAL, {
  Spine: [14, 15, 0],
  Chest: [4, 62, 0],
  RightArm: [-88, 0, 4],
  RightForeArm: [-5, 0, 0],
  LeftArm: [-30, 0, 30],
  LeftUpLeg: [-30, 0, 6],
  LeftLeg: [30, 0, 0],
});
export const THRUST_WIND: Pose = pose(NEUTRAL, {
  Spine: [-8, -15, 0],
  Chest: [0, -30, 0],
  RightArm: [35, 0, -25],
  RightForeArm: [-95, 0, 0],
  LeftArm: [-50, 0, 20],
  RightUpLeg: [20, 0, -4],
});
export const THRUST_HIT: Pose = pose(NEUTRAL, {
  Spine: [26, 5, 0],
  Chest: [4, 12, 0],
  RightArm: [-92, 0, 2],
  RightForeArm: [-4, 0, 0],
  LeftArm: [15, 0, 30],
  LeftUpLeg: [-45, 0, 6],
  LeftLeg: [50, 0, 0],
  RightUpLeg: [25, 0, -4],
});
export const ROAR: Pose = pose(NEUTRAL, {
  Spine: [-20, 0, 0],
  Chest: [-8, 0, 0],
  Head: [-25, 0, 0],
  LeftArm: [-35, 0, 70],
  RightArm: [-35, 0, -70],
  LeftForeArm: [-40, 0, 0],
  RightForeArm: [-40, 0, 0],
});

export const POSE_LIBRARY = {
  NEUTRAL,
  READY,
  HUNCHED,
  CROUCH,
  STAGGERED,
  LYING,
  SLASH_R_WIND,
  SLASH_R_HIT,
  SLASH_L_WIND: mirror(SLASH_R_WIND),
  SLASH_L_HIT: mirror(SLASH_R_HIT),
  CROSS_WIND,
  CROSS_HIT,
  ARMS_WIDE,
  OVERHEAD_WIND,
  OVERHEAD_HIT,
  DASH_LEAN,
  GS_READY,
  GS_SIDE_WIND,
  GS_SIDE_HIT,
  // Backhand cleave = the side cleave reversed.
  GS_BACK_WIND: GS_SIDE_HIT,
  GS_BACK_HIT: GS_SIDE_WIND,
  CHARGE_HOLD,
  SHOULDER,
  BOW_DRAW,
  BOW_RELEASE,
  AIM_UP,
  AIM_UP_RELEASE,
  CAST_WIND,
  CAST_HIT,
  CLUB_WIND,
  CLUB_HIT,
  POUNCE_WIND,
  POUNCE_HIT,
  SLAM_WIND,
  SLAM_HIT,
  SWEEP_WIND,
  SWEEP_HIT,
  // Backhand with the same (right) sword arm = the forward sweep played in reverse.
  SWEEP_BACK_WIND: SWEEP_HIT,
  SWEEP_BACK_HIT: SWEEP_WIND,
  THRUST_WIND,
  THRUST_HIT,
  ROAR,
} as const;

export type PoseName = keyof typeof POSE_LIBRARY;
