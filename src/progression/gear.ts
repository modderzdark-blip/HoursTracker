import {
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

/** Current value of the main stat (with upgrades). */
export function mainValue(item: GearItem): number {
  return round(item.main.stat, item.main.value * (1 + GEAR_CONFIG.mainPerPlus * item.plus));
}

export function subValue(item: GearItem, roll: StatRoll): number {
  return round(roll.stat, roll.value * (1 + GEAR_CONFIG.subPerPlus * item.plus));
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
