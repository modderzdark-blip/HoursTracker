/**
 * Gear: slots, rarities, main stats, substats, upgrade table and salvage values. Every number
 * that balances gear lives here; `src/progression/gear.ts` only applies these rules.
 */

export type GearSlot = 'weapon' | 'armor' | 'helmet' | 'gloves' | 'ring' | 'amulet';
export const GEAR_SLOTS: readonly GearSlot[] = [
  'weapon',
  'armor',
  'helmet',
  'gloves',
  'ring',
  'amulet',
];

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic';
export const RARITIES: readonly Rarity[] = ['common', 'rare', 'epic', 'legendary', 'mythic'];

/** Stats gear can roll. Flat values add to the base; *Pct values multiply (0.1 = +10%). */
export type GearStat =
  | 'hp'
  | 'atk'
  | 'def'
  | 'hpPct'
  | 'atkPct'
  | 'defPct'
  | 'critChance'
  | 'critDamage'
  | 'attackSpeed'
  | 'moveSpeed';

export const GEAR_STATS: readonly GearStat[] = [
  'hp',
  'atk',
  'def',
  'hpPct',
  'atkPct',
  'defPct',
  'critChance',
  'critDamage',
  'attackSpeed',
  'moveSpeed',
];

export interface StatMeta {
  readonly label: string;
  /** Shown as a percentage. */
  readonly percent: boolean;
  /** Flat stats grow with item level; percentages don't. */
  readonly scalesWithLevel: boolean;
}

export const STAT_META: Readonly<Record<GearStat, StatMeta>> = {
  hp: { label: 'HP', percent: false, scalesWithLevel: true },
  atk: { label: 'ATK', percent: false, scalesWithLevel: true },
  def: { label: 'DEF', percent: false, scalesWithLevel: true },
  hpPct: { label: 'HP', percent: true, scalesWithLevel: false },
  atkPct: { label: 'ATK', percent: true, scalesWithLevel: false },
  defPct: { label: 'DEF', percent: true, scalesWithLevel: false },
  critChance: { label: 'Crit rate', percent: true, scalesWithLevel: false },
  critDamage: { label: 'Crit damage', percent: true, scalesWithLevel: false },
  attackSpeed: { label: 'Attack speed', percent: true, scalesWithLevel: false },
  moveSpeed: { label: 'Move speed', percent: true, scalesWithLevel: false },
};

export interface RarityDef {
  readonly id: Rarity;
  readonly label: string;
  /** CSS colour for names and frames. */
  readonly color: string;
  /** Main stat multiplier. */
  readonly mainMult: number;
  /** Number of random substats. */
  readonly substats: number;
  /** Substat roll range multiplier (applied to the substat's base range). */
  readonly subMult: number;
  /** Upgrade cost multiplier. */
  readonly costMult: number;
  readonly salvage: { readonly materials: number; readonly gold: number };
}

export const RARITY_DEFS: Readonly<Record<Rarity, RarityDef>> = {
  common: {
    id: 'common',
    label: 'Common',
    color: '#b9b2a6',
    mainMult: 1,
    substats: 0,
    subMult: 1,
    costMult: 1,
    salvage: { materials: 2, gold: 20 },
  },
  rare: {
    id: 'rare',
    label: 'Rare',
    color: '#5aa0ff',
    mainMult: 1.25,
    substats: 1,
    subMult: 1,
    costMult: 1.3,
    salvage: { materials: 5, gold: 50 },
  },
  epic: {
    id: 'epic',
    label: 'Epic',
    color: '#b46cff',
    mainMult: 1.55,
    substats: 2,
    subMult: 1.25,
    costMult: 1.7,
    salvage: { materials: 12, gold: 120 },
  },
  legendary: {
    id: 'legendary',
    label: 'Legendary',
    color: '#ffb23d',
    mainMult: 1.9,
    substats: 3,
    subMult: 1.5,
    costMult: 2.2,
    salvage: { materials: 30, gold: 300 },
  },
  mythic: {
    id: 'mythic',
    label: 'Mythic',
    color: '#ff4a5a',
    mainMult: 2.35,
    substats: 4,
    subMult: 1.8,
    costMult: 3,
    salvage: { materials: 70, gold: 700 },
  },
};

export interface SlotDef {
  readonly id: GearSlot;
  readonly label: string;
  /** Main stat and its value at item level 1, common, +0. */
  readonly main: GearStat;
  readonly mainBase: number;
  /** Item base names (original). Index stored on the item. */
  readonly names: readonly string[];
  /** One-letter glyph for the placeholder icon. */
  readonly glyph: string;
}

export const SLOT_DEFS: Readonly<Record<GearSlot, SlotDef>> = {
  weapon: {
    id: 'weapon',
    label: 'Weapon',
    main: 'atk',
    mainBase: 18,
    names: ['Ember Edge', 'Duskfang', 'Gloam Cleaver', 'Pyre Talon', 'Hollow Brand'],
    glyph: '⚔',
  },
  armor: {
    id: 'armor',
    label: 'Armor',
    main: 'def',
    mainBase: 10,
    names: ['Cinderplate', 'Ashen Mail', 'Veilguard Coat', 'Soot Brigandine', 'Pale Hauberk'],
    glyph: '⛨',
  },
  helmet: {
    id: 'helmet',
    label: 'Helmet',
    main: 'hp',
    mainBase: 120,
    names: ['Ash Visor', 'Gloom Helm', 'Kiln Crown', 'Wraith Hood', 'Ember Casque'],
    glyph: '⛑',
  },
  gloves: {
    id: 'gloves',
    label: 'Gloves',
    main: 'atk',
    mainBase: 8,
    names: ['Char Grips', 'Bonebind Gloves', 'Smolder Gauntlets', 'Dusk Wraps', 'Ironsoot Fists'],
    glyph: '✋',
  },
  ring: {
    id: 'ring',
    label: 'Ring',
    main: 'critChance',
    mainBase: 0.03,
    names: ['Ring of Embers', 'Shadow Band', 'Coal Signet', 'Ashen Loop', 'Gloam Seal'],
    glyph: '◯',
  },
  amulet: {
    id: 'amulet',
    label: 'Amulet',
    main: 'critDamage',
    mainBase: 0.08,
    names: ['Pyre Pendant', 'Hollow Charm', 'Cinder Locket', 'Duskstone', 'Oath Talisman'],
    glyph: '✦',
  },
};

/** Substat roll ranges at item level 1 (flats grow with item level like main stats). */
export const SUBSTAT_RANGES: Readonly<Record<GearStat, readonly [number, number]>> = {
  hp: [40, 90],
  atk: [4, 9],
  def: [3, 7],
  hpPct: [0.03, 0.06],
  atkPct: [0.03, 0.06],
  defPct: [0.03, 0.06],
  critChance: [0.01, 0.025],
  critDamage: [0.03, 0.07],
  attackSpeed: [0.01, 0.03],
  moveSpeed: [0.01, 0.025],
};

export const GEAR_CONFIG = {
  /** Flat stats: value × (1 + levelGrowth × (itemLevel − 1)). */
  levelGrowth: 0.12,
  maxPlus: 15,
  /** Main stat grows by this fraction of its +0 value per upgrade level. */
  mainPerPlus: 0.08,
  /** Substats grow by this fraction per upgrade level. */
  subPerPlus: 0.03,
  /** Success rate for reaching +N (index N−1). No item is ever destroyed or downgraded. */
  successRates: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.8, 0.65, 0.5, 0.4, 0.3],
  /** Cost to reach +N: gold = goldBase × N^costExponent × rarity.costMult × (1 + ilvl × 0.05). */
  goldBase: 60,
  materialBase: 2,
  costExponent: 1.35,
  /** Salvage returns this fraction of the materials spent on upgrades. */
  salvageRefund: 0.5,
  inventoryCap: 150,
  /** Hero stat caps after gear. */
  caps: { critChance: 0.75, attackSpeed: 1.4, moveSpeedMult: 1.25 },
} as const;

/**
 * Enchanting: Enchant Stones (rare) raise an item's enchant level; every level adds a share to
 * all of the item's stats. Rare or better gear only. A failed enchant spends the cost but never
 * lowers the level or harms the item.
 */
export const ENCHANT_CONFIG = {
  maxLevel: 10,
  /** Each level: all of the item's stat values × (1 + perLevel × level). */
  perLevel: 0.06,
  /** Stones to reach level N (index N − 1). */
  stones: [1, 1, 1, 2, 2, 2, 3, 3, 4, 5],
  /** Gold to reach level N: goldBase × N^1.4 × rarity cost multiplier. */
  goldBase: 2500,
  /** Success chance to reach level N (index N − 1). */
  successRates: [1, 1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.25],
  /** Chance a boss drops a stone, by difficulty. */
  bossDrop: { normal: 0.06, hard: 0.1, nightmare: 0.15 },
} as const;
