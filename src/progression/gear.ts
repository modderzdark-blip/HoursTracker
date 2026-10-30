import { RUNE_MILESTONES, RUNE_POOLS, RUNES, type RuneId } from '../data/runes';
import {
  ENCHANT_CONFIG,
  GEAR_CONFIG,
  GEAR_STATS,
  RARITY_DEFS,
  SLOT_DEFS,
  STAT_META,
  SUBSTAT_RANGES,
  type GearSlot,
  type GearStat,
  type Rarity,
} from '../data/items';
import type { Wallet } from './wallet';

export interface StatRoll {
  readonly stat: GearStat;
  /** Value at +0. */
  readonly value: number;
}

/** A piece of gear as stored in the save. */
export interface GearItem {
  readonly uid: number;
  readonly slot: GearSlot;
  readonly rarity: Rarity;
  /** Index into SLOT_DEFS[slot].names. */
  readonly base: number;
  /** Item level (scales flat stats). */
  readonly ilvl: number;
  /** Upgrade level 0..GEAR_CONFIG.maxPlus. */
  plus: number;
  /** Enchant level 0..ENCHANT_CONFIG.maxLevel (Enchant Stones). */
  ench: number;
  /** Runes earned at enchant +3 / +6 / +9, in order. */
  runes: RuneId[];
  readonly main: StatRoll;
  readonly subs: readonly StatRoll[];
  locked: boolean;
  isNew: boolean;
}

export type StatTotals = Record<GearStat, number>;

export function emptyTotals(): StatTotals {
  return {
    hp: 0,
    atk: 0,
    def: 0,
    hpPct: 0,
    atkPct: 0,
    defPct: 0,
    critChance: 0,
    critDamage: 0,
    attackSpeed: 0,
    moveSpeed: 0,
  };
}

function levelFactor(stat: GearStat, ilvl: number): number {
  return STAT_META[stat].scalesWithLevel ? 1 + GEAR_CONFIG.levelGrowth * (ilvl - 1) : 1;
}

function round(stat: GearStat, v: number): number {
  return STAT_META[stat].percent ? Math.round(v * 1000) / 1000 : Math.round(v);
}

/** Creates a random item. `rng` returns [0, 1). */
export function rollItem(
  rng: () => number,
  uid: number,
  slot: GearSlot,
  rarity: Rarity,
  ilvl: number,
): GearItem {
  const slotDef = SLOT_DEFS[slot];
  const r = RARITY_DEFS[rarity];
  const level = Math.max(1, Math.floor(ilvl));
  const mainValue = round(
    slotDef.main,
    slotDef.mainBase * r.mainMult * levelFactor(slotDef.main, level) * (0.95 + rng() * 0.1),
  );
  const pool = GEAR_STATS.filter((s) => s !== slotDef.main);
  const subs: StatRoll[] = [];
  for (let i = 0; i < r.substats && pool.length > 0; i++) {
    const idx = Math.floor(rng() * pool.length);
    const stat = pool.splice(idx, 1)[0];
    if (stat === undefined) break;
    const [lo, hi] = SUBSTAT_RANGES[stat];
    const v = (lo + (hi - lo) * rng()) * r.subMult * levelFactor(stat, level);
    subs.push({ stat, value: round(stat, v) });
  }
  return {
    uid,
    slot,
    rarity,
    base: Math.floor(rng() * slotDef.names.length),
    ilvl: level,
    plus: 0,
    ench: 0,
    runes: [],
    main: { stat: slotDef.main, value: mainValue },
    subs,
    locked: false,
    isNew: true,
  };
}

export function itemName(item: GearItem): string {
  const names = SLOT_DEFS[item.slot].names;
  return names[item.base % names.length] ?? SLOT_DEFS[item.slot].label;
}

/** Stat multiplier from the item's enchant level. */
export function enchantMult(item: Pick<GearItem, 'ench'>): number {
  return 1 + ENCHANT_CONFIG.perLevel * item.ench;
}

/** Current value of the main stat (with upgrades and enchantment). */
export function mainValue(item: GearItem): number {
  return round(
    item.main.stat,
    item.main.value * (1 + GEAR_CONFIG.mainPerPlus * item.plus) * enchantMult(item),
  );
}

export function subValue(item: GearItem, roll: StatRoll): number {
  return round(
    roll.stat,
    roll.value * (1 + GEAR_CONFIG.subPerPlus * item.plus) * enchantMult(item),
  );
}

export interface EnchantCost {
  readonly stones: number;
  readonly gold: number;
  readonly successRate: number;
}

/** Whether the item can carry enchantments (rare or better). */
export function canEnchant(item: Pick<GearItem, 'rarity'>): boolean {
  return item.rarity !== 'common';
}

/** Cost of the next enchant level; null at the cap or for common gear. */
export function enchantCost(item: GearItem): EnchantCost | null {
  if (!canEnchant(item) || item.ench >= ENCHANT_CONFIG.maxLevel) return null;
  const n = item.ench + 1;
  return {
    stones: ENCHANT_CONFIG.stones[n - 1] ?? 5,
    gold: Math.round(
      ENCHANT_CONFIG.goldBase * Math.pow(n, 1.4) * RARITY_DEFS[item.rarity].costMult,
    ),
    successRate: ENCHANT_CONFIG.successRates[n - 1] ?? 0.25,
  };
}

export type EnchantOutcome = 'success' | 'failed' | 'maxed' | 'unaffordable';

/** Pays the cost (all or nothing) and rolls; a failure never lowers the level. */
export function tryEnchant(item: GearItem, wallet: Wallet, rng: () => number): EnchantOutcome {
  const cost = enchantCost(item);
  if (cost === null) return 'maxed';
  if (!wallet.canAfford('stones', cost.stones) || !wallet.canAfford('gold', cost.gold))
    return 'unaffordable';
  wallet.spend('stones', cost.stones);
  wallet.spend('gold', cost.gold);
  if (rng() < cost.successRate) {
    item.ench++;
    if (item.runes.length < runeCount(item.ench)) item.runes.push(rollRune(item, rng));
    return 'success';
  }
  return 'failed';
}

/** Runes an item at this enchant level carries. */
export function runeCount(ench: number): number {
  return RUNE_MILESTONES.filter((m) => ench >= m).length;
}

/** A rune from the item's slot pool that it does not carry yet. */
export function rollRune(item: Pick<GearItem, 'slot' | 'runes'>, rng: () => number): RuneId {
  const pool = RUNE_POOLS[item.slot].filter((r) => !item.runes.includes(r));
  const list = pool.length > 0 ? pool : RUNE_POOLS[item.slot];
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))] ?? 'fury';
}

/** Strength of the item's `index`-th rune (later milestones give stronger runes). */
export function runeValue(id: RuneId, index: number): number {
  return RUNES[id].values[Math.min(2, Math.max(0, index))] ?? 0;
}

/** The rune's effect line ("Combo damage +8%"). */
export function runeText(id: RuneId, index: number): string {
  const v = runeValue(id, index) * 100;
  return RUNES[id].text.replace('{v}', `${v.toFixed(v < 10 ? 1 : 0)}%`);
}

/** Adds the item's stats into `out`. */
export function addItemStats(item: GearItem, out: StatTotals): StatTotals {
  out[item.main.stat] += mainValue(item);
  for (const s of item.subs) out[s.stat] += subValue(item, s);
  return out;
}

export function itemStats(item: GearItem): StatTotals {
  return addItemStats(item, emptyTotals());
}

export function formatStat(stat: GearStat, value: number): string {
  const meta = STAT_META[stat];
  if (meta.percent) return `+${(value * 100).toFixed(1).replace(/\.0$/, '')}% ${meta.label}`;
  return `+${Math.round(value)} ${meta.label}`;
}

export interface UpgradeCost {
  readonly gold: number;
  readonly materials: number;
  readonly successRate: number;
}

/** Cost and success rate of the next upgrade, or null when the item is maxed. */
export function upgradeCost(item: GearItem): UpgradeCost | null {
  const next = item.plus + 1;
  if (next > GEAR_CONFIG.maxPlus) return null;
  const r = RARITY_DEFS[item.rarity];
  const scale = Math.pow(next, GEAR_CONFIG.costExponent) * r.costMult;
  return {
    gold: Math.round(GEAR_CONFIG.goldBase * scale * (1 + item.ilvl * 0.05)),
    materials: Math.max(1, Math.round(GEAR_CONFIG.materialBase * scale)),
    successRate: GEAR_CONFIG.successRates[next - 1] ?? 0,
  };
}

export type UpgradeOutcome = 'success' | 'failed' | 'maxed' | 'unaffordable';

/**
 * Pays the cost and rolls the success chance. A failure consumes the cost but never destroys or
 * downgrades the item. Payment is all-or-nothing (no partial spend).
 */
export function tryUpgrade(item: GearItem, wallet: Wallet, rng: () => number): UpgradeOutcome {
  const cost = upgradeCost(item);
  if (cost === null) return 'maxed';
  if (!wallet.canAfford('gold', cost.gold) || !wallet.canAfford('materials', cost.materials))
    return 'unaffordable';
  wallet.spend('gold', cost.gold);
  wallet.spend('materials', cost.materials);
  if (rng() < cost.successRate) {
    item.plus++;
    return 'success';
  }
  return 'failed';
}

/** Materials spent to bring an item from +0 to its current level (for salvage refunds). */
export function materialsInvested(item: GearItem): number {
  const r = RARITY_DEFS[item.rarity];
  let sum = 0;
  for (let n = 1; n <= item.plus; n++) {
    sum += Math.max(
      1,
      Math.round(GEAR_CONFIG.materialBase * Math.pow(n, GEAR_CONFIG.costExponent) * r.costMult),
    );
  }
  return sum;
}

export function salvageValue(item: GearItem): { materials: number; gold: number } {
  const r = RARITY_DEFS[item.rarity];
  const levelBonus = 1 + item.ilvl * 0.04;
  return {
    materials:
      Math.round(r.salvage.materials * levelBonus) +
      Math.floor(materialsInvested(item) * GEAR_CONFIG.salvageRefund),
    gold: Math.round(r.salvage.gold * levelBonus),
  };
}

/** Rough strength of an item for sorting / the "power" display. */
export function itemPower(item: GearItem): number {
  const s = itemStats(item);
  return Math.round(
    s.atk * 3 +
      s.hp * 0.25 +
      s.def * 2 +
      (s.atkPct + s.hpPct + s.defPct) * 400 +
      s.critChance * 900 +
      s.critDamage * 350 +
      (s.attackSpeed + s.moveSpeed) * 600,
  );
}
