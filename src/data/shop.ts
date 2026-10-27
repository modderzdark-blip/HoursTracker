/**
 * The Shop: everything is bought with currency earned in play (no real money). Daily deals
 * rotate each local day from a pool; chests, eggs and the exchange are always there. Currency
 * rewards marked `scales` grow with the player's progress level so deals stay worth buying.
 */
import type { Currency } from './economy';
import type { Rarity } from './items';
import type { EggId } from './pets';

export type ShopReward =
  | {
      readonly kind: 'currency';
      readonly currency: Currency;
      readonly amount: number;
      readonly scales?: boolean;
    }
  | {
      readonly kind: 'gear';
      /** Lowest rarity rolled (pity still applies above it). */
      readonly minRarity: Rarity;
      readonly count: number;
      /** Item levels above the player's progress level. */
      readonly levelBonus: number;
    }
  | { readonly kind: 'egg'; readonly egg: EggId; readonly count: number };

/** Picture on the offer card. */
export type ShopArt =
  'gold' | 'gems' | 'souls' | 'materials' | 'tickets' | 'chest' | 'egg' | 'sparkle';

export interface ShopOffer {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly art: ShopArt;
  /** CSS accent of the card. */
  readonly tint: 'common' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'gold';
  /** null: free. */
  readonly price: { readonly currency: Currency; readonly amount: number } | null;
  /** Purchases per day (null: unlimited). */
  readonly limit: number | null;
  readonly rewards: readonly ShopReward[];
  /** Corner ribbon. */
  readonly ribbon?: string;
}

const cur = (currency: Currency, amount: number, scales = false): ShopReward => ({
  kind: 'currency',
  currency,
  amount,
  scales,
});

/** Claimed once a day, free. */
export const DAILY_GIFT: ShopOffer = {
  id: 'gift',
  name: 'Daily Tribute',
  blurb: 'The hearth-keepers leave a gift every dawn.',
  art: 'sparkle',
  tint: 'gold',
  price: null,
  limit: 1,
  rewards: [cur('gold', 1500, true), cur('materials', 10), cur('gems', 5)],
  ribbon: 'FREE',
};

/** Deals rotate from this pool (three a day, see dailyDeals). */
export const DEAL_POOL: readonly ShopOffer[] = [
  {
    id: 'deal_gold',
    name: 'Coffer of Embers',
    blurb: 'A heavy purse of gold.',
    art: 'gold',
    tint: 'gold',
    price: { currency: 'gems', amount: 40 },
    limit: 3,
    rewards: [cur('gold', 12000, true)],
    ribbon: '-40%',
  },
  {
    id: 'deal_mats',
    name: 'Smith’s Crate',
    blurb: 'Ingots and whetstones for upgrades.',
    art: 'materials',
    tint: 'rare',
    price: { currency: 'gold', amount: 6000 },
    limit: 3,
    rewards: [cur('materials', 60)],
  },
  {
    id: 'deal_souls',
    name: 'Jar of Souls',
    blurb: 'Feeds pets and wakes heroes.',
    art: 'souls',
    tint: 'epic',
    price: { currency: 'gems', amount: 60 },
    limit: 2,
    rewards: [cur('souls', 80)],
  },
  {
    id: 'deal_epic',
    name: 'Reliquary Box',
    blurb: 'One piece of gear, epic or better.',
    art: 'chest',
    tint: 'epic',
    price: { currency: 'gems', amount: 120 },
    limit: 1,
    rewards: [{ kind: 'gear', minRarity: 'epic', count: 1, levelBonus: 2 }],
    ribbon: 'HOT',
  },
  {
    id: 'deal_egg',
    name: 'Warm Ember Egg',
    blurb: 'Something inside is moving.',
    art: 'egg',
    tint: 'rare',
    price: { currency: 'souls', amount: 120 },
    limit: 1,
    rewards: [{ kind: 'egg', egg: 'ember', count: 1 }],
  },
  {
    id: 'deal_tickets',
    name: 'Bundle of Writs',
    blurb: 'Reward tickets for the Ember Cache.',
    art: 'tickets',
    tint: 'rare',
    price: { currency: 'gold', amount: 9000 },
    limit: 2,
    rewards: [cur('tickets', 2)],
  },
  {
    id: 'deal_bundle',
    name: 'Hunter’s Bundle',
    blurb: 'Gold, materials and a rare-or-better item.',
    art: 'chest',
    tint: 'legendary',
    price: { currency: 'gems', amount: 150 },
    limit: 1,
    rewards: [
      cur('gold', 8000, true),
      cur('materials', 40),
      { kind: 'gear', minRarity: 'rare', count: 1, levelBonus: 3 },
    ],
    ribbon: 'BEST VALUE',
  },
];

export const CHESTS: readonly ShopOffer[] = [
  {
    id: 'chest_iron',
    name: 'Iron Chest',
    blurb: 'One item, rare or better.',
    art: 'chest',
    tint: 'rare',
    price: { currency: 'gold', amount: 9000 },
    limit: null,
    rewards: [{ kind: 'gear', minRarity: 'rare', count: 1, levelBonus: 0 }],
  },
  {
    id: 'chest_ember',
    name: 'Ember Chest',
    blurb: 'One item, epic or better.',
    art: 'chest',
    tint: 'epic',
    price: { currency: 'gems', amount: 180 },
    limit: null,
    rewards: [{ kind: 'gear', minRarity: 'epic', count: 1, levelBonus: 2 }],
  },
  {
    id: 'chest_abyss',
    name: 'Abyss Chest',
    blurb: 'Legendary or better, from the deep.',
    art: 'chest',
    tint: 'legendary',
    price: { currency: 'gems', amount: 520 },
    limit: null,
    rewards: [{ kind: 'gear', minRarity: 'legendary', count: 1, levelBonus: 4 }],
    ribbon: 'RARE',
  },
];

export const EGG_OFFERS: readonly ShopOffer[] = [
  {
    id: 'egg_ember',
    name: 'Ember Egg',
    blurb: 'Hatches a pet. Mostly rare, sometimes more.',
    art: 'egg',
    tint: 'rare',
    price: { currency: 'gems', amount: 120 },
    limit: null,
    rewards: [{ kind: 'egg', egg: 'ember', count: 1 }],
  },
  {
    id: 'egg_abyss',
    name: 'Abyss Egg',
    blurb: 'Epic or better. A mythic serpent sleeps in some.',
    art: 'egg',
    tint: 'mythic',
    price: { currency: 'gems', amount: 420 },
    limit: null,
    rewards: [{ kind: 'egg', egg: 'abyss', count: 1 }],
    ribbon: 'MYTHIC',
  },
];

export const EXCHANGE: readonly ShopOffer[] = [
  {
    id: 'ex_gold',
    name: 'Gems to Gold',
    blurb: 'Melt gems into gold.',
    art: 'gold',
    tint: 'gold',
    price: { currency: 'gems', amount: 50 },
    limit: 10,
    rewards: [cur('gold', 10000, true)],
  },
  {
    id: 'ex_mats',
    name: 'Gold to Materials',
    blurb: 'Buy upgrade materials.',
    art: 'materials',
    tint: 'common',
    price: { currency: 'gold', amount: 2500 },
    limit: 20,
    rewards: [cur('materials', 20)],
  },
  {
    id: 'ex_souls',
    name: 'Gold to Souls',
    blurb: 'Bind lost souls with coin.',
    art: 'souls',
    tint: 'epic',
    price: { currency: 'gold', amount: 8000 },
    limit: 5,
    rewards: [cur('souls', 25)],
  },
];

export const SHOP_CONFIG = {
  /** Daily deals shown at once. */
  dealsPerDay: 3,
  /** Scaling currency rewards: × (1 + perLevel × (progress level − 1)). */
  perLevel: 0.05,
} as const;

/** Every offer that can be bought, by id. */
export function offerById(id: string): ShopOffer | undefined {
  if (id === DAILY_GIFT.id) return DAILY_GIFT;
  return [...DEAL_POOL, ...CHESTS, ...EGG_OFFERS, ...EXCHANGE].find((o) => o.id === id);
}

/** The deals on sale on a local day (deterministic, no repeats within a day). */
export function dailyDeals(day: number): ShopOffer[] {
  let seed = Math.imul(day + 1, 2654435761) >>> 0 || 1;
  const rand = (): number => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  const pool = [...DEAL_POOL];
  const out: ShopOffer[] = [];
  while (out.length < SHOP_CONFIG.dealsPerDay && pool.length > 0) {
    const i = Math.floor(rand() * pool.length);
    const [o] = pool.splice(i, 1);
    if (o !== undefined) out.push(o);
  }
  return out;
}
