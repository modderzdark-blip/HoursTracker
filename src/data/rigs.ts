/**
 * Placeholder character rigs. Each rig becomes ONE skinned mesh (one draw call) whose bones use
 * Mixamo-style names, so real Mixamo models and clips drop in later without code changes.
 * Lengths are metres for a 1.0 scale rig (~1.85 m tall); `scale` multiplies everything.
 */

export type WeaponKind = 'dualBlades' | 'greatsword' | 'claws' | 'club' | 'none';

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
