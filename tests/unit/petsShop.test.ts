import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/core/random';
import { GEAR_CONFIG } from '../../src/data/items';
import { PET_CONFIG, PET_IDS, PETS } from '../../src/data/pets';
import {
  CHESTS,
  DAILY_GIFT,
  dailyDeals,
  DEAL_POOL,
  EGG_OFFERS,
  EXCHANGE,
} from '../../src/data/shop';
import {
  createPetState,
  eggOdds,
  hatch,
  petBonus,
  petLevelCost,
  shardsForNextStar,
} from '../../src/progression/pets';
import { PlayerProfile } from '../../src/progression/PlayerProfile';
import { sanitizeProfile } from '../../src/progression/profile';
import { createDefaultSave } from '../../src/save/SaveStore';

function makeProfile(seed = 5): PlayerProfile {
  return new PlayerProfile(createDefaultSave(), () => undefined, mulberry32(seed));
}

const NOON = new Date('2026-10-27T12:00:00').getTime();

describe('pets', () => {
  it('every pet has an original name, a bonus, a strike and a look', () => {
    const names = new Set<string>();
    for (const id of PET_IDS) {
      const p = PETS[id];
      expect(names.has(p.name)).toBe(false);
      names.add(p.name);
      expect(p.bonus.length).toBeGreaterThan(0);
      expect(p.strike.everySec).toBeGreaterThan(1);
      expect(p.strike.mult).toBeGreaterThan(0);
    }
  });

  it('bonus grows with level and stars', () => {
    const def = PETS.ashwing_drake;
    const a = petBonus(def, { level: 1, stars: 1, shards: 0 }).atkPct ?? 0;
    const b = petBonus(def, { level: 10, stars: 1, shards: 0 }).atkPct ?? 0;
    const c = petBonus(def, { level: 10, stars: 3, shards: 0 }).atkPct ?? 0;
    expect(a).toBeCloseTo(0.05, 6);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeCloseTo(b * 1.4, 6);
  });

  it('level costs grow and stop at the cap; stars need more shards each time', () => {
    const c1 = petLevelCost(1);
    const c20 = petLevelCost(20);
    expect(c1).not.toBeNull();
    expect(c20?.gold ?? 0).toBeGreaterThan(c1?.gold ?? 0);
    expect(petLevelCost(PET_CONFIG.maxLevel)).toBeNull();
    expect(shardsForNextStar(1)).toBe(1);
    expect(shardsForNextStar(4)).toBe(8);
    expect(shardsForNextStar(PET_CONFIG.maxStars)).toBeNull();
  });

  it('hatching gives a new pet once, then shards; the first pet becomes active', () => {
    const s = createPetState();
    const rng = mulberry32(3);
    const first = hatch(s, 'ember', rng);
    expect(first.isNew).toBe(true);
    expect(s.active).toBe(first.pet);
    let dupes = 0;
    for (let i = 0; i < 200; i++) if (!hatch(s, 'ember', rng).isNew) dupes++;
    expect(dupes).toBeGreaterThan(150);
    const shards = Object.values(s.owned).reduce((n, p) => n + (p?.shards ?? 0), 0);
    expect(shards).toBe(dupes);
  });

  it('egg odds add up and abyss eggs never give rares', () => {
    for (const egg of ['ember', 'abyss'] as const) {
      const sum = eggOdds(egg).reduce((n, o) => n + o.chance, 0);
      expect(sum).toBeCloseTo(1, 9);
    }
    expect(eggOdds('abyss').some((o) => o.rarity === 'rare')).toBe(false);
    const s = createPetState();
    const rng = mulberry32(9);
    for (let i = 0; i < 100; i++) {
      const r = hatch(s, 'abyss', rng);
      expect(PETS[r.pet].rarity).not.toBe('rare');
    }
  });

  it('the active pet raises the hero’s stats and power; level-up and ascend spend correctly', () => {
    const p = makeProfile();
    const before = p.stats('kael');
    p.data.pets.owned.ashwing_drake = { level: 1, stars: 1, shards: 3 };
    expect(p.setActivePet('ashwing_drake')).toBe(true);
    const after = p.stats('kael');
    expect(after.atk).toBeGreaterThan(before.atk);
    expect(after.critChance).toBeGreaterThan(before.critChance);
    expect(p.petCompanion()?.def.id).toBe('ashwing_drake');
    // Level up needs souls and gold.
    expect(p.levelUpPet('ashwing_drake')).toBe(false);
    p.wallet.add('souls', 1000);
    p.wallet.add('gold', 100000);
    expect(p.levelUpPet('ashwing_drake')).toBe(true);
    expect(p.pet('ashwing_drake')?.level).toBe(2);
    // Ascend: 1 shard for 2 stars, 2 more for 3 stars, then not enough.
    expect(p.ascendPet('ashwing_drake')).toBe(true);
    expect(p.ascendPet('ashwing_drake')).toBe(true);
    expect(p.pet('ashwing_drake')?.stars).toBe(3);
    expect(p.ascendPet('ashwing_drake')).toBe(false);
    // Unowned pets cannot be made active.
    expect(p.setActivePet('void_serpent')).toBe(false);
  });

  it('pets survive a save round trip and junk is dropped', () => {
    const p = makeProfile();
    p.data.pets.owned.hollow_owl = { level: 7, stars: 2, shards: 1 };
    p.data.pets.active = 'hollow_owl';
    const back = sanitizeProfile(JSON.parse(JSON.stringify(p.data)));
    expect(back.pets.owned.hollow_owl).toEqual({ level: 7, stars: 2, shards: 1 });
    expect(back.pets.active).toBe('hollow_owl');
    const junk = sanitizeProfile({
      pets: { owned: { nope: { level: 3 }, ember_fox: { level: 999, stars: -2 } }, active: 'nope' },
    });
    expect(junk.pets.owned.ember_fox).toEqual({ level: PET_CONFIG.maxLevel, stars: 1, shards: 0 });
    expect(junk.pets.active).toBeNull();
  });
});

describe('shop', () => {
  it('daily deals are deterministic per day, distinct, and change between days', () => {
    const a = dailyDeals(100).map((o) => o.id);
    expect(dailyDeals(100).map((o) => o.id)).toEqual(a);
    expect(new Set(a).size).toBe(a.length);
    const seen = new Set<string>();
    for (let d = 0; d < 30; d++) for (const o of dailyDeals(d)) seen.add(o.id);
    expect(seen.size).toBeGreaterThan(DEAL_POOL.length / 2);
  });

  it('every offer has a positive price (or is free) and gives something', () => {
    for (const o of [DAILY_GIFT, ...DEAL_POOL, ...CHESTS, ...EGG_OFFERS, ...EXCHANGE]) {
      expect(o.rewards.length).toBeGreaterThan(0);
      if (o.price !== null) expect(o.price.amount).toBeGreaterThan(0);
    }
  });

  it('the free gift is claimable once per day', () => {
    const p = makeProfile();
    const gold = p.wallet.get('gold');
    expect(p.buy(DAILY_GIFT, NOON)).not.toBeNull();
    expect(p.wallet.get('gold')).toBeGreaterThan(gold);
    expect(p.shopBlock(DAILY_GIFT, NOON)).toBe('limit');
    expect(p.buy(DAILY_GIFT, NOON)).toBeNull();
    // Next day it is back.
    expect(p.shopBlock(DAILY_GIFT, NOON + 86_400_000)).toBeNull();
  });

  it('a purchase charges the price and hands over gear, pets or currency', () => {
    const p = makeProfile();
    const chest = CHESTS.find((c) => c.id === 'chest_ember');
    const egg = EGG_OFFERS.find((c) => c.id === 'egg_abyss');
    if (chest === undefined || egg === undefined) throw new Error('missing offers');
    expect(p.shopBlock(chest, NOON)).toBe('funds');
    p.wallet.add('gems', 2000);
    const gems = p.wallet.get('gems');
    const r = p.buy(chest, NOON);
    expect(r?.items.length).toBe(1);
    const item = r?.items[0];
    expect(['epic', 'legendary', 'mythic']).toContain(item?.rarity);
    expect(p.wallet.get('gems')).toBe(gems - (chest.price?.amount ?? 0));
    const e = p.buy(egg, NOON);
    expect(e?.pets.length).toBe(1);
    expect(p.data.pets.active).not.toBeNull();
  });

  it('gear is not bought into a full bag', () => {
    const p = makeProfile();
    p.wallet.add('gold', 1_000_000);
    const iron = CHESTS[0];
    if (iron === undefined) throw new Error('missing chest');
    p.wallet.add('gold', 10_000_000);
    for (let i = 0; i < GEAR_CONFIG.inventoryCap * 2; i++) if (p.buy(iron, NOON) === null) break;
    expect(p.data.items.length).toBe(GEAR_CONFIG.inventoryCap);
    expect(p.shopBlock(iron, NOON)).toBe('bag');
    expect(p.buy(iron, NOON)).toBeNull();
  });

  it('shop limits survive a save round trip', () => {
    const p = makeProfile();
    p.buy(DAILY_GIFT, NOON);
    const back = sanitizeProfile(JSON.parse(JSON.stringify(p.data)));
    expect(back.shop.bought['gift']).toBe(1);
  });

  it('auto-equip picks the strongest free item per slot', () => {
    const p = makeProfile();
    p.wallet.add('gold', 1_000_000);
    const iron = CHESTS[0];
    if (iron === undefined) throw new Error('missing chest');
    for (let i = 0; i < 12; i++) p.buy(iron, NOON);
    const before = p.power('kael');
    expect(p.autoEquip('kael')).toBeGreaterThan(0);
    expect(p.power('kael')).toBeGreaterThan(before);
    expect(p.autoEquip('kael')).toBe(0);
  });
});
