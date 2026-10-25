import type { AnimationClip } from 'three';
import { buildPoseClip, type ClipKey } from './clipBuilder';
import { CROUCH, NEUTRAL, addPose, pose, type Pose } from './poses';

/**
 * Per-hero flavour clips: idle variants (played now and then when standing still), a victory
 * pose, and a dodge that suits the class (a combat roll, a shield charge, an arcane glide…).
 */

/** Offsets for `addPose`. */
function d(r: Pose['r'], root: readonly [number, number, number] = [0, 0, 0]): Pose {
  return { r, root };
}

/** `p` with one bone's rotation replaced by `base` + (dx, dy, dz). */
function turn(p: Pose, bone: keyof Pose['r'], dx: number, dy = 0, dz = 0): Pose {
  const b = p.r[bone] ?? [0, 0, 0];
  return pose(p, { [bone]: [b[0] + dx, b[1] + dy, b[2] + dz] });
}

/**
 * Full turns of `bone` about X between two clip fractions (blade / staff twirls), in quarter
 * turns. The last key is `base` itself (a whole number of turns later), so eased keys that
 * follow never unwind the spin.
 */
function twirl(
  base: Pose,
  bones: keyof Pose['r'] | readonly (keyof Pose['r'])[],
  from: number,
  to: number,
  turns = 1,
): ClipKey[] {
  const keys: ClipKey[] = [];
  const list = typeof bones === 'string' ? [bones] : bones;
  const steps = Math.round(turns * 4);
  for (let i = 1; i <= steps; i++) {
    const t = from + ((to - from) * i) / steps;
    let p = base;
    if (i < steps) for (const b of list) p = turn(p, b, (360 * turns * i) / steps);
    keys.push({ t, pose: p });
  }
  return keys;
}

export type DodgeStyle =
  'roll' | 'heavyRoll' | 'shieldDash' | 'glide' | 'flip' | 'vault' | 'wraith';
export type BackDodgeStyle = 'hop' | 'backflip' | 'shieldStep' | 'slide';

interface HeroMoveSet {
  readonly idles: readonly ((idle: Pose) => { sec: number; keys: ClipKey[] })[];
  readonly victory: (idle: Pose) => ClipKey[];
  readonly dodge: DodgeStyle;
  readonly backDodge: BackDodgeStyle;
}

/** Looks over one shoulder, then the other (shared by several heroes). */
const lookAround = (idle: Pose): { sec: number; keys: ClipKey[] } => {
  const left = addPose(idle, d({ Head: [4, 50, 0], Chest: [0, 18, 0], Spine: [0, 8, 0] }));
  const right = addPose(idle, d({ Head: [2, -44, 0], Chest: [0, -16, 0], Spine: [0, -6, 0] }));
  return {
    sec: 2.8,
    keys: [
      { t: 0, pose: idle },
      { t: 0.22, pose: left, ease: 'inOut' },
      { t: 0.42, pose: addPose(left, d({ Head: [6, 4, 0] })), ease: 'inOut' },
      { t: 0.66, pose: right, ease: 'inOut' },
      { t: 0.8, pose: right, ease: 'inOut' },
      { t: 1, pose: idle, ease: 'inOut' },
    ],
  };
};

const MOVES: Readonly<Record<string, HeroMoveSet>> = {
  kael: {
    idles: [
      // Spins both blades, one after the other, watching them.
      (idle) => {
        const watchR = addPose(
          idle,
          d({ Head: [10, -18, 0], RightForeArm: [-12, 0, 0], RightArm: [-8, 0, 0] }),
        );
        const watchL = addPose(
          idle,
          d({ Head: [10, 18, 0], LeftForeArm: [-12, 0, 0], LeftArm: [-8, 0, 0] }),
        );
        return {
          sec: 2.4,
          keys: [
            { t: 0, pose: idle },
            { t: 0.12, pose: watchR, ease: 'inOut' },
            ...twirl(watchR, 'RightHand', 0.14, 0.42),
            { t: 0.52, pose: watchL, ease: 'inOut' },
            ...twirl(watchL, 'LeftHand', 0.54, 0.82),
            { t: 1, pose: idle, ease: 'inOut' },
          ],
        };
      },
      lookAround,
    ],
    victory: (idle) => {
      const wide = pose(idle, {
        Spine: [4, 0, 0],
        LeftArm: [-20, 0, 70],
        RightArm: [-20, 0, -70],
        LeftForeArm: [-20, 0, 0],
        RightForeArm: [-20, 0, 0],
      });
      const cross = pose(
        idle,
        {
          Spine: [10, 0, 0],
          Chest: [6, 0, 0],
          Head: [18, 0, 0],
          LeftArm: [-62, 0, -22],
          RightArm: [-62, 0, 22],
          LeftForeArm: [-88, 0, 0],
          RightForeArm: [-88, 0, 0],
          LeftHand: [-10, 0, 0],
          RightHand: [-10, 0, 0],
          LeftUpLeg: [-16, 0, 8],
          RightUpLeg: [8, 0, -10],
          LeftLeg: [20, 0, 0],
        },
        [0, -0.06, 0],
      );
      return [
        { t: 0, pose: idle },
        { t: 0.14, pose: wide, ease: 'out' },
        ...twirl(wide, ['RightHand', 'LeftHand'], 0.15, 0.4),
        { t: 0.52, pose: cross, ease: 'snap' },
        { t: 0.78, pose: addPose(cross, d({ Head: [4, 0, 0] })), ease: 'inOut' },
        { t: 1, pose: addPose(cross, d({ Head: [-20, 0, 0], Chest: [-6, 0, 0] })), ease: 'inOut' },
      ];
    },
    dodge: 'roll',
    backDodge: 'hop',
  },
  brann: {
    idles: [
      // Hefts the greatsword onto his shoulder, rolls it, lowers it.
      (idle) => {
        const shoulder = pose(idle, {
          Spine: [4, 6, 0],
          Chest: [-2, 10, 0],
          RightArm: [-142, 0, -34],
          RightForeArm: [-112, 0, 0],
          RightHand: [-20, 0, 0],
          LeftArm: [-6, 0, 12],
          LeftForeArm: [-18, 0, 0],
          Head: [-4, -10, 0],
        });
        return {
          sec: 3.2,
          keys: [
            { t: 0, pose: idle },
            { t: 0.22, pose: shoulder, ease: 'inOut' },
            {
              t: 0.42,
              pose: addPose(shoulder, d({ Chest: [0, -6, 0], Head: [0, 16, 0] })),
              ease: 'inOut',
            },
            {
              t: 0.66,
              pose: addPose(shoulder, d({ Chest: [4, 4, 0], Head: [6, -6, 0] }, [0, -0.02, 0])),
              ease: 'inOut',
            },
            { t: 1, pose: idle, ease: 'inOut' },
          ],
        };
      },
      // Neck roll and a heavy breath.
      (idle) => ({
        sec: 2.6,
        keys: [
          { t: 0, pose: idle },
          { t: 0.2, pose: addPose(idle, d({ Head: [0, 0, 18] })), ease: 'inOut' },
          { t: 0.38, pose: addPose(idle, d({ Head: [18, 0, 0] })), ease: 'inOut' },
          { t: 0.56, pose: addPose(idle, d({ Head: [0, 0, -18] })), ease: 'inOut' },
          {
            t: 0.76,
            pose: addPose(idle, d({ Chest: [-6, 0, 0], Head: [-8, 0, 0] }, [0, 0.02, 0])),
            ease: 'inOut',
          },
          { t: 1, pose: idle, ease: 'inOut' },
        ],
      }),
    ],
    victory: (idle) => {
      const raise = pose(idle, {
        Spine: [-10, 0, 0],
        Chest: [-6, 0, 0],
        RightArm: [-170, 0, -12],
        RightForeArm: [-14, 0, 0],
        LeftArm: [-150, 0, 14],
        LeftForeArm: [-20, 0, 0],
        Head: [-10, 0, 0],
      });
      const plant = pose(NEUTRAL, {
        Spine: [6, 0, 0],
        Chest: [-8, 0, 0],
        Head: [-6, 0, 0],
        RightArm: [-32, 0, 12],
        RightForeArm: [-36, 0, 0],
        RightHand: [98, 0, 0],
        LeftArm: [-30, 0, -14],
        LeftForeArm: [-40, 0, 0],
        LeftUpLeg: [-6, 0, 12],
        RightUpLeg: [-4, 0, -12],
      });
      return [
        { t: 0, pose: idle },
        { t: 0.24, pose: raise, ease: 'inOut' },
        { t: 0.36, pose: addPose(raise, d({ Chest: [-4, 0, 0] })), ease: 'inOut' },
        { t: 0.5, pose: pose(plant, {}, [0, -0.08, 0]), ease: 'snap' },
        { t: 0.7, pose: plant, ease: 'out' },
        { t: 1, pose: addPose(plant, d({ Chest: [-4, 0, 0], Head: [-6, 0, 0] })), ease: 'inOut' },
      ];
    },
    dodge: 'heavyRoll',
    backDodge: 'hop',
  },
  lyra: {
    idles: [
      // Tests the bowstring: half draw, a long look down the arrow, ease off.
      (idle) => {
        const draw = pose(idle, {
          Spine: [4, 26, 0],
          Chest: [0, 20, 0],
          Head: [0, -40, 0],
          LeftArm: [-84, 0, 18],
          LeftForeArm: [-8, 0, 0],
          RightArm: [-80, 0, -30],
          RightForeArm: [-110, 0, 0],
        });
        return {
          sec: 2.8,
          keys: [
            { t: 0, pose: idle },
            { t: 0.3, pose: draw, ease: 'inOut' },
            {
              t: 0.6,
              pose: addPose(draw, d({ RightForeArm: [-10, 0, 0], Head: [4, -4, 0] })),
              ease: 'inOut',
            },
            { t: 1, pose: idle, ease: 'inOut' },
          ],
        };
      },
      lookAround,
    ],
    victory: (idle) => {
      const spin = pose(idle, { RightArm: [-40, 0, -50], RightForeArm: [-60, 0, 0] });
      const raise = pose(idle, {
        Spine: [-8, 0, 0],
        Chest: [-6, 0, 0],
        Head: [-16, 0, 0],
        LeftArm: [-172, 0, 10],
        LeftForeArm: [-6, 0, 0],
        RightArm: [-10, 0, -20],
        RightForeArm: [-30, 0, 0],
        LeftUpLeg: [-8, 0, 6],
        RightUpLeg: [10, 0, -6],
      });
      return [
        { t: 0, pose: idle },
        { t: 0.1, pose: spin, ease: 'out' },
        ...twirl(spin, 'RightHand', 0.12, 0.36, 2),
        { t: 0.56, pose: raise, ease: 'snap' },
        { t: 0.8, pose: addPose(raise, d({ LeftArm: [4, 0, 0] })), ease: 'inOut' },
        { t: 1, pose: addPose(raise, d({ Head: [4, 0, 0] })), ease: 'inOut' },
      ];
    },
    dodge: 'roll',
    backDodge: 'backflip',
  },
  garrick: {
    idles: [
      // Taps the hammer against the shield twice.
      (idle) => {
        const back = pose(idle, {
          RightArm: [-60, 0, -40],
          RightForeArm: [-70, 0, 0],
          Chest: [0, -8, 0],
        });
        const tap = pose(idle, {
          RightArm: [-58, 0, 8],
          RightForeArm: [-50, 0, 0],
          Chest: [0, 14, 0],
          Head: [0, 10, 0],
        });
        return {
          sec: 2.4,
          keys: [
            { t: 0, pose: idle },
            { t: 0.2, pose: back, ease: 'inOut' },
            { t: 0.3, pose: tap, ease: 'snap' },
            { t: 0.42, pose: back, ease: 'out' },
            { t: 0.52, pose: tap, ease: 'snap' },
            { t: 0.66, pose: addPose(tap, d({ Head: [-6, 0, 0] })), ease: 'out' },
            { t: 1, pose: idle, ease: 'inOut' },
          ],
        };
      },
      // Rolls the shoulders and resets the shield.
      (idle) => ({
        sec: 2.6,
        keys: [
          { t: 0, pose: idle },
          {
            t: 0.25,
            pose: addPose(
              idle,
              d(
                {
                  Chest: [-6, 0, 0],
                  LeftArm: [10, 0, 6],
                  LeftForeArm: [14, 0, 0],
                  RightArm: [0, 0, -8],
                },
                [0, 0.02, 0],
              ),
            ),
            ease: 'inOut',
          },
          {
            t: 0.5,
            pose: addPose(idle, d({ Chest: [6, 0, 0], LeftArm: [-8, 0, 0] }, [0, -0.03, 0])),
            ease: 'inOut',
          },
          {
            t: 0.62,
            pose: addPose(idle, d({ LeftArm: [-4, 0, 0], Head: [0, -12, 0] })),
            ease: 'snap',
          },
          { t: 1, pose: idle, ease: 'inOut' },
        ],
      }),
    ],
    victory: (idle) => {
      const raise = pose(
        idle,
        {
          Spine: [-10, 0, 0],
          Chest: [-10, 0, 0],
          Head: [-20, 0, 0],
          RightArm: [-172, 0, -16],
          RightForeArm: [-18, 0, 0],
          LeftArm: [-30, 0, 18],
          LeftForeArm: [-50, 0, 0],
          LeftHand: [80, 0, 0],
          LeftUpLeg: [-14, 0, 10],
          RightUpLeg: [6, 0, -12],
        },
        [0, -0.04, 0],
      );
      return [
        { t: 0, pose: idle },
        { t: 0.2, pose: pose(idle, { Spine: [20, 0, 0] }, [0, -0.12, 0]), ease: 'inOut' },
        { t: 0.46, pose: raise, ease: 'snap' },
        { t: 0.7, pose: addPose(raise, d({ RightArm: [6, 0, 0] })), ease: 'inOut' },
        { t: 1, pose: addPose(raise, d({ Head: [6, 0, 0] })), ease: 'inOut' },
      ];
    },
    dodge: 'shieldDash',
    backDodge: 'shieldStep',
  },
  seraphine: {
    idles: [
      // Twirls the staff in front of her and sets it down.
      (idle) => {
        const hold = pose(idle, {
          RightArm: [-60, 0, -10],
          RightForeArm: [-50, 0, 0],
          Head: [8, -10, 0],
        });
        return {
          sec: 2.4,
          keys: [
            { t: 0, pose: idle },
            { t: 0.16, pose: hold, ease: 'inOut' },
            ...twirl(hold, 'RightHand', 0.18, 0.7, 2),
            { t: 1, pose: idle, ease: 'inOut' },
          ],
        };
      },
      // Gazes into an ember cupped in her free hand.
      (idle) => {
        const cup = pose(idle, {
          LeftArm: [-40, 0, 12],
          LeftForeArm: [-100, 0, 0],
          LeftHand: [-30, 0, 0],
          Head: [24, 22, 0],
          Chest: [4, 8, 0],
        });
        return {
          sec: 3,
          keys: [
            { t: 0, pose: idle },
            { t: 0.25, pose: cup, ease: 'inOut' },
            { t: 0.7, pose: addPose(cup, d({ Head: [4, -6, 6] })), ease: 'inOut' },
            { t: 1, pose: idle, ease: 'inOut' },
          ],
        };
      },
    ],
    victory: (idle) => {
      const hold = pose(idle, { RightArm: [-60, 0, -10], RightForeArm: [-50, 0, 0] });
      const flare = pose(idle, {
        Spine: [-6, -8, 0],
        Chest: [-4, -6, 0],
        Head: [-14, 10, 0],
        RightArm: [-14, 0, -18],
        RightForeArm: [-30, 0, 0],
        RightHand: [-10, 0, 0],
        LeftArm: [-150, 0, 34],
        LeftForeArm: [-26, 0, 0],
        LeftHand: [-20, 0, 0],
        LeftUpLeg: [-6, 0, 4],
        RightUpLeg: [8, 0, -8],
      });
      return [
        { t: 0, pose: idle },
        { t: 0.12, pose: hold, ease: 'out' },
        ...twirl(hold, 'RightHand', 0.14, 0.44, 2),
        { t: 0.58, pose: flare, ease: 'snap' },
        { t: 0.8, pose: addPose(flare, d({ LeftArm: [-4, 0, 0] }, [0, 0.01, 0])), ease: 'inOut' },
        { t: 1, pose: addPose(flare, d({ Head: [4, 0, 0] })), ease: 'inOut' },
      ];
    },
    dodge: 'glide',
    backDodge: 'slide',
  },
  ryn: {
    idles: [
      // Shadow boxing: two quick jabs and a cross.
      (idle) => {
        const jab = pose(idle, {
          LeftArm: [-86, 0, 6],
          LeftForeArm: [-8, 0, 0],
          Chest: [2, 18, 0],
        });
        const cross = pose(idle, {
          RightArm: [-88, 0, 0],
          RightForeArm: [-6, 0, 0],
          Chest: [2, 28, 0],
          Spine: [12, 12, 0],
        });
        return {
          sec: 1.8,
          keys: [
            { t: 0, pose: idle },
            { t: 0.12, pose: jab, ease: 'snap' },
            { t: 0.24, pose: idle, ease: 'out' },
            { t: 0.32, pose: jab, ease: 'snap' },
            { t: 0.44, pose: idle, ease: 'out' },
            { t: 0.54, pose: cross, ease: 'snap' },
            { t: 0.72, pose: idle, ease: 'out' },
            { t: 1, pose: idle },
          ],
        };
      },
      // Bounces on the balls of the feet and loosens the neck.
      (idle) => {
        const up = addPose(idle, d({ LeftLeg: [-10, 0, 0], RightLeg: [-8, 0, 0] }, [0, 0.04, 0]));
        const down = addPose(idle, d({ LeftLeg: [8, 0, 0], RightLeg: [8, 0, 0] }, [0, -0.02, 0]));
        return {
          sec: 2.2,
          keys: [
            { t: 0, pose: idle },
            { t: 0.1, pose: up, ease: 'out' },
            { t: 0.2, pose: down, ease: 'in' },
            { t: 0.3, pose: up, ease: 'out' },
            { t: 0.4, pose: down, ease: 'in' },
            { t: 0.55, pose: addPose(idle, d({ Head: [0, 0, 20] })), ease: 'inOut' },
            { t: 0.72, pose: addPose(idle, d({ Head: [0, 0, -20] })), ease: 'inOut' },
            { t: 1, pose: idle, ease: 'inOut' },
          ],
        };
      },
    ],
    victory: (idle) => {
      // Fist into palm, a short bow.
      const salute = pose(NEUTRAL, {
        Spine: [6, 0, 0],
        LeftArm: [-58, 0, -28],
        LeftForeArm: [-78, 0, 0],
        LeftHand: [0, 0, 0],
        RightArm: [-58, 0, 28],
        RightForeArm: [-80, 0, 0],
        LeftUpLeg: [-2, 0, 4],
        RightUpLeg: [-2, 0, -4],
      });
      return [
        { t: 0, pose: idle },
        {
          t: 0.2,
          pose: pose(idle, { RightArm: [-150, 0, -30], RightForeArm: [-30, 0, 0] }, [0, -0.03, 0]),
          ease: 'out',
        },
        { t: 0.42, pose: salute, ease: 'snap' },
        {
          t: 0.62,
          pose: addPose(salute, d({ Spine: [24, 0, 0], Head: [10, 0, 0] })),
          ease: 'inOut',
        },
        { t: 0.82, pose: salute, ease: 'inOut' },
        { t: 1, pose: addPose(salute, d({ Head: [-4, 0, 0] })), ease: 'inOut' },
      ];
    },
    dodge: 'flip',
    backDodge: 'backflip',
  },
  valka: {
    idles: [
      // Spins the spear overhead and catches it back in guard.
      (idle) => {
        const up = pose(idle, {
          RightArm: [-150, 0, -24],
          RightForeArm: [-20, 0, 0],
          Head: [-14, 0, 0],
          Spine: [-4, 0, 0],
        });
        return {
          sec: 2.4,
          keys: [
            { t: 0, pose: idle },
            { t: 0.18, pose: up, ease: 'inOut' },
            ...twirl(up, 'RightHand', 0.2, 0.62, 2),
            { t: 0.78, pose: addPose(idle, d({ Spine: [6, 0, 0] }, [0, -0.04, 0])), ease: 'snap' },
            { t: 1, pose: idle, ease: 'inOut' },
          ],
        };
      },
      // Plants the spear and looks to the horizon.
      (idle) => {
        const plant = pose(idle, {
          RightArm: [-30, 0, -10],
          RightForeArm: [-60, 0, 0],
          RightHand: [-62, 0, 0],
          LeftArm: [-4, 0, 10],
          LeftForeArm: [-20, 0, 0],
          Spine: [2, 0, 0],
          Head: [-8, 20, 0],
        });
        return {
          sec: 3,
          keys: [
            { t: 0, pose: idle },
            { t: 0.25, pose: plant, ease: 'inOut' },
            { t: 0.7, pose: addPose(plant, d({ Head: [0, -30, 0] })), ease: 'inOut' },
            { t: 1, pose: idle, ease: 'inOut' },
          ],
        };
      },
    ],
    victory: (idle) => {
      const up = pose(idle, {
        RightArm: [-150, 0, -24],
        RightForeArm: [-20, 0, 0],
        Head: [-14, 0, 0],
      });
      const proud = pose(NEUTRAL, {
        Spine: [-2, 0, 0],
        Chest: [-6, 0, 0],
        Head: [-8, -10, 0],
        RightArm: [-28, 0, -10],
        RightForeArm: [-56, 0, 0],
        RightHand: [-64, 0, 0],
        LeftArm: [-44, 0, -16],
        LeftForeArm: [-110, 0, 0],
        LeftUpLeg: [-6, 0, 8],
        RightUpLeg: [-2, 0, -8],
      });
      return [
        { t: 0, pose: idle },
        { t: 0.14, pose: up, ease: 'inOut' },
        ...twirl(up, 'RightHand', 0.16, 0.44, 2),
        { t: 0.56, pose: pose(proud, {}, [0, -0.06, 0]), ease: 'snap' },
        { t: 0.72, pose: proud, ease: 'out' },
        { t: 1, pose: addPose(proud, d({ Head: [-4, 10, 0] })), ease: 'inOut' },
      ];
    },
    dodge: 'vault',
    backDodge: 'hop',
  },
  morrow: {
    idles: [
      // Lifts the scythe and studies the blade.
      (idle) => {
        const study = pose(idle, {
          RightArm: [-110, 0, -20],
          RightForeArm: [-40, 0, 0],
          RightHand: [10, 0, 0],
          Head: [-14, -24, 12],
          Chest: [0, -10, 0],
        });
        return {
          sec: 3,
          keys: [
            { t: 0, pose: idle },
            { t: 0.3, pose: study, ease: 'inOut' },
            {
              t: 0.62,
              pose: addPose(study, d({ Head: [4, 6, -16], RightHand: [-10, 0, 0] })),
              ease: 'inOut',
            },
            { t: 1, pose: idle, ease: 'inOut' },
          ],
        };
      },
      // A slow tilt of the hooded head; the free hand beckons.
      (idle) => ({
        sec: 2.8,
        keys: [
          { t: 0, pose: idle },
          {
            t: 0.3,
            pose: addPose(
              idle,
              d({ Head: [6, 8, 22], LeftArm: [-30, 0, 10], LeftForeArm: [-30, 0, 0] }),
            ),
            ease: 'inOut',
          },
          {
            t: 0.48,
            pose: addPose(
              idle,
              d({ Head: [6, 8, 22], LeftArm: [-34, 0, 10], LeftForeArm: [-70, 0, 0] }),
            ),
            ease: 'inOut',
          },
          {
            t: 0.64,
            pose: addPose(
              idle,
              d({ Head: [6, 8, 20], LeftArm: [-30, 0, 10], LeftForeArm: [-30, 0, 0] }),
            ),
            ease: 'inOut',
          },
          { t: 1, pose: idle, ease: 'inOut' },
        ],
      }),
    ],
    victory: (idle) => {
      const rest = pose(NEUTRAL, {
        Spine: [4, 10, 0],
        Chest: [-2, 8, 0],
        Head: [10, -14, 8],
        RightArm: [-146, 0, -30],
        RightForeArm: [-112, 0, 0],
        RightHand: [-30, 0, 0],
        LeftArm: [-10, 0, 10],
        LeftForeArm: [-30, 0, 0],
        LeftUpLeg: [-8, 0, 6],
        RightUpLeg: [4, 0, -6],
      });
      return [
        { t: 0, pose: idle },
        {
          t: 0.2,
          pose: pose(idle, { Spine: [8, -20, 0], Chest: [0, -40, 0], RightArm: [-60, 0, -70] }),
          ease: 'inOut',
        },
        {
          t: 0.4,
          pose: pose(idle, {
            Spine: [14, 18, 0],
            Chest: [4, 50, 0],
            RightArm: [-86, 0, 8],
            RightForeArm: [-5, 0, 0],
          }),
          ease: 'snap',
        },
        { t: 0.66, pose: rest, ease: 'inOut' },
        { t: 1, pose: addPose(rest, d({ Head: [4, 4, -4] })), ease: 'inOut' },
      ];
    },
    dodge: 'wraith',
    backDodge: 'slide',
  },
};

const FALLBACK: HeroMoveSet = {
  idles: [lookAround],
  victory: (idle) => [
    { t: 0, pose: idle },
    { t: 1, pose: addPose(idle, d({ Chest: [-6, 0, 0], Head: [-10, 0, 0] })), ease: 'inOut' },
  ],
  dodge: 'roll',
  backDodge: 'hop',
};

function movesFor(heroId: string): HeroMoveSet {
  return MOVES[heroId] ?? FALLBACK;
}

/** Names of a hero's idle variant clips (idle_1, idle_2, …). */
export function idleVariantNames(heroId: string): string[] {
  return movesFor(heroId).idles.map((_, i) => `idle_${i + 1}`);
}

/** Tight ball for rolls and flips (spine curled, knees hugged). */
function tuck(hipsX: number, rootY: number, hipsY = 0): Pose {
  return pose(
    CROUCH,
    {
      Hips: [hipsX, hipsY, 0],
      Spine: [52, 0, 0],
      Chest: [18, 0, 0],
      Head: [30, 0, 0],
      LeftArm: [-62, 0, 12],
      RightArm: [-62, 0, -12],
      LeftForeArm: [-90, 0, 0],
      RightForeArm: [-90, 0, 0],
      LeftUpLeg: [-112, 0, 8],
      RightUpLeg: [-108, 0, -8],
      LeftLeg: [132, 0, 0],
      RightLeg: [128, 0, 0],
    },
    [0, rootY, 0],
  );
}

/** Idle with the hips turned a full circle (ends a roll without unwinding it). */
function fullTurn(p: Pose, axis: 0 | 1): Pose {
  const h = p.r.Hips ?? [0, 0, 0];
  return pose(p, { Hips: axis === 0 ? [h[0] + 360, h[1], h[2]] : [h[0], h[1] + 360, h[2]] });
}

function dodgeKeys(style: DodgeStyle, idle: Pose): ClipKey[] {
  switch (style) {
    case 'roll':
    case 'heavyRoll': {
      const heavy = style === 'heavyRoll' ? 1 : 0;
      return [
        { t: 0, pose: idle },
        {
          t: 0.12,
          pose: pose(
            CROUCH,
            {
              Hips: [28, 0, 0],
              Spine: [40, 0, 0],
              Head: [10, 0, 0],
              LeftArm: [-120, 0, 20],
              RightArm: [-120, 0, -20],
              LeftUpLeg: [-70, 0, 6],
              RightUpLeg: [20, 0, -6],
              LeftLeg: [70, 0, 0],
              RightLeg: [30, 0, 0],
            },
            [0, -0.28 - 0.05 * heavy, 0.05],
          ),
          ease: 'out',
        },
        { t: 0.3, pose: tuck(120, -0.46), ease: 'in' },
        { t: 0.5, pose: tuck(220, -0.52) },
        { t: 0.68, pose: tuck(310, -0.44) },
        {
          t: 0.84,
          pose: fullTurn(
            pose(CROUCH, { Spine: [30, 0, 0], LeftArm: [-30, 0, 20], RightArm: [-20, 0, -26] }, [
              0,
              -0.28 - 0.06 * heavy,
              0,
            ]),
            0,
          ),
          ease: 'out',
        },
        { t: 1, pose: fullTurn(idle, 0), ease: 'inOut' },
      ];
    }
    case 'flip':
      // Springs into a forward tuck flip and lands in guard.
      return [
        { t: 0, pose: idle },
        {
          t: 0.1,
          pose: pose(CROUCH, { LeftArm: [30, 0, 20], RightArm: [30, 0, -20] }, [0, -0.3, 0]),
          ease: 'out',
        },
        { t: 0.26, pose: tuck(80, 0.15), ease: 'out' },
        { t: 0.44, pose: tuck(200, 0.32) },
        { t: 0.62, pose: tuck(310, 0.1) },
        {
          t: 0.8,
          pose: fullTurn(
            pose(CROUCH, { LeftArm: [-60, 0, 40], RightArm: [-50, 0, -40] }, [0, -0.32, 0]),
            0,
          ),
          ease: 'in',
        },
        { t: 1, pose: fullTurn(idle, 0), ease: 'out' },
      ];
    case 'shieldDash': {
      // Hunkers behind the shield and drives forward in two hard steps.
      const charge = (lead: 'L' | 'R'): Pose =>
        pose(
          idle,
          {
            Spine: [26, 0, 0],
            Chest: [8, 0, 0],
            Head: [-14, 0, 0],
            LeftArm: [-74, 0, 0],
            LeftForeArm: [-52, 0, 0],
            RightArm: [10, 0, -24],
            RightForeArm: [-60, 0, 0],
            LeftUpLeg: lead === 'L' ? [-50, 0, 6] : [26, 0, 6],
            LeftLeg: lead === 'L' ? [40, 0, 0] : [50, 0, 0],
            RightUpLeg: lead === 'R' ? [-50, 0, -6] : [26, 0, -6],
            RightLeg: lead === 'R' ? [40, 0, 0] : [50, 0, 0],
          },
          [0, -0.16, 0],
        );
      return [
        { t: 0, pose: idle },
        { t: 0.18, pose: charge('L'), ease: 'snap' },
        { t: 0.42, pose: pose(charge('R'), {}, [0, -0.1, 0]), ease: 'inOut' },
        { t: 0.66, pose: charge('L'), ease: 'inOut' },
        { t: 1, pose: idle, ease: 'out' },
      ];
    }
    case 'glide': {
      // A low arcane glide: crouched, cape streaming, arms swept back.
      const glide = pose(
        idle,
        {
          Spine: [34, 0, 0],
          Chest: [6, 0, 0],
          Head: [-22, 0, 0],
          LeftArm: [40, 0, 30],
          LeftForeArm: [-10, 0, 0],
          RightArm: [26, 0, -26],
          RightForeArm: [-30, 0, 0],
          LeftUpLeg: [-44, 0, 6],
          RightUpLeg: [20, 0, -6],
          LeftLeg: [50, 0, 0],
          RightLeg: [60, 0, 0],
        },
        [0, -0.12, 0],
      );
      return [
        { t: 0, pose: idle },
        { t: 0.16, pose: pose(glide, {}, [0, -0.2, 0]), ease: 'snap' },
        { t: 0.5, pose: pose(glide, {}, [0, 0.06, 0]), ease: 'out' },
        { t: 0.76, pose: pose(glide, { Spine: [20, 0, 0] }, [0, -0.08, 0]), ease: 'in' },
        { t: 1, pose: idle, ease: 'out' },
      ];
    }
    case 'vault': {
      // A low bounding leap, spear trailing, knees tucked in the air.
      const air = pose(
        idle,
        {
          Spine: [24, 0, 0],
          Head: [-16, 0, 0],
          RightArm: [36, 0, -20],
          RightForeArm: [-20, 0, 0],
          LeftArm: [-70, 0, 20],
          LeftUpLeg: [-90, 0, 8],
          RightUpLeg: [-40, 0, -8],
          LeftLeg: [110, 0, 0],
          RightLeg: [100, 0, 0],
        },
        [0, 0.3, 0],
      );
      return [
        { t: 0, pose: idle },
        { t: 0.14, pose: pose(CROUCH, { RightArm: [30, 0, -20] }, [0, -0.28, 0]), ease: 'out' },
        { t: 0.42, pose: air, ease: 'out' },
        {
          t: 0.7,
          pose: pose(CROUCH, { Spine: [36, 0, 0], RightArm: [20, 0, -20] }, [0, -0.34, 0]),
          ease: 'in',
        },
        { t: 1, pose: idle, ease: 'out' },
      ];
    }
    case 'wraith': {
      // Drifts like smoke: leans back, floats a hand off the ground, settles.
      const drift = pose(
        idle,
        {
          Spine: [-8, 0, 0],
          Chest: [-6, 0, 0],
          Head: [10, 0, 0],
          LeftArm: [16, 0, 40],
          LeftForeArm: [-20, 0, 0],
          LeftUpLeg: [-26, 0, 6],
          RightUpLeg: [-10, 0, -6],
          LeftLeg: [50, 0, 0],
          RightLeg: [70, 0, 0],
        },
        [0, 0.14, 0],
      );
      return [
        { t: 0, pose: idle },
        { t: 0.14, pose: pose(idle, { Spine: [24, 0, 0] }, [0, -0.12, 0]), ease: 'snap' },
        { t: 0.5, pose: drift, ease: 'out' },
        { t: 0.8, pose: pose(drift, {}, [0, 0.02, 0]), ease: 'inOut' },
        { t: 1, pose: idle, ease: 'in' },
      ];
    }
  }
}

function backDodgeKeys(style: BackDodgeStyle, idle: Pose): ClipKey[] {
  switch (style) {
    case 'backflip':
      return [
        { t: 0, pose: idle },
        {
          t: 0.12,
          pose: pose(
            CROUCH,
            { Spine: [10, 0, 0], LeftArm: [20, 0, 20], RightArm: [20, 0, -20] },
            [0, -0.25, 0],
          ),
          ease: 'out',
        },
        { t: 0.3, pose: pose(tuck(-90, 0.4), { Spine: [20, 0, 0] }), ease: 'out' },
        { t: 0.5, pose: tuck(-200, 0.5) },
        { t: 0.68, pose: tuck(-300, 0.2) },
        {
          t: 0.84,
          pose: pose(
            CROUCH,
            { Hips: [-360, 0, 0], LeftArm: [-40, 0, 40], RightArm: [-40, 0, -40] },
            [0, -0.28, 0],
          ),
          ease: 'in',
        },
        { t: 1, pose: pose(idle, { Hips: [-360 + (idle.r.Hips?.[0] ?? 0), 0, 0] }), ease: 'out' },
      ];
    case 'shieldStep':
      return [
        { t: 0, pose: idle },
        {
          t: 0.25,
          pose: pose(
            idle,
            {
              Spine: [18, 0, 0],
              LeftArm: [-70, 0, 4],
              LeftForeArm: [-50, 0, 0],
              RightUpLeg: [30, 0, -8],
              RightLeg: [30, 0, 0],
            },
            [0, -0.15, 0],
          ),
          ease: 'snap',
        },
        {
          t: 0.6,
          pose: pose(
            idle,
            { Spine: [14, 0, 0], LeftArm: [-66, 0, 4], LeftForeArm: [-52, 0, 0] },
            [0, -0.1, 0],
          ),
          ease: 'inOut',
        },
        { t: 1, pose: idle, ease: 'out' },
      ];
    case 'slide':
      return [
        { t: 0, pose: idle },
        {
          t: 0.2,
          pose: pose(
            idle,
            {
              Spine: [20, 0, 0],
              Head: [-10, 0, 0],
              LeftArm: [30, 0, 30],
              RightUpLeg: [26, 0, -6],
              RightLeg: [40, 0, 0],
              LeftUpLeg: [-30, 0, 6],
              LeftLeg: [50, 0, 0],
            },
            [0, -0.2, 0],
          ),
          ease: 'snap',
        },
        {
          t: 0.6,
          pose: pose(idle, { Spine: [14, 0, 0], LeftArm: [20, 0, 26] }, [0, -0.12, 0]),
          ease: 'out',
        },
        { t: 1, pose: idle, ease: 'inOut' },
      ];
    case 'hop':
      return [
        { t: 0, pose: idle },
        { t: 0.22, pose: pose(CROUCH, { Spine: [-10, 0, 0] }, [0, -0.15, 0]), ease: 'out' },
        {
          t: 0.55,
          pose: pose(
            idle,
            {
              Spine: [-22, 0, 0],
              LeftArm: [-60, 0, 30],
              RightArm: [-60, 0, -30],
              LeftUpLeg: [-30, 0, 4],
              LeftLeg: [50, 0, 0],
            },
            [0, 0.18, 0],
          ),
          ease: 'out',
        },
        { t: 0.8, pose: pose(CROUCH, { Spine: [10, 0, 0] }, [0, -0.2, 0]), ease: 'in' },
        { t: 1, pose: idle, ease: 'out' },
      ];
  }
}

/** Idle variants, victory and dodge clips of a hero (durations: dodges are stretched to data). */
export function buildHeroMoveClips(heroId: string, idle: Pose): AnimationClip[] {
  const m = movesFor(heroId);
  const clips = m.idles.map((f, i) => {
    const v = f(idle);
    return buildPoseClip(`idle_${i + 1}`, v.sec, v.keys);
  });
  clips.push(
    buildPoseClip('victory', 2.6, m.victory(idle)),
    buildPoseClip('dodge_roll', 1, dodgeKeys(m.dodge, idle)),
    buildPoseClip('dodge_back', 1, backDodgeKeys(m.backDodge, idle)),
  );
  return clips;
}
