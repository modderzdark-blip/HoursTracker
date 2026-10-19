import type { DifficultyId } from '../data/difficulty';
import { GEAR_SLOTS, RARITIES, type GearSlot, type Rarity } from '../data/items';
import {
  DIFFICULTY_ITEM_LEVEL_BONUS,
  LOOT_CONFIG,
  PITY_CONFIG,
  RARITY_WEIGHTS,
  type DropTable,
} from '../data/progression';
import { rollItem, type GearItem } from './gear';

export interface PityState {
  /** Drops in a row below epic. */
  sinceEpic: number;
  /** Drops in a row below legendary. */
  sinceLegendary: number;
}

const RANK: Readonly<Record<Rarity, number>> = {
  common: 0,
  rare: 1,
  epic: 2,
  legendary: 3,
  mythic: 4,
};

function weightedRarity(
  rng: () => number,
  weights: Readonly<Record<Rarity, number>>,
  min: Rarity,
): Rarity {
  let total = 0;
  for (const r of RARITIES) if (RANK[r] >= RANK[min]) total += weights[r];
  let roll = rng() * total;
  for (const r of RARITIES) {
    if (RANK[r] < RANK[min]) continue;
    roll -= weights[r];
    if (roll < 0) return r;
  }
  return min;
}

/**
 * Rolls a rarity with the pity system: after PITY_CONFIG.epic drops below epic the next drop is
 * at least epic (likewise for legendary). Updates `pity` in place.
 */
export function rollRarity(rng: () => number, difficulty: DifficultyId, pity: PityState): Rarity {
  let min: Rarity = 'common';
  if (pity.sinceLegendary + 1 >= PITY_CONFIG.legendary) min = 'legendary';
  else if (pity.sinceEpic + 1 >= PITY_CONFIG.epic) min = 'epic';
  const rarity = weightedRarity(rng, RARITY_WEIGHTS[difficulty], min);
  pity.sinceEpic = RANK[rarity] >= RANK.epic ? 0 : pity.sinceEpic + 1;
  pity.sinceLegendary = RANK[rarity] >= RANK.legendary ? 0 : pity.sinceLegendary + 1;
  return rarity;
}

export interface LootContext {
  readonly level: number;
  readonly difficulty: DifficultyId;
  readonly pity: PityState;
  /** Returns a fresh item uid. */
  readonly nextUid: () => number;
  /** Multiplies material rewards (difficulty / mode bonuses). */
  readonly materialMult: number;
}

export interface LootResult {
  readonly items: GearItem[];
  readonly materials: number;
  readonly tickets: number;
}

export function rollItemLevel(
  rng: () => number,
  level: number,
  difficulty: DifficultyId,
  rarity: Rarity,
): number {
  return (
    Math.max(1, Math.floor(level)) +
    DIFFICULTY_ITEM_LEVEL_BONUS[difficulty] +
    Math.floor(rng() * (LOOT_CONFIG.itemLevelSpread + 1)) +
    LOOT_CONFIG.rarityLevelBonus[rarity]
  );
}

/** Rolls one drop table. */
export function rollDrops(rng: () => number, table: DropTable, ctx: LootContext): LootResult {
  const count = table.items + (rng() < table.bonusItemChance ? 1 : 0);
  const slots: readonly GearSlot[] = table.slots.length > 0 ? table.slots : GEAR_SLOTS;
  const items: GearItem[] = [];
  for (let i = 0; i < count; i++) {
    const rarity = rollRarity(rng, ctx.difficulty, ctx.pity);
    const slot = slots[Math.floor(rng() * slots.length)] ?? 'weapon';
    items.push(
      rollItem(
        rng,
        ctx.nextUid(),
        slot,
        rarity,
        rollItemLevel(rng, ctx.level, ctx.difficulty, rarity),
      ),
    );
  }
  const [lo, hi] = table.materials;
  const materials = Math.round((lo + Math.floor(rng() * (hi - lo + 1))) * ctx.materialMult);
  const tickets = rng() < table.ticketChance ? 1 : 0;
  return { items, materials, tickets };
}
