import { RARITIES, type Rarity } from '../data/items';
import {
  EGGS,
  PET_CONFIG,
  PET_IDS,
  PETS,
  type EggId,
  type PetDef,
  type PetId,
  type PetStat,
} from '../data/pets';

/** One owned pet as stored in the save. */
export interface PetProgress {
  level: number;
  stars: number;
  shards: number;
}

export interface PetState {
  owned: Partial<Record<PetId, PetProgress>>;
  /** The pet that follows the hero (account-wide). */
  active: PetId | null;
}

export type PetBonus = Partial<Record<PetStat, number>>;

export function createPetState(): PetState {
  return { owned: {}, active: null };
}

/** Bonus multiplier from stars (1 star = ×1). */
export function starMult(stars: number): number {
  return 1 + PET_CONFIG.starBonus * (Math.max(1, stars) - 1);
}

/** The pet's stat bonus at its level and stars. */
export function petBonus(def: PetDef, prog: PetProgress): PetBonus {
  const out: PetBonus = {};
  const k = starMult(prog.stars);
  for (const b of def.bonus)
    out[b.stat] = (out[b.stat] ?? 0) + (b.base + b.perLevel * (prog.level - 1)) * k;
  return out;
}

/** Strike damage as a multiple of the hero's ATK. */
export function strikeMult(def: PetDef, prog: PetProgress): number {
  return def.strike.mult * starMult(prog.stars) * (1 + 0.025 * (prog.level - 1));
}

/** Souls and gold to raise a pet from `level` to `level + 1`; null at the cap. */
export function petLevelCost(level: number): { souls: number; gold: number } | null {
  if (level >= PET_CONFIG.maxLevel) return null;
  const n = level + 1;
  return {
    souls: PET_CONFIG.soulsBase * n,
    gold: Math.round(PET_CONFIG.goldBase * Math.pow(n, 1.3)),
  };
}

/** Shards needed for the next star; null at the cap. */
export function shardsForNextStar(stars: number): number | null {
  if (stars >= PET_CONFIG.maxStars) return null;
  return PET_CONFIG.shardsForStar[stars - 1] ?? null;
}

export interface HatchResult {
  readonly pet: PetId;
  /** True when this pet was not owned before (a duplicate becomes a shard). */
  readonly isNew: boolean;
}

function rollRarity(egg: EggId, rng: () => number): Rarity {
  const w = EGGS[egg].weights as Readonly<Partial<Record<Rarity, number>>>;
  let total = 0;
  for (const r of RARITIES) total += w[r] ?? 0;
  let roll = rng() * total;
  for (const r of RARITIES) {
    roll -= w[r] ?? 0;
    if (roll < 0) return r;
  }
  return 'rare';
}

/** Hatches an egg into `state`: a new pet, or a shard of one already owned. */
export function hatch(state: PetState, egg: EggId, rng: () => number): HatchResult {
  const rarity = rollRarity(egg, rng);
  const pool = PET_IDS.filter((id) => PETS[id].rarity === rarity);
  const list = pool.length > 0 ? pool : PET_IDS;
  const pet = list[Math.min(list.length - 1, Math.floor(rng() * list.length))] ?? PET_IDS[0];
  if (pet === undefined) throw new Error('no pets defined');
  const owned = state.owned[pet];
  if (owned === undefined) {
    state.owned[pet] = { level: 1, stars: 1, shards: 0 };
    if (state.active === null) state.active = pet;
    return { pet, isNew: true };
  }
  owned.shards++;
  return { pet, isNew: false };
}

/** Odds of each rarity from an egg, as fractions (for the shop's odds line). */
export function eggOdds(egg: EggId): { rarity: Rarity; chance: number }[] {
  const w = EGGS[egg].weights as Readonly<Partial<Record<Rarity, number>>>;
  let total = 0;
  for (const r of RARITIES) total += w[r] ?? 0;
  return RARITIES.filter((r) => (w[r] ?? 0) > 0).map((r) => ({
    rarity: r,
    chance: (w[r] ?? 0) / total,
  }));
}
