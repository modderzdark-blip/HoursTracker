/**
 * Pets: spirit companions that follow the hero into battle, strike the nearest foe on their own
 * and lend a passive bonus to the hero's stats. They hatch from eggs (Shop), level up with souls
 * and gold, and duplicates become shards that raise their stars. All names are original.
 */
import type { Rarity } from './items';

export type PetId =
  | 'cinder_pup'
  | 'gloom_moth'
  | 'ashwing_drake'
  | 'hollow_owl'
  | 'ember_fox'
  | 'bone_wisp'
  | 'pyre_phoenix'
  | 'void_serpent';

/** Stats a pet can raise (fractions: 0.05 = +5%). */
export type PetStat =
  'atkPct' | 'hpPct' | 'defPct' | 'critChance' | 'critDamage' | 'attackSpeed' | 'moveSpeed';

export const PET_STAT_LABEL: Readonly<Record<PetStat, string>> = {
  atkPct: 'ATK',
  hpPct: 'HP',
  defPct: 'DEF',
  critChance: 'Crit rate',
  critDamage: 'Crit damage',
  attackSpeed: 'Attack speed',
  moveSpeed: 'Move speed',
};

/** How the companion looks in battle (procedural, see src/vfx/PetCompanion.ts). */
export interface PetLook {
  /** Body and glow colour. */
  readonly color: number;
  /** Trail / wing colour. */
  readonly accent: number;
  readonly shape: 'hound' | 'moth' | 'drake' | 'owl' | 'fox' | 'wisp' | 'bird' | 'serpent';
  /** Body size (m). */
  readonly size: number;
}

export interface PetDef {
  readonly id: PetId;
  readonly name: string;
  readonly title: string;
  readonly rarity: Rarity;
  readonly lore: string;
  /** Bonus at level 1 and added per level after it (before stars). */
  readonly bonus: readonly {
    readonly stat: PetStat;
    readonly base: number;
    readonly perLevel: number;
  }[];
  /** Strike: seconds between attacks and the damage as a multiple of the hero's ATK. */
  readonly strike: { readonly everySec: number; readonly mult: number; readonly rangeM: number };
  readonly look: PetLook;
}

export const PETS: Readonly<Record<PetId, PetDef>> = {
  cinder_pup: {
    id: 'cinder_pup',
    name: 'Cinder Pup',
    title: 'Hearth Hound',
    rarity: 'rare',
    lore: 'Born in a forge that was never allowed to cool. Bites anything that threatens its keeper.',
    bonus: [{ stat: 'atkPct', base: 0.04, perLevel: 0.003 }],
    strike: { everySec: 3.2, mult: 0.55, rangeM: 9 },
    look: { color: 0xff7a2a, accent: 0xffd08a, shape: 'hound', size: 0.34 },
  },
  gloom_moth: {
    id: 'gloom_moth',
    name: 'Gloom Moth',
    title: 'Lantern Eater',
    rarity: 'rare',
    lore: 'It drinks candlelight and gives it back as a shield of dust.',
    bonus: [{ stat: 'hpPct', base: 0.05, perLevel: 0.004 }],
    strike: { everySec: 3.6, mult: 0.45, rangeM: 9 },
    look: { color: 0xb8a0ff, accent: 0xe8dcff, shape: 'moth', size: 0.3 },
  },
  ashwing_drake: {
    id: 'ashwing_drake',
    name: 'Ashwing Drake',
    title: 'Little Wyrm',
    rarity: 'epic',
    lore: 'A dragonling hatched in the ash of a burnt cathedral. Its breath is already too hot to hold.',
    bonus: [
      { stat: 'atkPct', base: 0.05, perLevel: 0.004 },
      { stat: 'critChance', base: 0.015, perLevel: 0.001 },
    ],
    strike: { everySec: 2.8, mult: 0.7, rangeM: 10 },
    look: { color: 0xff5a2a, accent: 0xffb15e, shape: 'drake', size: 0.38 },
  },
  hollow_owl: {
    id: 'hollow_owl',
    name: 'Hollow Owl',
    title: 'Watcher of Crypts',
    rarity: 'epic',
    lore: 'Its eyes see the weak seam in any armour. It points; you strike.',
    bonus: [
      { stat: 'critChance', base: 0.025, perLevel: 0.0015 },
      { stat: 'critDamage', base: 0.06, perLevel: 0.004 },
    ],
    strike: { everySec: 3, mult: 0.6, rangeM: 11 },
    look: { color: 0x9ad8ff, accent: 0xe0f4ff, shape: 'owl', size: 0.34 },
  },
  ember_fox: {
    id: 'ember_fox',
    name: 'Ember Fox',
    title: 'Trickster Flame',
    rarity: 'epic',
    lore: 'Nine tails of smoke. It is always a step ahead, and so are you.',
    bonus: [
      { stat: 'attackSpeed', base: 0.03, perLevel: 0.002 },
      { stat: 'moveSpeed', base: 0.02, perLevel: 0.001 },
    ],
    strike: { everySec: 2.4, mult: 0.45, rangeM: 9 },
    look: { color: 0xff9a3c, accent: 0xfff0c0, shape: 'fox', size: 0.32 },
  },
  bone_wisp: {
    id: 'bone_wisp',
    name: 'Bone Wisp',
    title: 'Ossuary Light',
    rarity: 'legendary',
    lore: 'The last breath of a saint, too stubborn to leave. It wards whoever carries it.',
    bonus: [
      { stat: 'hpPct', base: 0.07, perLevel: 0.005 },
      { stat: 'defPct', base: 0.06, perLevel: 0.004 },
    ],
    strike: { everySec: 2.8, mult: 0.75, rangeM: 11 },
    look: { color: 0x9affd8, accent: 0xe8fff6, shape: 'wisp', size: 0.3 },
  },
  pyre_phoenix: {
    id: 'pyre_phoenix',
    name: 'Pyre Phoenix',
    title: 'Ash Reborn',
    rarity: 'legendary',
    lore: 'It has died a hundred times in a hundred fires and liked every one of them.',
    bonus: [
      { stat: 'atkPct', base: 0.07, perLevel: 0.005 },
      { stat: 'critDamage', base: 0.08, perLevel: 0.005 },
    ],
    strike: { everySec: 2.4, mult: 0.9, rangeM: 12 },
    look: { color: 0xff6a1a, accent: 0xffe08a, shape: 'bird', size: 0.4 },
  },
  void_serpent: {
    id: 'void_serpent',
    name: 'Void Serpent',
    title: 'Coil of the Deep',
    rarity: 'mythic',
    lore: 'It swam up out of the Hollow Deep and chose you. Nobody knows why. Nobody asks it.',
    bonus: [
      { stat: 'atkPct', base: 0.08, perLevel: 0.006 },
      { stat: 'hpPct', base: 0.06, perLevel: 0.004 },
      { stat: 'critChance', base: 0.02, perLevel: 0.0012 },
    ],
    strike: { everySec: 2.2, mult: 1.05, rangeM: 12 },
    look: { color: 0xc04aff, accent: 0x6af0ff, shape: 'serpent', size: 0.42 },
  },
};

export const PET_IDS = Object.keys(PETS) as PetId[];

export const PET_CONFIG = {
  maxLevel: 30,
  maxStars: 5,
  /** Shards to go from N stars to N + 1 (index N − 1). A duplicate hatch gives one shard. */
  shardsForStar: [1, 2, 4, 8],
  /** Each star past the first adds this fraction to the bonus and strike damage. */
  starBonus: 0.2,
  /** Level-up cost to reach level N: souls = soulsBase × N, gold = goldBase × N^1.3. */
  soulsBase: 6,
  goldBase: 400,
} as const;

/** Hatch odds by egg (rarity weights). */
export const EGGS = {
  ember: {
    id: 'ember',
    name: 'Ember Egg',
    weights: { rare: 70, epic: 26, legendary: 4, mythic: 0 },
  },
  abyss: {
    id: 'abyss',
    name: 'Abyss Egg',
    weights: { rare: 0, epic: 62, legendary: 32, mythic: 6 },
  },
} as const;

export type EggId = keyof typeof EGGS;
