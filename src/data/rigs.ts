/**
 * Placeholder character rigs. Each rig becomes ONE skinned mesh (one draw call) whose bones use
 * Mixamo-style names, so real Mixamo models and clips drop in later without code changes.
 * Lengths are metres for a 1.0 scale rig (~1.85 m tall); `scale` multiplies everything.
 */

export type WeaponKind =
  'dualBlades' | 'greatsword' | 'bowDagger' | 'shieldMace' | 'staff' | 'claws' | 'club' | 'none';

export interface RigProportions {
  readonly hipsY: number;
  readonly spineLen: number;
  readonly chestLen: number;
  readonly neckLen: number;
  readonly headRadius: number;
  readonly shoulderX: number;
  readonly upperArm: number;
  readonly foreArm: number;
  readonly hipX: number;
  readonly thigh: number;
  readonly shin: number;
  readonly torsoRadius: number;
  readonly limbRadius: number;
  /** Chest width multiplier (broad shoulders). */
  readonly chestWidth: number;
}

export interface RigLook {
  readonly body: number;
  readonly trim: number;
  readonly skin: number;
  readonly metal: number;
  /** Emissive eye colour (rendered unlit so it reads in the dark / blooms). */
  readonly eyes: number;
  readonly hood: boolean;
  readonly horns: boolean;
  readonly pauldrons: boolean;
  readonly rim: number;
  /** Large membrane wings on the back (Mother of Ash). */
  readonly wings?: boolean;
  /** A second pair of arms from the chest (The Bound King). */
  readonly extraArms?: boolean;
}

export interface RigDef {
  readonly id: string;
  readonly scale: number;
  readonly proportions: RigProportions;
  readonly look: RigLook;
  readonly weapon: WeaponKind;
  readonly weaponColor: number;
}

const HUMAN: RigProportions = {
  hipsY: 0.95,
  spineLen: 0.2,
  chestLen: 0.24,
  neckLen: 0.1,
  headRadius: 0.13,
  shoulderX: 0.2,
  upperArm: 0.29,
  foreArm: 0.27,
  hipX: 0.1,
  thigh: 0.45,
  shin: 0.44,
  torsoRadius: 0.15,
  limbRadius: 0.055,
  chestWidth: 1.25,
};

export const RIGS = {
  kael: {
    id: 'kael',
    scale: 1,
    proportions: HUMAN,
    look: {
      body: 0x26222d,
      trim: 0xb8862e,
      skin: 0x8a6a5c,
      metal: 0x9aa0ad,
      eyes: 0xff7a2a,
      hood: true,
      horns: false,
      pauldrons: true,
      rim: 0xff8a3d,
    },
    weapon: 'dualBlades',
    weaponColor: 0xc9ccd6,
  },
  brann: {
    id: 'brann',
    scale: 1.08,
    proportions: {
      ...HUMAN,
      torsoRadius: 0.175,
      limbRadius: 0.065,
      chestWidth: 1.4,
      headRadius: 0.135,
    },
    look: {
      body: 0x2e2a26,
      trim: 0x9a7a3a,
      skin: 0x8a6650,
      metal: 0x8c929e,
      eyes: 0xffb040,
      hood: false,
      horns: false,
      pauldrons: true,
      rim: 0xffa040,
    },
    weapon: 'greatsword',
    weaponColor: 0xb8bcc8,
  },
  lyra: {
    id: 'lyra',
    scale: 0.96,
    proportions: {
      ...HUMAN,
      torsoRadius: 0.13,
      limbRadius: 0.05,
      chestWidth: 1.1,
      headRadius: 0.125,
    },
    look: {
      body: 0x1f2a2a,
      trim: 0x6a8a7a,
      skin: 0x9a7868,
      metal: 0xb0b8c0,
      eyes: 0x9a70ff,
      hood: true,
      horns: false,
      pauldrons: false,
      rim: 0x9a80ff,
    },
    weapon: 'bowDagger',
    weaponColor: 0x5a4030,
  },
  thrall: {
    id: 'thrall',
    scale: 1,
    proportions: { ...HUMAN, torsoRadius: 0.14, limbRadius: 0.05, chestWidth: 1.1 },
    look: {
      body: 0x3d3431,
      trim: 0x5a4a3a,
      skin: 0x51473f,
      metal: 0x6b6460,
      eyes: 0xff3b1f,
      hood: false,
      horns: false,
      pauldrons: false,
      rim: 0xff5a2a,
    },
    weapon: 'club',
    weaponColor: 0x5a4334,
  },
  imp: {
    id: 'imp',
    scale: 0.62,
    proportions: { ...HUMAN, headRadius: 0.17, upperArm: 0.33, foreArm: 0.3, chestWidth: 1.0 },
    look: {
      body: 0x5c1f14,
      trim: 0x2a0d08,
      skin: 0x7a2a18,
      metal: 0x1a1a1a,
      eyes: 0xffd040,
      hood: false,
      horns: true,
      pauldrons: false,
      rim: 0xffa040,
    },
    weapon: 'claws',
    weaponColor: 0xe8d8b0,
  },
  brute: {
    id: 'brute',
    scale: 1.45,
    proportions: {
      ...HUMAN,
      torsoRadius: 0.21,
      limbRadius: 0.085,
      chestWidth: 1.55,
      headRadius: 0.12,
      neckLen: 0.05,
    },
    look: {
      body: 0x2f2a2a,
      trim: 0x6a5a4a,
      skin: 0x4a3f3a,
      metal: 0x55504c,
      eyes: 0xff6a1a,
      hood: false,
      horns: true,
      pauldrons: true,
      rim: 0xff6a2a,
    },
    weapon: 'club',
    weaponColor: 0x3a3330,
  },
  gaoler: {
    id: 'gaoler',
    scale: 1.85,
    proportions: {
      ...HUMAN,
      torsoRadius: 0.23,
      limbRadius: 0.09,
      chestWidth: 1.6,
      headRadius: 0.11,
      neckLen: 0.04,
    },
    look: {
      body: 0x2a2320,
      trim: 0x8a6a3a,
      skin: 0x3d302a,
      metal: 0x6a6460,
      eyes: 0xffb020,
      hood: true,
      horns: false,
      pauldrons: true,
      rim: 0xffa030,
    },
    weapon: 'club',
    weaponColor: 0x4a4440,
  },
  bulwark: {
    id: 'bulwark',
    scale: 1.12,
    proportions: { ...HUMAN, torsoRadius: 0.17, limbRadius: 0.065, chestWidth: 1.35 },
    look: {
      body: 0x34302c,
      trim: 0x7a6a50,
      skin: 0x4a403a,
      metal: 0x7a7e88,
      eyes: 0xff5020,
      hood: false,
      horns: false,
      pauldrons: true,
      rim: 0xff7a40,
    },
    weapon: 'shieldMace',
    weaponColor: 0x6a6e78,
  },
  penitent: {
    id: 'penitent',
    scale: 1.9,
    proportions: { ...HUMAN, torsoRadius: 0.2, limbRadius: 0.08, chestWidth: 1.45, neckLen: 0.05 },
    look: {
      body: 0x24222a,
      trim: 0x9a8a60,
      skin: 0x3a3440,
      metal: 0x8a8e9a,
      eyes: 0xffd060,
      hood: true,
      horns: false,
      pauldrons: true,
      rim: 0xffc060,
    },
    weapon: 'shieldMace',
    weaponColor: 0x8a8e9a,
  },
  seer: {
    id: 'seer',
    scale: 1,
    proportions: { ...HUMAN, torsoRadius: 0.13, limbRadius: 0.045, chestWidth: 1.05 },
    look: {
      body: 0x3a1a1a,
      trim: 0xb0602a,
      skin: 0x5a3a30,
      metal: 0x3a2a22,
      eyes: 0xffa030,
      hood: true,
      horns: false,
      pauldrons: false,
      rim: 0xff8a3a,
    },
    weapon: 'staff',
    weaponColor: 0x3a2a22,
  },
  seer_elder: {
    id: 'seer_elder',
    scale: 1.7,
    proportions: { ...HUMAN, torsoRadius: 0.14, limbRadius: 0.05, chestWidth: 1.1 },
    look: {
      body: 0x4a1410,
      trim: 0xe0a040,
      skin: 0x6a3a2a,
      metal: 0x2a1a14,
      eyes: 0xffe070,
      hood: true,
      horns: true,
      pauldrons: false,
      rim: 0xffb040,
    },
    weapon: 'staff',
    weaponColor: 0x2a1a14,
  },
  wretch: {
    id: 'wretch',
    scale: 0.8,
    proportions: {
      ...HUMAN,
      headRadius: 0.15,
      torsoRadius: 0.17,
      chestWidth: 1.0,
      limbRadius: 0.05,
    },
    look: {
      body: 0x5a2008,
      trim: 0xff7a1a,
      skin: 0x8a3a10,
      metal: 0x1a1a1a,
      eyes: 0xffe060,
      hood: false,
      horns: false,
      pauldrons: false,
      rim: 0xffa040,
    },
    weapon: 'none',
    weaponColor: 0,
  },
  mother: {
    id: 'mother',
    scale: 2.4,
    proportions: {
      ...HUMAN,
      torsoRadius: 0.16,
      limbRadius: 0.06,
      chestWidth: 1.3,
      headRadius: 0.14,
    },
    look: {
      body: 0x2a1410,
      trim: 0x5a1a10,
      skin: 0x4a2418,
      metal: 0xe0c8a0,
      eyes: 0xffd040,
      hood: false,
      horns: true,
      pauldrons: false,
      rim: 0xff6a20,
      wings: true,
    },
    weapon: 'claws',
    weaponColor: 0xe0c8a0,
  },
  king: {
    id: 'king',
    scale: 2.7,
    proportions: {
      ...HUMAN,
      torsoRadius: 0.2,
      limbRadius: 0.075,
      chestWidth: 1.55,
      headRadius: 0.13,
    },
    look: {
      body: 0x1a1420,
      trim: 0xb08a3a,
      skin: 0x2e2238,
      metal: 0xd8c8a0,
      eyes: 0xc070ff,
      hood: false,
      horns: true,
      pauldrons: true,
      rim: 0xb070ff,
      extraArms: true,
    },
    weapon: 'claws',
    weaponColor: 0xd8c8a0,
  },
  warden: {
    id: 'warden',
    scale: 2.5,
    proportions: { ...HUMAN, torsoRadius: 0.18, limbRadius: 0.07, chestWidth: 1.5 },
    look: {
      body: 0x1c1b22,
      trim: 0x7a6440,
      skin: 0x2a2730,
      metal: 0x5c5f6a,
      eyes: 0xff5020,
      hood: false,
      horns: true,
      pauldrons: true,
      rim: 0xff5a20,
    },
    weapon: 'greatsword',
    weaponColor: 0x8a8e9a,
  },
  dummy: {
    id: 'dummy',
    scale: 1,
    proportions: { ...HUMAN, torsoRadius: 0.17, chestWidth: 1.0 },
    look: {
      body: 0x6a5236,
      trim: 0x3a2c1c,
      skin: 0x7a6040,
      metal: 0x4a3a2a,
      eyes: 0x000000,
      hood: false,
      horns: false,
      pauldrons: false,
      rim: 0xffa060,
    },
    weapon: 'none',
    weaponColor: 0,
  },
} as const satisfies Record<string, RigDef>;

export type RigId = keyof typeof RIGS;
