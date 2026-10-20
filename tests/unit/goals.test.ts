import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/core/random';
import { BOSSES } from '../../src/data/bosses';
import {
  ACHIEVEMENTS,
  BLESSING_CONFIG,
  DAILY_CONFIG,
  DAILY_QUESTS,
  HEARTH_CONFIG,
  LOGIN_REWARDS,
} from '../../src/data/goals';
import { HEROES } from '../../src/data/heroes';
import { GEAR_SLOTS } from '../../src/data/items';
import { XP_CONFIG } from '../../src/data/progression';
import { CHAPTERS } from '../../src/data/stages';
import { defenseFactor } from '../../src/combat/damage';
import { enemyScaleFor } from '../../src/progression/enemyScale';
import { rollItem } from '../../src/progression/gear';
import {
  blessingFor,
  claimableTiers,
  claimLogin,
  createDailyState,
  hearthYield,
  localDay,
  questsForDay,
  refreshDaily,
  trackQuests,
} from '../../src/progression/goals';
import { computeHeroStats, powerRating } from '../../src/progression/heroStats';
import { PlayerProfile } from '../../src/progression/PlayerProfile';
import { sanitizeProfile } from '../../src/progression/profile';
import { Wallet } from '../../src/progression/wallet';
import { addXp } from '../../src/progression/xp';
import { createDefaultSave } from '../../src/save/SaveStore';
import { recommendedPower } from '../../src/ui/menu/stageMapScreen';

function makeProfile(): PlayerProfile {
  return new PlayerProfile(createDefaultSave(), () => undefined, mulberry32(5));
}

const all = (): boolean => true;
const HOUR = 3_600_000;

describe('daily quests', () => {
  it('offers 3 distinct quests per day, the same ones all day, others on other days', () => {
    const a = questsForDay(20_000, all);
    expect(a).toHaveLength(DAILY_CONFIG.questsPerDay);
    expect(new Set(a.map((q) => q.id)).size).toBe(a.length);
    expect(questsForDay(20_000, all).map((q) => q.id)).toEqual(a.map((q) => q.id));
    const seen = new Set<string>();
    for (let d = 0; d < 30; d++) for (const q of questsForDay(20_000 + d, all)) seen.add(q.id);
    expect(seen.size).toBeGreaterThan(DAILY_CONFIG.questsPerDay * 2);
  });

  it('never offers a quest for a locked mode', () => {
    for (let d = 0; d < 60; d++)
      for (const q of questsForDay(d, (x) => x.needsMode === undefined))
        expect(q.needsMode).toBeUndefined();
  });

  it('progress counts, caps at the target, claims once, and the bonus needs all claimed', () => {
    const d = createDailyState();
    refreshDaily(d, 100, all);
    const w = new Wallet();
    for (const q of d.quests) {
      const def = DAILY_QUESTS.find((x) => x.id === q.id);
      if (def === undefined) throw new Error('missing');
      trackQuests(d, def.event, def.target * 5);
      expect(q.progress).toBe(def.target);
    }
    const p = makeProfile();
    p.data.daily = d;
    expect(p.dailyBonusReady).toBe(false);
    for (const q of d.quests) {
      expect(p.claimQuest(q.id)).toBe(true);
      expect(p.claimQuest(q.id)).toBe(false);
    }
    const gems = p.wallet.get('gems');
    expect(p.claimDailyBonus()).toBe(true);
    expect(p.claimDailyBonus()).toBe(false);
    expect(p.wallet.get('gems')).toBe(gems + (DAILY_CONFIG.allDoneBonus.gems ?? 0));
    expect(w.get('gold')).toBe(0);
  });

  it('a new day rolls a fresh list; the same day keeps progress', () => {
    const d = createDailyState();
    refreshDaily(d, 7, all);
    const first = d.quests[0];
    if (first === undefined) throw new Error('no quests');
    first.progress = 1;
    expect(refreshDaily(d, 7, all)).toBe(false);
    expect(d.quests[0]?.progress).toBe(1);
    expect(refreshDaily(d, 8, all)).toBe(true);
    expect(d.quests.every((q) => q.progress === 0 && !q.claimed)).toBe(true);
  });

  it('local day follows the time-zone offset', () => {
    const t = Date.UTC(2026, 0, 2, 23, 30);
    expect(localDay(t, 0)).toBe(localDay(t + HOUR, 0) - 1);
    // UTC+2 (offset −120): 23:30 UTC is already the next local day.
    expect(localDay(t, -120)).toBe(localDay(t, 0) + 1);
  });
});

describe('login calendar', () => {
  it('pays once per day, walks the 7-day cycle, and never resets on a missed day', () => {
    const d = createDailyState();
    const w = new Wallet();
    expect(claimLogin(d, 10, w)).toEqual(LOGIN_REWARDS[0]);
    expect(claimLogin(d, 10, w)).toBeNull();
    expect(claimLogin(d, 15, w)).toEqual(LOGIN_REWARDS[1]); // 4 days missed: still day 2
    for (let i = 2; i < LOGIN_REWARDS.length; i++) claimLogin(d, 15 + i, w);
    expect(d.loginCount).toBe(LOGIN_REWARDS.length);
    expect(claimLogin(d, 100, w)).toEqual(LOGIN_REWARDS[0]);
  });
});

describe('Ember Hearth', () => {
  it('grows with time and level, caps, and a clock set backwards gives nothing', () => {
    const h1 = hearthYield(0, 2 * HOUR, 1);
    const h2 = hearthYield(0, 4 * HOUR, 1);
    expect(h2.gold).toBeGreaterThan(h1.gold);
    expect(hearthYield(0, 4 * HOUR, 20).gold).toBeGreaterThan(h2.gold);
    const cap = hearthYield(0, HEARTH_CONFIG.capHours * HOUR, 5);
    expect(hearthYield(0, 100 * HOUR, 5)).toEqual(cap);
    expect(cap.full).toBe(true);
    expect(hearthYield(10 * HOUR, 0, 5)).toMatchObject({ gold: 0, xp: 0, materials: 0 });
  });

  it('collecting pays gold and XP once, then starts over', () => {
    const p = makeProfile();
    const t0 = p.data.hearth.sinceMs;
    const got = p.collectHearth(t0 + 3 * HOUR);
    expect(got).not.toBeNull();
    expect(p.wallet.get('gold')).toBe(got?.gold);
    expect(p.collectHearth(t0 + 3 * HOUR)).toBeNull();
  });
});

describe('Ember Blessing', () => {
  it('stacks on defeats up to the cap, clears on victory, ignores abandons', () => {
    const p = makeProfile();
    const lose = {
      victory: false,
      abandoned: false,
      kills: 3,
      perfectDodges: 1,
      bossKilled: false,
      stars: 0,
    };
    const stage = { stageId: 'c1s8', difficulty: 'normal' as const };
    for (let i = 0; i < 5; i++) p.trackBattle('adventure', lose, stage);
    expect(p.blessing('c1s8', 'normal').stacks).toBe(BLESSING_CONFIG.maxStacks);
    expect(p.blessing('c1s8', 'hard').stacks).toBe(0);
    p.trackBattle('adventure', { ...lose, abandoned: true }, { ...stage, stageId: 'c1s7' });
    expect(p.blessing('c1s7', 'normal').stacks).toBe(0);
    p.trackBattle('adventure', { ...lose, victory: true, bossKilled: true, stars: 3 }, stage);
    expect(p.blessing('c1s8', 'normal').stacks).toBe(0);
    expect(blessingFor(99).atkMult).toBeCloseTo(
      1 + BLESSING_CONFIG.maxStacks * BLESSING_CONFIG.atkPerStack,
    );
    expect(p.data.lifetime.perfectDodges).toBe(7);
  });
});

describe('achievements', () => {
  it('tiers become claimable in order and pay their gems once', () => {
    const a = ACHIEVEMENTS.find((x) => x.id === 'a_slayer');
    if (a === undefined) throw new Error('missing');
    expect(claimableTiers(a, 0, 99)).toBe(0);
    expect(claimableTiers(a, 0, 600)).toBe(2);
    expect(claimableTiers(a, 2, 600)).toBe(0);
    const p = makeProfile();
    p.data.lifetime.kills = 600;
    const gems = p.wallet.get('gems');
    expect(p.claimAchievement('a_slayer')).toBe(a.gems[0]);
    expect(p.claimAchievement('a_slayer')).toBe(a.gems[1]);
    expect(p.claimAchievement('a_slayer')).toBe(0);
    expect(p.wallet.get('gems')).toBe(gems + (a.gems[0] ?? 0) + (a.gems[1] ?? 0));
  });

  it('every achievement has rising tiers with a reward each', () => {
    for (const a of ACHIEVEMENTS) {
      expect(a.gems).toHaveLength(a.tiers.length);
      for (let i = 1; i < a.tiers.length; i++)
        expect(a.tiers[i] ?? 0).toBeGreaterThan(a.tiers[i - 1] ?? 0);
    }
  });

  it('save data survives sanitising; junk is dropped', () => {
    const p = sanitizeProfile(
      {
        achievements: { a_slayer: 2, nope: 3, a_heroes: 99 },
        blessings: { 'c1s8:normal': 2, 'c1s8:normal ': 1, 'x:normal': 2, 'c2s1:hard': 50 },
        daily: { day: 5, quests: [{ id: 'q_kill', progress: 999 }, { id: 'zzz' }], loginCount: 3 },
        hearth: { sinceMs: 9e15 },
      },
      1000,
    );
    expect(p.achievements).toEqual({ a_slayer: 2, a_heroes: 2 });
    expect(p.blessings).toEqual({ 'c1s8:normal': 2, 'c2s1:hard': BLESSING_CONFIG.maxStacks });
    expect(p.daily.quests).toEqual([{ id: 'q_kill', progress: 40, claimed: false }]);
    expect(p.daily.loginCount).toBe(3);
    expect(p.hearth.sinceMs).toBe(1000);
  });
});

describe('bench XP', () => {
  it('other unlocked heroes earn a share; locked heroes earn nothing', () => {
    const p = makeProfile();
    p.hero('brann').unlocked = true;
    p.grantXp('kael', 1000);
    expect(p.hero('brann').level).toBeGreaterThan(1);
    expect(p.hero('lyra').level).toBe(1);
    const k = { level: 1, xp: 0 };
    addXp(k, 1000);
    expect(p.hero('kael').level).toBe(k.level);
    const b = { level: 1, xp: 0 };
    addXp(b, Math.floor(1000 * XP_CONFIG.benchShare));
    expect(p.hero('brann').level).toBe(b.level);
  });
});

/**
 * Balance guard: a player who clears each Adventure stage once (no grinding) with rare +3
 * gear of the stage level must find every boss beatable, and the final boss must not be a
 * wall. "Hits" are average hits at skill multiplier 1 (real fights use combos and skills).
 * Chapter 4 is the grind chapter: it expects epic gear (Hunts, boss drops) instead of rare.
 */
describe('boss balance along the Adventure', () => {
  const rows: {
    stage: string;
    boss: string;
    miniboss: boolean;
    level: number;
    heroLevel: number;
    hitsToKill: number;
    hitsToDie: number;
    power: number;
    recommended: number;
  }[] = [];
  const st = { level: 1, xp: 0 };
  const rng = mulberry32(3);
  for (const ch of CHAPTERS) {
    for (const s of ch.stages) {
      if (s.boss !== null) {
        const b = BOSSES[s.boss];
        const gear = GEAR_SLOTS.map((slot, i) => {
          const rarity = ch.number >= 4 ? 'epic' : 'rare';
          const it = rollItem(rng, i + 1, slot, rarity, Math.max(1, s.level - 1));
          it.plus = 3;
          return it;
        });
        const hs = computeHeroStats(HEROES.kael, st.level, gear, null);
        const sc = enemyScaleFor(s.level, 'normal');
        const hit =
          hs.atk * defenseFactor(b.stats.def * sc.def) * (1 + hs.critChance * (hs.critDamage - 1));
        const bossHit = b.stats.atk * sc.atk * 1.5 * defenseFactor(hs.def);
        rows.push({
          stage: s.id,
          boss: s.boss,
          miniboss: s.kind === 'miniboss',
          level: s.level,
          heroLevel: st.level,
          hitsToKill: (b.stats.maxHp * sc.hp) / hit,
          hitsToDie: hs.maxHp / bossHit,
          power: powerRating(hs),
          recommended: recommendedPower(s.level, 'normal'),
        });
      }
      addXp(st, s.rewards.xp);
    }
  }

  it('hero level keeps pace with stage level on first clears alone', () => {
    for (const r of rows) expect(r.heroLevel).toBeGreaterThanOrEqual(r.level - 5);
  });

  it('every boss takes a fair number of hits and never one-shots the hero', () => {
    for (const r of rows) {
      const [lo, hi] = r.miniboss ? [30, 90] : [70, 160];
      expect(r.hitsToKill, r.stage).toBeGreaterThan(lo);
      expect(r.hitsToKill, r.stage).toBeLessThan(hi);
      expect(r.hitsToDie, r.stage).toBeGreaterThan(10);
    }
  });

  it('the final boss is at most 1.6× the first chapter boss', () => {
    const first = rows.find((r) => r.boss === 'hollow_warden');
    const last = rows.find((r) => r.boss === 'bound_king');
    if (first === undefined || last === undefined) throw new Error('bosses missing');
    expect(last.hitsToKill / first.hitsToKill).toBeLessThan(1.6);
  });

  it('a hero geared like this meets the recommended power', () => {
    for (const r of rows) expect(r.power, r.stage).toBeGreaterThanOrEqual(r.recommended * 0.95);
  });
});
