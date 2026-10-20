import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/core/random';
import {
  ARENA_CONFIG,
  CHALLENGE_CONFIG,
  DUNGEON_CONFIG,
  HUNT_CONFIG,
  HUNT_OMENS,
  TOWER_CONFIG,
} from '../../src/data/modes';
import {
  challengeMult,
  challengeStage,
  consumeDungeonEntry,
  dailyHunts,
  generateOpponents,
  huntMult,
  huntRank,
  huntRewards,
  huntStage,
  isTowerBossFloor,
  leaderboard,
  nextRefillInMs,
  planDungeon,
  ratingChange,
  refillDungeon,
  settleSeasons,
  towerMilestone,
  towerStage,
} from '../../src/modes/meta';
import { PlayerProfile } from '../../src/progression/PlayerProfile';
import { createDefaultProfile, sanitizeProfile } from '../../src/progression/profile';
import { createDefaultSave } from '../../src/save/SaveStore';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('dungeon entries', () => {
  it('spending an entry starts the refill clock; entries come back one per period', () => {
    const p = createDefaultProfile(0);
    const d = p.dungeon;
    expect(d.entries).toBe(DUNGEON_CONFIG.maxEntries);
    expect(consumeDungeonEntry(d, 1000)).toBe(true);
    expect(d.entries).toBe(DUNGEON_CONFIG.maxEntries - 1);
    const period = DUNGEON_CONFIG.refillHours * HOUR;
    expect(nextRefillInMs(d, 1000)).toBe(period);
    refillDungeon(d, 1000 + period - 1);
    expect(d.entries).toBe(DUNGEON_CONFIG.maxEntries - 1);
    refillDungeon(d, 1000 + period);
    expect(d.entries).toBe(DUNGEON_CONFIG.maxEntries);
  });

  it('never refills above the cap and cannot go below zero', () => {
    const p = createDefaultProfile(0);
    const d = p.dungeon;
    for (let i = 0; i < DUNGEON_CONFIG.maxEntries; i++)
      expect(consumeDungeonEntry(d, 0)).toBe(true);
    expect(consumeDungeonEntry(d, 0)).toBe(false);
    expect(d.entries).toBe(0);
    refillDungeon(d, 100 * DAY);
    expect(d.entries).toBe(DUNGEON_CONFIG.maxEntries);
  });

  it('plans distinct rooms in random order with an elite at the end', () => {
    const a = planDungeon(mulberry32(1), 10, ['gaoler']);
    const b = planDungeon(mulberry32(2), 10, ['gaoler']);
    expect(a).toHaveLength(DUNGEON_CONFIG.roomsPerRun);
    expect(new Set(a.map((r) => r.name)).size).toBe(a.length);
    expect(a.map((r) => r.name).join()).not.toBe(b.map((r) => r.name).join());
    expect(a.at(-1)?.boss).toBe('gaoler');
    expect(a.slice(0, -1).every((r) => r.boss === null)).toBe(true);
    expect(a[0]?.level).toBe(10);
    expect(planDungeon(mulberry32(1), 5, []).at(-1)?.boss).toBeNull();
  });
});

describe('demon tower', () => {
  it('floors are deterministic, harder as they climb, with a boss every 10th', () => {
    expect(towerStage(7)).toEqual(towerStage(7));
    expect(towerStage(20).level).toBeGreaterThan(towerStage(5).level);
    for (let f = 1; f <= 40; f++) {
      const s = towerStage(f);
      expect(isTowerBossFloor(f)).toBe(f % TOWER_CONFIG.bossEvery === 0);
      expect(s.boss !== null).toBe(isTowerBossFloor(f));
      expect(s.waves.length).toBeGreaterThan(0);
    }
  });

  it('only allows enemy types from their unlock floor', () => {
    const early = towerStage(2);
    for (const w of early.waves)
      for (const sp of w.spawns) expect(['thrall', 'imp']).toContain(sp.enemy);
  });

  it('milestones every 5 floors with growing rewards', () => {
    expect(towerMilestone(4)).toBeNull();
    const m5 = towerMilestone(5);
    const m10 = towerMilestone(10);
    expect(m5).not.toBeNull();
    expect(m10?.gems).toBeGreaterThan(m5?.gems ?? 0);
  });
});

describe('boss challenge', () => {
  it('tiers raise level and multipliers; stages contain only the boss', () => {
    const entry = CHALLENGE_CONFIG.bosses[1];
    if (entry === undefined) throw new Error('no entry');
    const t1 = challengeStage(entry, 1);
    const t5 = challengeStage(entry, 5);
    expect(t5.level).toBeGreaterThan(t1.level);
    expect(t1.waves).toEqual([]);
    expect(t1.boss).toBe(entry.boss);
    expect(challengeMult(5).hp).toBeGreaterThan(challengeMult(1).hp);
  });
});

describe('arena', () => {
  it('rating changes: wins gain, losses lose, upsets move more, all within bounds', () => {
    const even = ratingChange(1000, 1000, true);
    const upset = ratingChange(1000, 1300, true);
    const expected = ratingChange(1300, 1000, true);
    expect(even).toBeGreaterThan(0);
    expect(upset).toBeGreaterThan(even);
    expect(expected).toBeLessThan(even);
    expect(ratingChange(1000, 1000, false)).toBeLessThan(0);
    for (const [a, b] of [
      [400, 2000],
      [2000, 400],
    ] as const) {
      for (const won of [true, false]) {
        const c = Math.abs(ratingChange(a, b, won));
        expect(c).toBeGreaterThanOrEqual(ARENA_CONFIG.minChange);
        expect(c).toBeLessThanOrEqual(ARENA_CONFIG.maxChange);
      }
    }
  });

  it('generates distinct opponents around the player rating and power', () => {
    const opps = generateOpponents(42, 1100, 2000);
    expect(opps).toHaveLength(ARENA_CONFIG.opponents);
    expect(new Set(opps.map((o) => o.name)).size).toBe(opps.length);
    for (const o of opps) {
      expect(Math.abs(o.rating - 1100)).toBeLessThanOrEqual(ARENA_CONFIG.ratingRange + 30);
      expect(o.power).toBeGreaterThan(2000 * 0.6);
      expect(o.power).toBeLessThan(2000 * 1.6);
      expect(o.stats.maxHp).toBeGreaterThan(0);
    }
    expect(generateOpponents(42, 1100, 2000)).toEqual(opps);
  });

  it('season end pays rewards by rank and soft-resets the rating', () => {
    const p = createDefaultProfile(0);
    const a = p.arena;
    a.rating = 1500;
    expect(settleSeasons(a, ARENA_CONFIG.seasonDays * DAY - 1)).toEqual([]);
    const res = settleSeasons(a, ARENA_CONFIG.seasonDays * DAY + 5);
    expect(res).toHaveLength(1);
    expect(res[0]?.label).toBe('Inferno');
    expect(a.season).toBe(2);
    expect(a.rating).toBe(1250);
  });

  it('leaderboard is sorted, stable per season and includes the player', () => {
    const lb = leaderboard(3, 1234);
    expect(lb).toHaveLength(ARENA_CONFIG.leaderboardSize);
    expect(lb.filter((e) => e.you)).toHaveLength(1);
    for (let i = 1; i < lb.length; i++)
      expect(lb[i - 1]!.rating).toBeGreaterThanOrEqual(lb[i]!.rating);
    expect(leaderboard(3, 1234)).toEqual(lb);
  });
});

describe('hunts', () => {
  const all = CHALLENGE_CONFIG.bosses;

  it('a day offers 3 different bosses, the same all day, with more omens later on the board', () => {
    const a = dailyHunts(500, all, 1, 1);
    expect(a).toHaveLength(HUNT_CONFIG.perDay);
    expect(new Set(a.map((h) => h.entry.boss)).size).toBe(HUNT_CONFIG.perDay);
    expect(dailyHunts(500, all, 1, 1)).toEqual(a);
    expect(a[0]?.omens).toHaveLength(HUNT_CONFIG.minOmens);
    expect(a[a.length - 1]?.omens).toHaveLength(HUNT_CONFIG.maxOmens);
    for (const h of a) expect(new Set(h.omens).size).toBe(h.omens.length);
    const days = new Set<string>();
    for (let d = 500; d < 520; d++)
      days.add(
        dailyHunts(d, all, 1, 1)
          .map((h) => h.entry.boss)
          .join(),
      );
    expect(days.size).toBeGreaterThan(5);
  });

  it('only defeated bosses are hunted; one unlocked boss still fills the board', () => {
    expect(dailyHunts(3, [], 1, 1)).toEqual([]);
    const first = all[0];
    if (first === undefined) throw new Error('no bosses');
    const b = dailyHunts(3, [first], 1, 1);
    expect(b).toHaveLength(HUNT_CONFIG.perDay);
    for (const h of b) expect(h.entry.boss).toBe(first.boss);
  });

  it('rank raises the level; early bosses keep up with the hero’s progress', () => {
    const [low] = dailyHunts(9, all, 1, 1);
    const [high] = dailyHunts(9, all, 6, 1);
    const [late] = dailyHunts(9, all, 1, 30);
    if (low === undefined || high === undefined || late === undefined) throw new Error('empty');
    expect(high.level - low.level).toBe(5 * HUNT_CONFIG.levelPerRank);
    expect(late.level).toBeGreaterThanOrEqual(28);
    expect(huntRank(0)).toBe(1);
    expect(huntRank(HUNT_CONFIG.huntsPerRank)).toBe(2);
    expect(huntRank(1e6)).toBe(HUNT_CONFIG.maxRank);
  });

  it('omens shape the fight and the pay; replays pay less and no gems', () => {
    const [h] = dailyHunts(77, all, 1, 1);
    if (h === undefined) throw new Error('empty');
    const ironBrutal = { ...h, omens: ['ironhide', 'brutal'] as const };
    const m = huntMult(ironBrutal);
    expect(m.hp).toBeCloseTo(HUNT_OMENS.ironhide.hp);
    expect(m.atk).toBeCloseTo(HUNT_OMENS.brutal.atk);
    expect(m.reward).toBeCloseTo(HUNT_OMENS.ironhide.reward * HUNT_OMENS.brutal.reward);
    expect(huntStage(ironBrutal).waves).toHaveLength(0);
    expect(huntStage({ ...h, omens: ['swarming'] }).waves.length).toBe(1);
    expect(huntStage(h).boss).toBe(h.entry.boss);
    const first = huntRewards(ironBrutal, false);
    const again = huntRewards(ironBrutal, true);
    expect(first.gems).toBe(HUNT_CONFIG.gemsPerSlot * h.slot);
    expect(again.gems).toBe(0);
    expect(again.gold).toBeLessThan(first.gold * 0.5);
  });

  it('the profile board resets the won list at midnight and survives sanitising', () => {
    const p = new PlayerProfile(createDefaultSave(), () => undefined, mulberry32(4));
    expect(p.huntBoard(Date.UTC(2026, 0, 10, 12))).toEqual([]);
    p.submitStageResult('c1s4', 'normal', 1, 100);
    const board = p.huntBoard(Date.UTC(2026, 0, 10, 12));
    expect(board.length).toBe(HUNT_CONFIG.perDay);
    p.data.hunts.won.push(board[0]?.id ?? '');
    p.huntBoard(Date.UTC(2026, 0, 10, 13));
    expect(p.data.hunts.won).toHaveLength(1);
    p.huntBoard(Date.UTC(2026, 0, 12, 12));
    expect(p.data.hunts.won).toHaveLength(0);
    const s = sanitizeProfile(
      { hunts: { day: 40, won: ['40:1', '39:2', 7, '40:1'], completed: 12 } },
      0,
    );
    expect(s.hunts).toEqual({ day: 40, won: ['40:1'], completed: 12 });
  });
});
