import { RARITIES, type Rarity } from '../data/items';
import {
  CASKETS,
  RELIC_CONFIG,
  RELIC_IDS,
  RELICS,
  type CasketId,
  type RelicDef,
  type RelicEffectKind,
  type RelicId,
} from '../data/relics';
import type { PetBonus } from './pets';
import type { HeroMods } from './skillTree';

export interface RelicState {
  owned: Partial<Record<RelicId, { level: number }>>;
  /** Relic slots (account-wide); null = empty. */
  equipped: (RelicId | null)[];
}

export function createRelicState(): RelicState {
  return { owned: {}, equipped: [null, null] };
}

/** The relic's signature effect value at a level. */
export function relicEffectValue(def: RelicDef, level: number): number {
  return def.effect.base + def.effect.perLevel * (level - 1);
}

/** The effect line ("Ultimate damage +35%"). */
export function relicEffectText(def: RelicDef, level: number): string {
  const v = relicEffectValue(def, level) * 100;
  return def.effect.text.replace('{v}', `${v.toFixed(v < 10 ? 1 : 0)}%`);
}

/** Stat bonus of a relic at a level. */
export function relicBonus(def: RelicDef, level: number): PetBonus {
  const out: PetBonus = {};
  for (const b of def.bonus) out[b.stat] = (out[b.stat] ?? 0) + b.base + b.perLevel * (level - 1);
  return out;
}

/** Adds one effect (a relic signature or an enchant rune) to `mods`, in place. */
export function applyEffect(mods: HeroMods, kind: RelicEffectKind, v: number): void {
  switch (kind) {
    case 'ultDamage':
      mods.ultDamage += v;
      break;
    case 'ultGain':
      mods.ultGain += v;
      break;
    case 'lifesteal':
      mods.lifesteal += v;
      break;
    case 'critChance':
      mods.critChance += v;
      break;
    case 'comboDamage':
      mods.comboDamage += v;
      break;
    case 'counterBonus':
      mods.counterBonus += v;
      break;
    case 'skillDamage':
      for (let i = 0; i < 3; i++) mods.skillDamage[i] = (mods.skillDamage[i] ?? 1) + v;
      break;
    case 'skillCooldown':
      for (let i = 0; i < 3; i++)
        mods.skillCooldown[i] = Math.max(0.3, (mods.skillCooldown[i] ?? 1) - v);
      break;
    case 'dodgeCooldown':
      mods.dodgeCooldown = Math.max(0.3, mods.dodgeCooldown - v);
      break;
  }
}

/** Folds equipped relics' effects into `mods` (in place) and returns it. */
export function applyRelicMods(mods: HeroMods, state: RelicState): HeroMods {
  for (const id of state.equipped) {
    if (id === null) continue;
    const owned = state.owned[id];
    if (owned === undefined) continue;
    const def = RELICS[id];
    applyEffect(mods, def.effect.kind, relicEffectValue(def, owned.level));
  }
  return mods;
}

/** Sum of the equipped relics' stat bonuses. */
export function equippedRelicBonus(state: RelicState): PetBonus {
  const out: PetBonus = {};
  for (const id of state.equipped) {
    if (id === null) continue;
    const owned = state.owned[id];
    if (owned === undefined) continue;
    for (const [k, v] of Object.entries(relicBonus(RELICS[id], owned.level)) as [
      keyof PetBonus,
      number,
    ][])
      out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

export interface CasketResult {
  readonly relic: RelicId;
  readonly isNew: boolean;
  /** Level after the casket (a duplicate raises it). */
  readonly level: number;
  /** Souls given instead when the relic was already at its maximum level. */
  readonly souls: number;
}

function rollRarity(casket: CasketId, rng: () => number): Rarity {
  const w = CASKETS[casket].weights as Readonly<Partial<Record<Rarity, number>>>;
  let total = 0;
  for (const r of RARITIES) total += w[r] ?? 0;
  let roll = rng() * total;
  for (const r of RARITIES) {
    roll -= w[r] ?? 0;
    if (roll < 0) return r;
  }
  return 'epic';
}

/** Opens a casket into `state`: a new relic, a level for one already owned, or souls. */
export function openCasket(state: RelicState, casket: CasketId, rng: () => number): CasketResult {
  const rarity = rollRarity(casket, rng);
  const pool = RELIC_IDS.filter((id) => RELICS[id].rarity === rarity);
  const list = pool.length > 0 ? pool : RELIC_IDS;
  const relic = list[Math.min(list.length - 1, Math.floor(rng() * list.length))] ?? RELIC_IDS[0];
  if (relic === undefined) throw new Error('no relics defined');
  const owned = state.owned[relic];
  if (owned === undefined) {
    state.owned[relic] = { level: 1 };
    const free = state.equipped.indexOf(null);
    if (free >= 0) state.equipped[free] = relic;
    return { relic, isNew: true, level: 1, souls: 0 };
  }
  if (owned.level >= RELIC_CONFIG.maxLevel)
    return { relic, isNew: false, level: owned.level, souls: RELIC_CONFIG.maxedDuplicateSouls };
  owned.level++;
  return { relic, isNew: false, level: owned.level, souls: 0 };
}

/** Odds of each rarity from a casket (for the shop's odds line). */
export function casketOdds(casket: CasketId): { rarity: Rarity; chance: number }[] {
  const w = CASKETS[casket].weights as Readonly<Partial<Record<Rarity, number>>>;
  let total = 0;
  for (const r of RARITIES) total += w[r] ?? 0;
  return RARITIES.filter((r) => (w[r] ?? 0) > 0).map((r) => ({
    rarity: r,
    chance: (w[r] ?? 0) / total,
  }));
}
