/**
 * Progression tunables: hero XP curve, enemy level scaling, loot (drop tables, rarity weights,
 * pity) and reward tables. Logic lives in src/progression/.
 */
import type { DifficultyId } from './difficulty';
import type { GearSlot, Rarity } from './items';

export const XP_CONFIG = {
  maxLevel: 50,
  /** XP needed to go from level L to L+1 = round(base × L^exponent). */
  base: 110,
  exponent: 1.5,
} as const;

/** Enemy stats at level L = base × (1 + perLevel × (L − 1)). */
export const ENEMY_SCALING = {
  hpPerLevel: 0.1,
  atkPerLevel: 0.07,
  defPerLevel: 0.06,
  poisePerLevel: 0.015,
} as const;

/** Relative rarity weights per difficulty (normalised in code). */
export const RARITY_WEIGHTS: Readonly<Record<DifficultyId, Readonly<Record<Rarity, number>>>> = {
  normal: { common: 62, rare: 29, epic: 7.6, legendary: 1.3, mythic: 0.1 },
  hard: { common: 40, rare: 38, epic: 17, legendary: 4.4, mythic: 0.6 },
  nightmare: { common: 18, rare: 40, epic: 29, legendary: 10.5, mythic: 2.5 },
};

export const PITY_CONFIG = {
  /** After this many drops in a row below epic, the next drop is at least epic. */
  epic: 10,
  /** After this many drops in a row below legendary, the next drop is at least legendary. */
  legendary: 40,
} as const;

export interface DropTable {
  /** Guaranteed gear drops. */
  readonly items: number;
  /** Chance of one extra gear drop. */
  readonly bonusItemChance: number;
  readonly materials: readonly [number, number];
  /** Chance of a reward ticket. */
  readonly ticketChance: number;
  /** Optional slot bias (only these slots drop); empty = any slot. */
  readonly slots: readonly GearSlot[];
}

export type DropTableId = 'stage' | 'miniboss' | 'boss' | 'dungeon' | 'tower' | 'challenge';

export const DROP_TABLES: Readonly<Record<DropTableId, DropTable>> = {
  stage: { items: 1, bonusItemChance: 0.35, materials: [2, 5], ticketChance: 0.05, slots: [] },
  miniboss: {
    items: 2,
    bonusItemChance: 0.4,
    materials: [5, 9],
    ticketChance: 0.15,
    slots: [],
  },
  boss: { items: 3, bonusItemChance: 0.5, materials: [10, 16], ticketChance: 0.35, slots: [] },
  dungeon: { items: 3, bonusItemChance: 0.6, materials: [12, 20], ticketChance: 0.3, slots: [] },
  tower: { items: 1, bonusItemChance: 0.25, materials: [3, 6], ticketChance: 0.08, slots: [] },
  challenge: {
    items: 2,
    bonusItemChance: 0.5,
    materials: [15, 25],
    ticketChance: 0.5,
    slots: ['weapon', 'ring', 'amulet'],
  },
};

export const LOOT_CONFIG = {
  /** Item level = stage level + difficulty bonus + random 0..spread. */
  itemLevelSpread: 2,
  /** Rare+ drops get a small level bonus. */
  rarityLevelBonus: { common: 0, rare: 0, epic: 1, legendary: 2, mythic: 3 },
} as const satisfies { itemLevelSpread: number; rarityLevelBonus: Record<Rarity, number> };

/** Item-level bonus by difficulty (harder = better gear). */
export const DIFFICULTY_ITEM_LEVEL_BONUS: Readonly<Record<DifficultyId, number>> = {
  normal: 0,
  hard: 6,
  nightmare: 12,
};

/** Gems for the first clear of a stage at each star count (cumulative per star earned). */
export const STAR_GEMS = [0, 3, 3, 4] as const;
