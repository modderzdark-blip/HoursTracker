import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/core/random';
import { ENCHANT_CONFIG } from '../../src/data/items';
import { CASKETS, RELIC_CONFIG, RELIC_IDS, RELICS } from '../../src/data/relics';
import { RELIC_OFFERS, STONE_OFFERS, dailyDeals } from '../../src/data/shop';
import {
  canEnchant,
  enchantCost,
  enchantMult,
  mainValue,
  rollItem,
  tryEnchant,
} from '../../src/progression/gear';
import { PlayerProfile } from '../../src/progression/PlayerProfile';
import { sanitizeProfile } from '../../src/progression/profile';
import {
  applyRelicMods,
  casketOdds,
  createRelicState,
  openCasket,
  relicEffectText,
} from '../../src/progression/relics';
import { computeMods } from '../../src/progression/skillTree';
import { Wallet } from '../../src/progression/wallet';
import { createDefaultSave } from '../../src/save/SaveStore';

function makeProfile(seed = 5): PlayerProfile {
  return new PlayerProfile(createDefaultSave(), () => undefined, mulberry32(seed));
}

const NOON = new Date('2026-10-27T12:00:00').getTime();

describe('enchanting', () => {
  it('needs rare or better gear; costs rise and stop at the cap', () => {
    const common = rollItem(mulberry32(1), 1, 'weapon', 'common', 10);
    const rare = rollItem(mulberry32(1), 2, 'weapon', 'rare', 10);
    expect(canEnchant(common)).toBe(false);
    expect(enchantCost(common)).toBeNull();
    const first = enchantCost(rare);
    expect(first?.stones).toBe(ENCHANT_CONFIG.stones[0]);
    expect(first?.successRate).toBe(1);
    rare.ench = ENCHANT_CONFIG.maxLevel - 1;
    const last = enchantCost(rare);
    expect(last?.stones ?? 0).toBeGreaterThan(first?.stones ?? 0);
    expect(last?.gold ?? 0).toBeGreaterThan(first?.gold ?? 0);
    expect(last?.successRate ?? 1).toBeLessThan(0.5);
    rare.ench = ENCHANT_CONFIG.maxLevel;
    expect(enchantCost(rare)).toBeNull();
  });

  it('a success raises stats; a failure spends the cost but never lowers the level', () => {
    const item = rollItem(mulberry32(2), 1, 'weapon', 'epic', 10);
    const base = mainValue(item);
    const w = new Wallet({ stones: 0, gold: 1_000_000 });
    expect(tryEnchant(item, w, () => 0)).toBe('unaffordable');
    expect(w.get('gold')).toBe(1_000_000);
    w.add('stones', 100);
    expect(tryEnchant(item, w, () => 0.99)).toBe('success'); // the first level always lands
    expect(item.ench).toBe(1);
    expect(mainValue(item)).toBeGreaterThan(base);
    expect(enchantMult(item)).toBeCloseTo(1 + ENCHANT_CONFIG.perLevel, 6);
    item.ench = 5;
    const stones = w.get('stones');
    const cost = enchantCost(item);
    expect(tryEnchant(item, w, () => 0.999)).toBe('failed');
    expect(item.ench).toBe(5);
    expect(w.get('stones')).toBe(stones - (cost?.stones ?? 0));
  });

  it('enchant levels survive a save round trip and are clamped', () => {
    const p = makeProfile();
    const item = rollItem(mulberry32(3), 77, 'ring', 'legendary', 10);
    item.ench = 4;
    p.data.items.push(item);
    const back = sanitizeProfile(JSON.parse(JSON.stringify(p.data)));
    expect(back.items.find((i) => i.uid === 77)?.ench).toBe(4);
    const raw = JSON.parse(JSON.stringify(p.data)) as { items: { uid: number; ench: number }[] };
    const r = raw.items.find((i) => i.uid === 77);
    if (r !== undefined) r.ench = 999;
    expect(sanitizeProfile(raw).items.find((i) => i.uid === 77)?.ench).toBe(
      ENCHANT_CONFIG.maxLevel,
    );
  });

  it('stones are scarce: boss drop chances stay low', () => {
    for (const v of Object.values(ENCHANT_CONFIG.bossDrop)) expect(v).toBeLessThanOrEqual(0.15);
    for (const o of STONE_OFFERS) expect(o.limit).toBe(1);
  });
});

describe('relics', () => {
  it('every relic has an original name, a bonus and an effect line', () => {
    const names = new Set<string>();
    for (const id of RELIC_IDS) {
      const r = RELICS[id];
      expect(names.has(r.name)).toBe(false);
      names.add(r.name);
      expect(r.bonus.length).toBeGreaterThan(0);
      expect(relicEffectText(r, 1)).toMatch(/\d/);
      expect(relicEffectText(r, 1)).not.toContain('{v}');
    }
  });

  it('caskets: a new relic auto-equips, duplicates level up, maxed ones give souls', () => {
    const s = createRelicState();
    const rng = mulberry32(9);
    const first = openCasket(s, 'reliquary', rng);
    expect(first.isNew).toBe(true);
    expect(s.equipped[0]).toBe(first.relic);
    s.owned[first.relic] = { level: RELIC_CONFIG.maxLevel };
    // Open until the same relic shows up again.
    let dup = null;
    for (let i = 0; i < 400 && dup === null; i++) {
      const r = openCasket(s, 'reliquary', rng);
      if (r.relic === first.relic) dup = r;
    }
    expect(dup?.souls).toBe(RELIC_CONFIG.maxedDuplicateSouls);
    expect(s.owned[first.relic]?.level).toBe(RELIC_CONFIG.maxLevel);
    for (const id of RELIC_IDS)
      expect(s.owned[id]?.level ?? 1).toBeLessThanOrEqual(RELIC_CONFIG.maxLevel);
  });

  it('casket odds add up; sealed caskets never give epics', () => {
    for (const c of Object.keys(CASKETS) as (keyof typeof CASKETS)[]) {
      const sum = casketOdds(c).reduce((a, o) => a + o.chance, 0);
      expect(sum).toBeCloseTo(1, 6);
    }
    expect(casketOdds('sealed').some((o) => o.rarity === 'epic')).toBe(false);
  });

  it('equipped relics change the hero modifiers; unequipped ones do not', () => {
    const s = createRelicState();
    s.owned.pyre_heart = { level: 1 };
    s.owned.widows_hourglass = { level: 1 };
    const base = computeMods([], {});
    expect(applyRelicMods(computeMods([], {}), s).ultDamage).toBe(base.ultDamage);
    s.equipped = ['pyre_heart', 'widows_hourglass'];
    const m = applyRelicMods(computeMods([], {}), s);
    expect(m.ultDamage).toBeCloseTo(base.ultDamage + RELICS.pyre_heart.effect.base, 6);
    expect(m.skillCooldown[0] ?? 1).toBeLessThan(base.skillCooldown[0] ?? 1);
  });

  it('a profile buys a casket, gains power from it, and keeps relics through a save', () => {
    const p = makeProfile();
    const offer = RELIC_OFFERS.find((o) => o.id === 'relic_casket');
    if (offer === undefined) throw new Error('missing offer');
    const hero = p.selectedHero;
    const before = p.power(hero);
    p.wallet.add('gems', 10_000);
    const r = p.buy(offer, NOON);
    expect(r?.relics.length).toBe(1);
    const id = r?.relics[0]?.relic;
    expect(id).toBeDefined();
    expect(p.equippedRelics).toContain(id);
    expect(p.power(hero)).toBeGreaterThan(before);
    // Daily limit.
    for (let i = 0; i < 5; i++) p.buy(offer, NOON);
    expect(p.shopBlock(offer, NOON)).toBe('limit');
    if (id === undefined) return;
    p.unequipRelic(id);
    expect(p.equippedRelics).not.toContain(id);
    expect(p.equipRelic(id, 1)).toBe(true);
    const back = sanitizeProfile(JSON.parse(JSON.stringify(p.data)));
    expect(back.relics.owned[id]?.level).toBe(p.relic(id)?.level);
    expect(back.relics.equipped[1]).toBe(id);
    const junk = sanitizeProfile({
      relics: {
        owned: { nope: { level: 2 }, gaolers_key: { level: 99 } },
        equipped: ['nope', 'x'],
      },
    });
    expect(junk.relics.owned.gaolers_key?.level).toBe(RELIC_CONFIG.maxLevel);
    expect(junk.relics.equipped).toEqual([null, null]);
  });

  it('daily deals can include the new stone and relic deals', () => {
    const seen = new Set<string>();
    for (let d = 0; d < 200; d++) for (const o of dailyDeals(d)) seen.add(o.id);
    expect(seen.has('deal_stone')).toBe(true);
    expect(seen.has('deal_relic')).toBe(true);
  });
});
