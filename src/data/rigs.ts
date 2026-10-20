/**
 * Placeholder character rigs. Each rig becomes ONE skinned mesh (one draw call) whose bones use
 * Mixamo-style names, so real Mixamo models and clips drop in later without code changes.
 * Lengths are metres for a 1.0 scale rig (~1.85 m tall); `scale` multiplies everything.
 */

export type WeaponKind =
  | 'dualBlades'
  | 'greatsword'
  | 'bowDagger'
  | 'shieldMace'
  | 'staff'
  | 'claws'
  | 'club'
  /** Tall tower shield (left) + flanged warhammer (right). */
  | 'towerShield'
  /** Straight staff with a crescent head cradling an ember. */
  | 'emberStaff'
  /** Plated knuckles and wrapped fists (unarmed fighters). */
  | 'gauntlets'
  /** Long spear with a leaf blade. */
  | 'spear'
  /** Two-handed war scythe. */
  | 'scythe'
  | 'none';

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

export type HeadKind =
  | 'bare'
  | 'hood'
  | 'helm'
  | 'greathelm'
  | 'crown'
  | 'skull'
  | 'cowl'
  /** Wide-brimmed pointed hat over a face and long hair. */
  | 'brim'
  /** Face with tied-up hair and a headband. */
  | 'topknot'
  /** Open-faced helm with swept wings. */
  | 'winged'
  /** Deep hood over a bone skull mask. */
  | 'deathhood';
/** 'gi': cloth jacket with crossed lapels, bare wrapped forearms, a sash and loose trousers. */
export type ArmorKind = 'leather' | 'plate' | 'robe' | 'rags' | 'hide' | 'straw' | 'gi';

/** Cloth that swings with movement (driven by spring bones, see HumanoidRig). */
export interface ClothDef {
  readonly color: number;
  /** Length / width in metres at rig scale 1. */
  readonly length: number;
  readonly width: number;
  /** Ragged hem. */
  readonly tattered?: boolean;
}

/**
 * Costume pieces built around the body. Every piece is optional; a rig without an outfit gets a
 * plain body. Colours not given here come from the look's body / trim / metal colours.
 */
export interface RigOutfit {
  readonly head: HeadKind;
  readonly armor: ArmorKind;
  readonly cape?: ClothDef;
  /** Scarf wrapped at the neck with two tails (colour). */
  readonly scarf?: number;
  /** Front + back cloth panels hanging from the belt (colour). */
  readonly tabard?: number;
  /** Plate tassets around the hips. */
  readonly tassets?: boolean;
  readonly quiver?: boolean;
  readonly tail?: boolean;
  /** Face mask / veil under a hood. */
  readonly mask?: boolean;
  /** Spikes on pauldrons and gauntlets. */
  readonly spikes?: boolean;
  /** Glowing cracks over the body (demons) in this colour. */
  readonly cracks?: number;
  /** Glowing accent lines (runes, visor, gem) in this colour; defaults to the eye colour. */
  readonly accent?: number;
  /** Hunched, forward-leaning silhouette (0..1). */
  readonly hunch?: number;
  /** Heavier belly / chest mass (0..1). */
  readonly bulk?: number;
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
  readonly outfit?: RigOutfit;
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
      body: 0x6e5446,
      trim: 0xc8963a,
      skin: 0x9a7464,
      metal: 0x9aa0ad,
      eyes: 0xff7a2a,
      hood: true,
      horns: false,
      pauldrons: true,
      rim: 0xff8a3d,
      outfit: {
        head: 'hood',
        armor: 'leather',
        mask: true,
        scarf: 0x7a1e24,
        cape: { color: 0x34303e, length: 0.95, width: 0.5, tattered: true },
        accent: 0xff7a2a,
      },
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
      body: 0x4a4038,
      trim: 0xb8903e,
      skin: 0x8a6650,
      metal: 0xa8adb8,
      eyes: 0xffb040,
      hood: false,
      horns: false,
      pauldrons: true,
      rim: 0xffa040,
      outfit: {
        head: 'helm',
        armor: 'plate',
        tabard: 0x7a1c20,
        tassets: true,
        cape: { color: 0x5a161a, length: 1.15, width: 0.66 },
        accent: 0xffb040,
      },
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
      body: 0x4a6458,
      trim: 0x8aa88f,
      skin: 0xa88470,
      metal: 0xb8c0c8,
      eyes: 0x9a70ff,
      hood: true,
      horns: false,
      pauldrons: false,
      rim: 0x9a80ff,
      outfit: {
        head: 'hood',
        armor: 'leather',
        quiver: true,
        cape: { color: 0x34483f, length: 1.0, width: 0.56, tattered: true },
        accent: 0xb090ff,
      },
    },
    weapon: 'bowDagger',
    weaponColor: 0x5a4030,
  },
  garrick: {
    id: 'garrick',
    scale: 1.12,
    proportions: {
      ...HUMAN,
      torsoRadius: 0.18,
      limbRadius: 0.068,
      chestWidth: 1.45,
      headRadius: 0.135,
    },
    look: {
      body: 0x3a3e48,
      trim: 0xc89a48,
      skin: 0x8a6a58,
      metal: 0xb0b6c2,
      eyes: 0xffd04a,
      hood: false,
      horns: false,
      pauldrons: true,
      rim: 0xffd060,
      outfit: {
        head: 'greathelm',
        armor: 'plate',
        tabard: 0x1c3260,
        tassets: true,
        bulk: 0.35,
        cape: { color: 0x16244a, length: 1.1, width: 0.7 },
        accent: 0xffd04a,
      },
    },
    weapon: 'towerShield',
    weaponColor: 0x9aa0ac,
  },
  seraphine: {
    id: 'seraphine',
    scale: 0.96,
    proportions: {
      ...HUMAN,
      torsoRadius: 0.125,
      limbRadius: 0.047,
      chestWidth: 1.05,
      headRadius: 0.125,
    },
    look: {
      body: 0x5c1418,
      trim: 0xd8a040,
      skin: 0xc09078,
      metal: 0x3a2a26,
      eyes: 0xff7040,
      hood: false,
      horns: false,
      pauldrons: false,
      rim: 0xff5a30,
      outfit: {
        head: 'brim',
        armor: 'robe',
        cape: { color: 0x2a0c10, length: 1.05, width: 0.55, tattered: true },
        accent: 0xff5a2a,
      },
    },
    weapon: 'emberStaff',
    weaponColor: 0x2a1c18,
  },
  ryn: {
    id: 'ryn',
    scale: 0.98,
    proportions: {
      ...HUMAN,
      torsoRadius: 0.14,
      limbRadius: 0.056,
      chestWidth: 1.3,
      headRadius: 0.125,
    },
    look: {
      body: 0x2c2832,
      trim: 0xa8987e,
      skin: 0xa87860,
      metal: 0x8a8e98,
      eyes: 0xff7ab0,
      hood: false,
      horns: false,
      pauldrons: false,
      rim: 0xff6aa8,
      outfit: {
        head: 'topknot',
        armor: 'gi',
        scarf: 0x9a1e4a,
        tabard: 0x9a1e4a,
        accent: 0xff5c9a,
      },
    },
    weapon: 'gauntlets',
    weaponColor: 0x9aa0ac,
  },
  valka: {
    id: 'valka',
    scale: 1,
    proportions: {
      ...HUMAN,
      torsoRadius: 0.14,
      limbRadius: 0.054,
      chestWidth: 1.2,
      headRadius: 0.125,
    },
    look: {
      body: 0x26344c,
      trim: 0xc0c8d8,
      skin: 0xb08870,
      metal: 0xc4ccd8,
      eyes: 0x8ad0ff,
      hood: false,
      horns: false,
      pauldrons: true,
      rim: 0x6ab0ff,
      outfit: {
        head: 'winged',
        armor: 'leather',
        cape: { color: 0x1a2a46, length: 1.0, width: 0.52 },
        accent: 0x6ab4ff,
      },
    },
    weapon: 'spear',
    weaponColor: 0xc8d0dc,
  },
  morrow: {
    id: 'morrow',
    scale: 1.04,
    proportions: {
      ...HUMAN,
      torsoRadius: 0.13,
      limbRadius: 0.048,
      chestWidth: 1.15,
      headRadius: 0.13,
    },
    look: {
      body: 0x1e1c22,
      trim: 0x7a8456,
      skin: 0x6a6070,
      metal: 0x4a4a50,
      eyes: 0x9cff4a,
      hood: true,
      horns: false,
      pauldrons: true,
      rim: 0x9cff4a,
      outfit: {
        head: 'deathhood',
        armor: 'robe',
        spikes: true,
        cape: { color: 0x141216, length: 1.25, width: 0.7, tattered: true },
        accent: 0x9cff4a,
      },
    },
    weapon: 'scythe',
    weaponColor: 0x3a3438,
  },
  thrall: {
    id: 'thrall',
    scale: 1,
    proportions: { ...HUMAN, torsoRadius: 0.14, limbRadius: 0.05, chestWidth: 1.1 },
    look: {
      body: 0x5a4a42,
      trim: 0x5a4a3a,
      skin: 0x6e6058,
      metal: 0x6b6460,
      eyes: 0xff3b1f,
      hood: false,
      horns: false,
      pauldrons: false,
      rim: 0xff5a2a,
      outfit: { head: 'skull', armor: 'rags', hunch: 0.5, cracks: 0xff5a1a },
    },
    weapon: 'club',
    weaponColor: 0x5a4334,
  },
  imp: {
    id: 'imp',
    scale: 0.62,
    proportions: { ...HUMAN, headRadius: 0.17, upperArm: 0.33, foreArm: 0.3, chestWidth: 1.0 },
    look: {
      body: 0x6a2414,
      trim: 0x2a0d08,
      skin: 0x9a3a20,
      metal: 0x1a1a1a,
      eyes: 0xffd040,
      hood: false,
      horns: true,
      pauldrons: false,
      rim: 0xffa040,
      outfit: { head: 'bare', armor: 'rags', tail: true, cracks: 0xffc040 },
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
      body: 0x4a3a32,
      trim: 0x7a6a58,
      skin: 0x6a5a52,
      metal: 0x55504c,
      eyes: 0xff6a1a,
      hood: false,
      horns: true,
      pauldrons: true,
      rim: 0xff6a2a,
      outfit: { head: 'bare', armor: 'hide', bulk: 0.8, spikes: true, hunch: 0.3 },
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
      body: 0x3e3430,
      trim: 0x8a6a3a,
      skin: 0x5a4a40,
      metal: 0x6a6460,
      eyes: 0xffb020,
      hood: true,
      horns: false,
      pauldrons: true,
      rim: 0xffa030,
      outfit: {
        head: 'cowl',
        armor: 'hide',
        bulk: 0.7,
        spikes: true,
        tabard: 0x3a2a1e,
        accent: 0xffb020,
      },
    },
    weapon: 'club',
    weaponColor: 0x4a4440,
  },
  bulwark: {
    id: 'bulwark',
    scale: 1.12,
    proportions: { ...HUMAN, torsoRadius: 0.17, limbRadius: 0.065, chestWidth: 1.35 },
    look: {
      body: 0x4a4440,
      trim: 0x7a6a50,
      skin: 0x4a403a,
      metal: 0x8a8e98,
      eyes: 0xff5020,
      hood: false,
      horns: false,
      pauldrons: true,
      rim: 0xff7a40,
      outfit: {
        head: 'greathelm',
        armor: 'plate',
        tabard: 0x3a2a1c,
        tassets: true,
        accent: 0xff5020,
      },
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
      metal: 0x9a9eaa,
      eyes: 0xffd060,
      hood: true,
      horns: false,
      pauldrons: true,
      rim: 0xffc060,
      outfit: {
        head: 'cowl',
        armor: 'plate',
        tassets: true,
        spikes: true,
        cape: { color: 0x2a2630, length: 1.2, width: 0.7, tattered: true },
        accent: 0xffd060,
      },
    },
    weapon: 'shieldMace',
    weaponColor: 0x8a8e9a,
  },
  seer: {
    id: 'seer',
    scale: 1,
    proportions: { ...HUMAN, torsoRadius: 0.13, limbRadius: 0.045, chestWidth: 1.05 },
    look: {
      body: 0x5a2420,
      trim: 0xb0602a,
      skin: 0x5a3a30,
      metal: 0x3a2a22,
      eyes: 0xffa030,
      hood: true,
      horns: false,
      pauldrons: false,
      rim: 0xff8a3a,
      outfit: { head: 'hood', armor: 'robe', mask: true, accent: 0xff8a2a },
    },
    weapon: 'staff',
    weaponColor: 0x3a2a22,
  },
  seer_elder: {
    id: 'seer_elder',
    scale: 1.7,
    proportions: { ...HUMAN, torsoRadius: 0.14, limbRadius: 0.05, chestWidth: 1.1 },
    look: {
      body: 0x6a1c14,
      trim: 0xe0a040,
      skin: 0x6a3a2a,
      metal: 0x2a1a14,
      eyes: 0xffe070,
      hood: true,
      horns: true,
      pauldrons: false,
      rim: 0xffb040,
      outfit: {
        head: 'hood',
        armor: 'robe',
        mask: true,
        cape: { color: 0x3a0e0a, length: 1.3, width: 0.7, tattered: true },
        accent: 0xffd060,
      },
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
      skin: 0xa04a18,
      metal: 0x1a1a1a,
      eyes: 0xffe060,
      hood: false,
      horns: false,
      pauldrons: false,
      rim: 0xffa040,
      outfit: { head: 'skull', armor: 'rags', bulk: 1, hunch: 0.6, cracks: 0xffa020 },
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
      body: 0x4a2018,
      trim: 0x5a1a10,
      skin: 0x6a3424,
      metal: 0xe0c8a0,
      eyes: 0xffd040,
      hood: false,
      horns: true,
      pauldrons: false,
      rim: 0xff6a20,
      wings: true,
      outfit: { head: 'bare', armor: 'hide', tail: true, cracks: 0xff6a20, accent: 0xffd040 },
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
      metal: 0x6a5a7a,
      eyes: 0xc070ff,
      hood: false,
      horns: true,
      pauldrons: true,
      rim: 0xb070ff,
      extraArms: true,
      outfit: {
        head: 'crown',
        armor: 'plate',
        tassets: true,
        spikes: true,
        cape: { color: 0x3a1450, length: 1.35, width: 0.85, tattered: true },
        cracks: 0xb070ff,
        accent: 0xc070ff,
      },
    },
    weapon: 'claws',
    weaponColor: 0xd8c8a0,
  },
  warden: {
    id: 'warden',
    scale: 2.5,
    proportions: { ...HUMAN, torsoRadius: 0.18, limbRadius: 0.07, chestWidth: 1.5 },
    look: {
      body: 0x2e2c34,
      trim: 0x7a6440,
      skin: 0x2a2730,
      metal: 0x6c707c,
      eyes: 0xff5020,
      hood: false,
      horns: true,
      pauldrons: true,
      rim: 0xff5a20,
      outfit: {
        head: 'greathelm',
        armor: 'plate',
        tassets: true,
        spikes: true,
        cape: { color: 0x1c1418, length: 1.2, width: 0.75, tattered: true },
        accent: 0xff5020,
      },
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
      outfit: { head: 'bare', armor: 'straw' },
    },
    weapon: 'none',
    weaponColor: 0,
  },
} as const satisfies Record<string, RigDef>;

export type RigId = keyof typeof RIGS;
