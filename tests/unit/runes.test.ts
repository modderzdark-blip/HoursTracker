import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/core/random';
import { enchantTier, RUNE_MILESTONES, RUNE_POOLS, RUNES } from '../../src/data/runes';
import { rollItem, runeCount, runeText, runeValue, tryEnchant } from '../../src/progression/gear';
import { PlayerProfile } from '../../src/progression/PlayerProfile';
import { sanitizeProfile } from '../../src/progression/profile';
import { Wallet } from '../../src/progression/wallet';
import { createDefaultSave } from '../../src/save/SaveStore';

describe('enchant runes', () => {
  it('an item earns one distinct rune from its slot pool at +3, +6 and +9', () => {
    const item = rollItem(mulberry32(4), 1, 'weapon', 'legendary', 20);
    const w = new Wallet({ stones: 999, gold: 1e9 });
    for (let i = 0; i < 10; i++) {
      // rng 0 always succeeds the roll.
      expect(tryEnchant(item, w, () => 0)).toBe('success');
      expect(item.runes.length).toBe(runeCount(item.ench));
    }
    expect(item.ench).toBe(10);
    expect(item.runes).toHaveLength(RUNE_MILESTONES.length);
    expect(new Set(item.runes).size).toBe(item.runes.length);
    for (const r of item.runes) expect(RUNE_POOLS.weapon).toContain(r);
  });

  it('later runes are stronger, and the text shows the value', () => {
    for (const r of Object.values(RUNES)) {
      expect(r.values[1]).toBeGreaterThan(r.values[0]);
      expect(r.values[2]).toBeGreaterThan(r.values[1]);
      expect(runeText(r.id, 1)).not.toContain('{v}');
    }
    expect(runeValue('fury', 2)).toBe(RUNES.fury.values[2]);
  });

  it('tiers follow the enchant level', () => {
    expect([0, 1, 3, 4, 6, 7, 9, 10].map(enchantTier)).toEqual([0, 1, 1, 2, 2, 3, 3, 4]);
  });

  it('runes change the hero only while the item is worn', () => {
    const p = new PlayerProfile(createDefaultSave(), () => undefined, mulberry32(2));
    const item = rollItem(mulberry32(5), 900, 'weapon', 'epic', 10);
    item.ench = 6;
    item.runes = ['fury', 'precision'];
    p.data.items.push(item);
    const base = p.mods('kael');
    p.equip('kael', item.uid);
    const worn = p.mods('kael');
    expect(worn.comboDamage).toBeCloseTo(base.comboDamage + runeValue('fury', 0), 6);
    expect(worn.critChance).toBeCloseTo(base.critChance + runeValue('precision', 1), 6);
  });

  it('saves keep valid runes, drop junk, and fill runes for items enchanted before runes', () => {
    const p = new PlayerProfile(createDefaultSave(), () => undefined, mulberry32(2));
    const a = rollItem(mulberry32(6), 901, 'ring', 'rare', 10);
    a.ench = 7;
    a.runes = ['tempest', 'cataclysm'];
    const b = rollItem(mulberry32(7), 902, 'armor', 'rare', 10);
    b.ench = 9;
    p.data.items.push(a, b);
    const raw = JSON.parse(JSON.stringify(p.data)) as { items: { uid: number; runes?: unknown }[] };
    const rb = raw.items.find((i) => i.uid === 902);
    if (rb !== undefined) rb.runes = ['nope', 'fury', 'swiftness', 'swiftness'];
    const back = sanitizeProfile(raw);
    expect(back.items.find((i) => i.uid === 901)?.runes).toEqual(['tempest', 'cataclysm']);
    const fixed = back.items.find((i) => i.uid === 902)?.runes ?? [];
    expect(fixed).toHaveLength(3);
    expect(fixed[0]).toBe('swiftness');
    expect(new Set(fixed).size).toBe(3);
    for (const r of fixed) expect(RUNE_POOLS.armor).toContain(r);
  });
});
