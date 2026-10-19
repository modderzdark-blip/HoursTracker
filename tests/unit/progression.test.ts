import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/core/random';
import { HEROES } from '../../src/data/heroes';
import { GEAR_CONFIG, RARITY_DEFS, type Rarity } from '../../src/data/items';
import { DROP_TABLES, PITY_CONFIG, XP_CONFIG } from '../../src/data/progression';
import { SKILL_TREES } from '../../src/data/skillTrees';
import { CHAPTERS } from '../../src/data/stages';
import {
  itemStats,
  mainValue,
  rollItem,
  salvageValue,
  tryUpgrade,
  upgradeCost,
  type GearItem,
} from '../../src/progression/gear';
import { computeHeroStats, heroBaseStats, powerRating } from '../../src/progression/heroStats';
import { rollDrops, rollRarity, type PityState } from '../../src/progression/loot';
import { PlayerProfile } from '../../src/progression/PlayerProfile';
import { createDefaultProfile, sanitizeProfile } from '../../src/progression/profile';
import { computeMods, rankBlock, rankUp, treeInvestment } from '../../src/progression/skillTree';
import { Wallet } from '../../src/progression/wallet';
import { addXp, totalXpToReach, xpToNext } from '../../src/progression/xp';
import { createDefaultSave } from '../../src/save/SaveStore';

const kael = HEROES.kael;

describe('XP and levels', () => {
  it('follows round(base × L^exponent) and grows monotonically', () => {
    expect(xpToNext(1)).toBe(XP_CONFIG.base);
    expect(xpToNext(4)).toBe(Math.round(XP_CONFIG.base * Math.pow(4, XP_CONFIG.exponent)));
    for (let l = 1; l < XP_CONFIG.maxLevel - 1; l++)
      expect(xpToNext(l + 1)).toBeGreaterThan(xpToNext(l));
    expect(xpToNext(XP_CONFIG.maxLevel)).toBe(0);
  });

  it('applies multi-level gains, keeps the remainder, stops at max level', () => {
    const s = { level: 1, xp: 0 };
    const gained = addXp(s, xpToNext(1) + xpToNext(2) + 7);
    expect(gained).toBe(2);
    expect(s).toEqual({ level: 3, xp: 7 });
    expect(addXp(s, -50)).toBe(0);
    expect(addXp(s, Number.NaN)).toBe(0);
    const max = { level: 1, xp: 0 };
    addXp(max, totalXpToReach(XP_CONFIG.maxLevel) + 99999);
    expect(max).toEqual({ level: XP_CONFIG.maxLevel, xp: 0 });
  });

  it('hero stats grow with level and gear', () => {
    const l1 = heroBaseStats(kael, 1);
    const l10 = heroBaseStats(kael, 10);
    expect(l1.atk).toBe(kael.stats.atk);
    expect(l10.atk).toBe(Math.round(kael.stats.atk * (1 + kael.growth.atk * 9)));
    const weapon = rollItem(mulberry32(1), 1, 'weapon', 'epic', 10);
    const withGear = computeHeroStats(kael, 10, [weapon], null);
    expect(withGear.atk).toBeGreaterThan(l10.atk);
    expect(powerRating(withGear)).toBeGreaterThan(powerRating(l10));
  });
});

describe('gear', () => {
  it('rolls substats by rarity, never duplicating a stat or the main stat', () => {
    const rng = mulberry32(7);
    for (const r of ['common', 'rare', 'epic', 'legendary', 'mythic'] as Rarity[]) {
      for (let i = 0; i < 30; i++) {
        const item = rollItem(rng, i + 1, 'ring', r, 5);
        expect(item.subs).toHaveLength(RARITY_DEFS[r].substats);
        const stats = new Set([item.main.stat, ...item.subs.map((s) => s.stat)]);
        expect(stats.size).toBe(item.subs.length + 1);
      }
    }
  });

  it('higher rarity and item level give a bigger main stat', () => {
    const a = rollItem(() => 0.5, 1, 'weapon', 'common', 1);
    const b = rollItem(() => 0.5, 2, 'weapon', 'legendary', 1);
    const c = rollItem(() => 0.5, 3, 'weapon', 'common', 20);
    expect(b.main.value).toBeGreaterThan(a.main.value);
    expect(c.main.value).toBeGreaterThan(a.main.value);
  });

  it('upgrade success rates: 100% to +10, then the configured lower rates', () => {
    const item = rollItem(() => 0.5, 1, 'weapon', 'rare', 5);
    for (let plus = 0; plus < GEAR_CONFIG.maxPlus; plus++) {
      item.plus = plus;
      const c = upgradeCost(item);
      expect(c?.successRate).toBe(GEAR_CONFIG.successRates[plus]);
      if (plus < 10) expect(c?.successRate).toBe(1);
      else expect(c?.successRate).toBeLessThan(1);
    }
    item.plus = GEAR_CONFIG.maxPlus;
    expect(upgradeCost(item)).toBeNull();
  });

  it('upgrades raise the main stat; failures cost resources but never destroy or downgrade', () => {
    const item = rollItem(() => 0.5, 1, 'weapon', 'rare', 5);
    const w = new Wallet({ gold: 1e8, materials: 1e6 });
    const before = mainValue(item);
    expect(tryUpgrade(item, w, () => 0)).toBe('success');
    expect(item.plus).toBe(1);
    expect(mainValue(item)).toBeGreaterThan(before);
    item.plus = 12;
    const gold = w.get('gold');
    expect(tryUpgrade(item, w, () => 0.999)).toBe('failed');
    expect(item.plus).toBe(12);
    expect(w.get('gold')).toBeLessThan(gold);
  });

  it('cannot upgrade without both gold and materials, and pays nothing then', () => {
    const item = rollItem(() => 0.5, 1, 'weapon', 'rare', 5);
    const w = new Wallet({ gold: 1e6, materials: 0 });
    expect(tryUpgrade(item, w, () => 0)).toBe('unaffordable');
    expect(w.get('gold')).toBe(1e6);
    expect(item.plus).toBe(0);
  });

  it('salvage scales with rarity and refunds part of the upgrade materials', () => {
    const c = rollItem(() => 0.5, 1, 'helmet', 'common', 3);
    const l = rollItem(() => 0.5, 2, 'helmet', 'legendary', 3);
    expect(salvageValue(l).materials).toBeGreaterThan(salvageValue(c).materials);
    const plain = salvageValue(l).materials;
    l.plus = 8;
    expect(salvageValue(l).materials).toBeGreaterThan(plain);
  });

  it('item stats add main + substats', () => {
    const item = rollItem(mulberry32(3), 1, 'gloves', 'epic', 4);
    const s = itemStats(item);
    expect(s[item.main.stat]).toBeGreaterThanOrEqual(item.main.value);
  });
});

describe('drop tables and pity', () => {
  it('guarantees an epic-or-better after the configured dry streak', () => {
    const pity: PityState = { sinceEpic: 0, sinceLegendary: 0 };
    // rng 0 always picks the first allowed rarity (common unless pity forces higher).
    for (let i = 0; i < PITY_CONFIG.epic - 1; i++)
      expect(rollRarity(() => 0, 'normal', pity)).toBe('common');
    expect(rollRarity(() => 0, 'normal', pity)).toBe('epic');
    expect(pity.sinceEpic).toBe(0);
  });

  it('guarantees a legendary-or-better after its dry streak', () => {
    const pity: PityState = { sinceEpic: 0, sinceLegendary: PITY_CONFIG.legendary - 1 };
    expect(rollRarity(() => 0, 'normal', pity)).toBe('legendary');
    expect(pity).toEqual({ sinceEpic: 0, sinceLegendary: 0 });
  });

  it('with random rolls, never goes longer than the pity window without an epic+', () => {
    const rng = mulberry32(99);
    const pity: PityState = { sinceEpic: 0, sinceLegendary: 0 };
    let streak = 0;
    let maxStreak = 0;
    for (let i = 0; i < 5000; i++) {
      const r = rollRarity(rng, 'normal', pity);
      if (r === 'epic' || r === 'legendary' || r === 'mythic') streak = 0;
      else maxStreak = Math.max(maxStreak, ++streak);
    }
    expect(maxStreak).toBeLessThan(PITY_CONFIG.epic);
  });

  it('harder difficulties drop better rarities on average', () => {
    const score = (d: 'normal' | 'nightmare'): number => {
      const rng = mulberry32(5);
      const pity: PityState = { sinceEpic: 0, sinceLegendary: 0 };
      const rank = { common: 0, rare: 1, epic: 2, legendary: 3, mythic: 4 };
      let sum = 0;
      for (let i = 0; i < 3000; i++) sum += rank[rollRarity(rng, d, pity)];
      return sum;
    };
    expect(score('nightmare')).toBeGreaterThan(score('normal'));
  });

  it('rolls the table item count, unique uids and materials in range', () => {
    let uid = 1;
    const pity: PityState = { sinceEpic: 0, sinceLegendary: 0 };
    const t = DROP_TABLES.boss;
    for (let s = 1; s < 50; s++) {
      const r = rollDrops(mulberry32(s), t, {
        level: 8,
        difficulty: 'hard',
        pity,
        nextUid: () => uid++,
        materialMult: 1,
      });
      expect(r.items.length === t.items || r.items.length === t.items + 1).toBe(true);
      expect(r.materials).toBeGreaterThanOrEqual(t.materials[0]);
      expect(r.materials).toBeLessThanOrEqual(t.materials[1]);
      for (const i of r.items) expect(i.ilvl).toBeGreaterThanOrEqual(8 + 6);
    }
    const challenge = rollDrops(mulberry32(1), DROP_TABLES.challenge, {
      level: 1,
      difficulty: 'normal',
      pity,
      nextUid: () => uid++,
      materialMult: 1,
    });
    for (const i of challenge.items) expect(DROP_TABLES.challenge.slots).toContain(i.slot);
  });
});

describe('skill tree', () => {
  const nodes = SKILL_TREES.kael;

  it('respects level, prerequisites, max rank and cost', () => {
    const ranks: Record<string, number> = {};
    const w = new Wallet({ souls: 10_000, gold: 1_000_000 });
    const haste = nodes.find((n) => n.id === 'kael_s0_cd');
    const power = nodes.find((n) => n.id === 'kael_s0_dmg');
    if (haste === undefined || power === undefined) throw new Error('missing nodes');
    expect(rankBlock(haste, ranks, 20, w)).toBe('requires');
    expect(rankBlock(haste, ranks, 1, w)).toBe('level');
    expect(rankUp(power, ranks, 1, w)).toBe(true);
    expect(rankUp(haste, ranks, 20, w)).toBe(true);
    for (let i = 0; i < 10; i++) rankUp(power, ranks, 20, w);
    expect(ranks[power.id]).toBe(power.maxRank);
    expect(rankBlock(power, ranks, 20, w)).toBe('maxed');
    const spent = treeInvestment(nodes, ranks);
    expect(w.get('souls')).toBe(10_000 - spent.souls);
    expect(w.get('gold')).toBe(1_000_000 - spent.gold);
  });

  it('a blocked rank-up spends nothing', () => {
    const w = new Wallet({ souls: 1, gold: 1 });
    const ranks: Record<string, number> = {};
    const power = nodes[0];
    if (power === undefined) throw new Error('no nodes');
    expect(rankUp(power, ranks, 50, w)).toBe(false);
    expect(w.get('souls')).toBe(1);
    expect(ranks).toEqual({});
  });

  it('folds ranks into mods (damage, cooldown floor, modifiers)', () => {
    const m = computeMods(nodes, {
      kael_s0_dmg: 3,
      kael_s1_cd: 3,
      kael_s0_mod: 1,
      kael_s2_mod: 1,
      kael_leech: 2,
      bogus: 4,
    });
    expect(m.skillDamage[0]).toBeCloseTo(1.3);
    expect(m.skillCooldown[1]).toBeCloseTo(1 - 0.18);
    expect(m.skillStatus[0]).toEqual({ status: 'burn', chance: 1 });
    expect(m.skillSuperArmor[2]).toBe(true);
    expect(m.lifesteal).toBeCloseTo(0.02);
  });
});

describe('profile & economy', () => {
  function makeProfile(): { profile: PlayerProfile; saves: number } {
    const save = createDefaultSave();
    const state = { saves: 0 };
    const profile = new PlayerProfile(save, () => state.saves++, mulberry32(11));
    return { profile, saves: state.saves };
  }

  it('equipping moves an item between heroes, never duplicating it', () => {
    const { profile } = makeProfile();
    const item = rollItem(() => 0.5, profile.nextUid(), 'weapon', 'rare', 3);
    profile.addLoot([item]);
    expect(profile.equip('kael', item.uid)).toBe(true);
    expect(profile.wearer(item.uid)).toBe('kael');
    expect(profile.equippedItems('kael')).toHaveLength(1);
    profile.unequip('kael', 'weapon');
    expect(profile.wearer(item.uid)).toBeNull();
  });

  it('salvage skips locked and equipped items, pays once, removes the items', () => {
    const { profile } = makeProfile();
    const items: GearItem[] = [];
    for (let i = 0; i < 4; i++)
      items.push(rollItem(() => 0.5, profile.nextUid(), 'ring', 'rare', 2));
    profile.addLoot(items);
    const [a, b, c] = items;
    if (a === undefined || b === undefined || c === undefined) throw new Error('items');
    profile.toggleLock(a.uid);
    profile.equip('kael', b.uid);
    const mats = profile.wallet.get('materials');
    const r = profile.salvage(items.map((i) => i.uid));
    expect(r.count).toBe(2);
    expect(profile.wallet.get('materials')).toBe(mats + r.materials);
    expect(profile.data.items.map((i) => i.uid).sort()).toEqual([a.uid, b.uid].sort());
    // Salvaging the same (now gone) uids again yields nothing.
    expect(profile.salvage([c.uid]).count).toBe(0);
  });

  it('a full bag auto-salvages overflow drops and reports them', () => {
    const { profile } = makeProfile();
    const many: GearItem[] = [];
    for (let i = 0; i < GEAR_CONFIG.inventoryCap + 3; i++)
      many.push(rollItem(() => 0.5, profile.nextUid(), 'helmet', 'common', 1));
    const r = profile.addLoot(many);
    expect(r.kept).toHaveLength(GEAR_CONFIG.inventoryCap);
    expect(r.salvaged.count).toBe(3);
    expect(profile.data.items).toHaveLength(GEAR_CONFIG.inventoryCap);
  });

  it('stage unlocks chain through the chapter; star gems are granted once', () => {
    const { profile } = makeProfile();
    const ch = CHAPTERS[0];
    const s1 = ch?.stages[0];
    const s2 = ch?.stages[1];
    if (s1 === undefined || s2 === undefined) throw new Error('stages');
    expect(profile.stageUnlocked(s1, 'normal')).toBe(true);
    expect(profile.stageUnlocked(s2, 'normal')).toBe(false);
    expect(profile.stageUnlocked(s1, 'hard')).toBe(false);
    const gems = profile.wallet.get('gems');
    const first = profile.submitStageResult(s1.id, 'normal', 2, 100);
    expect(first.firstClear).toBe(true);
    expect(first.starGems).toBe(6);
    expect(profile.stageUnlocked(s2, 'normal')).toBe(true);
    const again = profile.submitStageResult(s1.id, 'normal', 3, 120);
    expect(again.starGems).toBe(4);
    expect(profile.submitStageResult(s1.id, 'normal', 3, 90).starGems).toBe(0);
    expect(profile.wallet.get('gems')).toBe(gems + 10);
    expect(profile.record(s1.id, 'normal')).toEqual({ bestStars: 3, bestTimeSec: 90, clears: 3 });
  });

  it('hard difficulty opens only after clearing the chapter on normal', () => {
    const { profile } = makeProfile();
    const ch = CHAPTERS[0];
    if (ch === undefined) throw new Error('chapter');
    for (const s of ch.stages) profile.submitStageResult(s.id, 'normal', 1, 100);
    expect(profile.difficultyUnlocked(1, 'hard')).toBe(true);
    expect(profile.difficultyUnlocked(1, 'nightmare')).toBe(false);
    expect(profile.modeUnlocked('dungeon')).toBe(true);
  });

  it('XP grants level the hero', () => {
    const { profile } = makeProfile();
    expect(profile.grantXp('kael', xpToNext(1) * 3)).toBeGreaterThan(0);
    expect(profile.hero('kael').level).toBeGreaterThan(1);
  });
});

describe('profile sanitising', () => {
  it('drops broken items, de-duplicates uids, fixes cross-equips and bad numbers', () => {
    const good = rollItem(() => 0.5, 5, 'weapon', 'epic', 3);
    const p = sanitizeProfile({
      selectedHero: 'nobody',
      items: [good, { ...good }, { uid: 9, slot: 'boots', rarity: 'common' }, null, 'x'],
      nextUid: 2,
      heroes: {
        kael: { level: 999, xp: -5, equipped: { weapon: 5, ring: 77 }, skills: { a: 3, b: -1 } },
      },
      pity: { sinceEpic: -3, sinceLegendary: 'z' },
      dungeon: { entries: 99 },
      tower: { bestFloor: 12, claimed: [5, 10, 15, 'x'] },
    });
    expect(p.items).toHaveLength(1);
    expect(p.nextUid).toBe(6);
    expect(p.selectedHero).toBe('kael');
    expect(p.heroes.kael.level).toBe(XP_CONFIG.maxLevel);
    expect(p.heroes.kael.xp).toBe(0);
    expect(p.heroes.kael.equipped).toEqual({ weapon: 5 });
    expect(p.heroes.kael.skills).toEqual({ a: 3 });
    expect(p.pity).toEqual({ sinceEpic: 0, sinceLegendary: 0 });
    expect(p.dungeon.entries).toBeLessThanOrEqual(5);
    expect(p.tower.claimed).toEqual([5, 10]);
  });

  it('round-trips a default profile through JSON unchanged', () => {
    const p = createDefaultProfile(1000);
    expect(sanitizeProfile(JSON.parse(JSON.stringify(p)), 1000)).toEqual(p);
  });
});
