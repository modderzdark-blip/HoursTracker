import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/core/random';
import { HEROES } from '../../src/data/heroes';
import { XP_CONFIG } from '../../src/data/progression';
import { CHAPTERS, findAdventureStage } from '../../src/data/stages';
import {
  BOSS_LINES,
  CHAPTER_STORY,
  HERO_LINES,
  LORE_TIPS,
  loreTip,
  PROLOGUE,
} from '../../src/data/story';
import { BOSSES, type BossId } from '../../src/data/bosses';
import type { BattleOutcome } from '../../src/modes/BattleMode';
import { grantAdventureVictory } from '../../src/modes/rewards';
import {
  celebrationsFor,
  chapterProgress,
  COMBO_RANKS,
  comboRankIndex,
  comboRankWord,
  goalsReached,
  KillChain,
  MULTI_KILL_WINDOW_MS,
  multiKillWord,
  nextAdventureStage,
  planReveal,
  REVEAL_TIMING,
  streakWord,
  xpSegments,
  type UnlockEvent,
} from '../../src/progression/feel';
import { PlayerProfile } from '../../src/progression/PlayerProfile';
import { createDefaultProfile, sanitizeProfile } from '../../src/progression/profile';
import { xpToNext } from '../../src/progression/xp';
import { createDefaultSave, normalizeSave } from '../../src/save/SaveStore';

function makeProfile(): PlayerProfile {
  return new PlayerProfile(createDefaultSave(), () => undefined, mulberry32(5));
}

function win(stars = 3): BattleOutcome {
  return {
    victory: true,
    abandoned: false,
    timeSec: 90,
    stars,
    damageTaken: 0,
    perfectDodges: 0,
    revives: 0,
    kills: 10,
    bossKilled: false,
    souls: 0,
    hpFrac: 1,
  };
}

describe('combo ranks', () => {
  it('starts at 5 hits and climbs through every rank at its threshold', () => {
    expect(comboRankIndex(0)).toBe(-1);
    expect(comboRankIndex(4)).toBe(-1);
    expect(comboRankWord(4)).toBe('');
    COMBO_RANKS.forEach((r, i) => {
      expect(comboRankIndex(r.min)).toBe(i);
      expect(comboRankIndex(r.min - 1)).toBe(i - 1);
      expect(comboRankWord(r.min)).toBe(r.word);
    });
    expect(comboRankIndex(10_000)).toBe(COMBO_RANKS.length - 1);
  });

  it('thresholds strictly increase and words are unique', () => {
    for (let i = 1; i < COMBO_RANKS.length; i++)
      expect(COMBO_RANKS[i]?.min ?? 0).toBeGreaterThan(COMBO_RANKS[i - 1]?.min ?? 0);
    expect(new Set(COMBO_RANKS.map((r) => r.word)).size).toBe(COMBO_RANKS.length);
  });
});

describe('multi-kills and streaks', () => {
  it('chains kills inside the window, restarts after it', () => {
    const k = new KillChain();
    expect(k.kill(0).multi).toBe(1);
    expect(k.kill(400).multi).toBe(2);
    expect(k.kill(400 + MULTI_KILL_WINDOW_MS).multi).toBe(3);
    expect(k.kill(400 + MULTI_KILL_WINDOW_MS * 2 + 1).multi).toBe(1);
  });

  it('the streak counts kills until the hero is hurt', () => {
    const k = new KillChain();
    for (let i = 0; i < 7; i++) k.kill(i * 5000);
    expect(k.kill(99_000).streak).toBe(8);
    k.hurt();
    expect(k.kill(100_000).streak).toBe(1);
    k.reset();
    expect(k.kill(0)).toEqual({ multi: 1, streak: 1 });
  });

  it('callouts only on multi-kills and exact streak milestones', () => {
    expect(multiKillWord(1)).toBe('');
    expect(multiKillWord(2)).toBe('Double Reap');
    expect(multiKillWord(3)).toBe('Triple Reap');
    expect(multiKillWord(4)).toBe('Quad Reap');
    expect(multiKillWord(7)).toBe('Carnage ×7');
    expect(streakWord(7)).toBe('');
    expect(streakWord(8)).toBe('Bloodtide');
    expect(streakWord(9)).toBe('');
    expect(streakWord(16)).toBe('Ashstorm');
    expect(streakWord(30)).toBe('Deathless');
  });
});

describe('XP bar segments', () => {
  it('a gain inside one level is one segment', () => {
    const need = xpToNext(3);
    const s = xpSegments(3, need / 4, 3, need / 2);
    expect(s).toEqual([{ level: 3, from: 0.25, to: 0.5, levelUp: false }]);
  });

  it('each level gained fills the bar once, then the remainder', () => {
    const s = xpSegments(1, xpToNext(1) / 2, 3, xpToNext(3) / 10);
    expect(s.map((x) => x.level)).toEqual([1, 2, 3]);
    expect(s[0]).toEqual({ level: 1, from: 0.5, to: 1, levelUp: true });
    expect(s[1]).toEqual({ level: 2, from: 0, to: 1, levelUp: true });
    expect(s[2]?.levelUp).toBe(false);
    expect(s[2]?.to).toBeCloseTo(0.1);
  });

  it('the max level shows a full bar', () => {
    const max = XP_CONFIG.maxLevel;
    expect(xpSegments(max, 0, max, 0)).toEqual([{ level: max, from: 1, to: 1, levelUp: false }]);
  });
});

describe('victory reveal plan', () => {
  it('stars, counters, XP (with level-ups), loot, first clear, done — in time order', () => {
    const plan = planReveal({
      stars: 2,
      previousStars: 1,
      showStars: true,
      xpSegments: xpSegments(1, 0, 2, 10),
      loot: ['common', 'legendary', 'rare'],
      firstClear: true,
    });
    const kinds = plan.map((s) => s.kind);
    expect(kinds).toEqual([
      'star',
      'star',
      'star',
      'counters',
      'xp',
      'levelUp',
      'xp',
      'loot',
      'loot',
      'loot',
      'firstClear',
      'done',
    ]);
    for (let i = 1; i < plan.length; i++)
      expect(plan[i]?.atMs ?? 0).toBeGreaterThanOrEqual(plan[i - 1]?.atMs ?? 0);
    expect(plan.filter((s) => s.kind === 'star').map((s) => s.highlight)).toEqual([
      true,
      true,
      false,
    ]);
    const loot = plan.filter((s) => s.kind === 'loot');
    expect(loot.map((s) => s.highlight)).toEqual([false, true, false]);
    // The legendary card waits a little longer than the regular gap.
    const [a, b] = loot;
    expect((b?.atMs ?? 0) - (a?.atMs ?? 0)).toBe(
      REVEAL_TIMING.lootGapMs + REVEAL_TIMING.rareLootPauseMs,
    );
  });

  it('no stars when the victory has none; the whole reveal stays short', () => {
    const plan = planReveal({
      stars: 0,
      previousStars: 0,
      showStars: false,
      xpSegments: [],
      loot: [],
      firstClear: false,
    });
    expect(plan.map((s) => s.kind)).toEqual(['counters', 'done']);
    const big = planReveal({
      stars: 3,
      previousStars: 0,
      showStars: true,
      xpSegments: xpSegments(1, 0, 4, 0),
      loot: ['mythic', 'legendary', 'epic', 'epic'],
      firstClear: true,
    });
    expect(big.at(-1)?.atMs ?? 0).toBeLessThan(8000);
  });
});

describe('celebrations and goals', () => {
  it('chapter first, then heroes, then modes; difficulties stay in the list', () => {
    const unlocks: UnlockEvent[] = [
      { kind: 'mode', id: 'dungeon', label: 'Dungeon unlocked' },
      { kind: 'difficulty', chapter: 1, id: 'hard', label: 'Hard' },
      { kind: 'hero', id: 'lyra', label: 'Lyra' },
    ];
    expect(celebrationsFor(unlocks, 1)).toEqual([
      { kind: 'chapter', chapter: 1 },
      { kind: 'hero', id: 'lyra' },
      { kind: 'mode', id: 'dungeon' },
    ]);
    expect(celebrationsFor([], null)).toEqual([]);
  });

  it('reports quests newly finished and achievement tiers newly reached', () => {
    const before = { quests: ['q_kill'], achievements: { a_slayer: 1 } };
    const after = { quests: ['q_kill', 'q_win'], achievements: { a_slayer: 2, a_bosses: 1 } };
    expect(goalsReached(before, after)).toEqual([
      { kind: 'quest', id: 'q_win', tier: 0 },
      { kind: 'achievement', id: 'a_slayer', tier: 2 },
      { kind: 'achievement', id: 'a_bosses', tier: 1 },
    ]);
    expect(goalsReached(after, after)).toEqual([]);
  });

  it('the next stage and chapter progress follow the clears', () => {
    const cleared = new Set<string>();
    expect(nextAdventureStage((id) => cleared.has(id))?.id).toBe('c1s1');
    cleared.add('c1s1');
    cleared.add('c1s2');
    expect(nextAdventureStage((id) => cleared.has(id))?.id).toBe('c1s3');
    expect(chapterProgress(1, (id) => cleared.has(id))).toEqual({ cleared: 2, total: 8 });
    for (const c of CHAPTERS) for (const s of c.stages) cleared.add(s.id);
    expect(nextAdventureStage((id) => cleared.has(id))).toBeNull();
    expect(chapterProgress(99, () => true)).toEqual({ cleared: 0, total: 0 });
  });
});

describe('story save fields', () => {
  it('old saves without story data load with defaults', () => {
    const old = createDefaultProfile(1000) as unknown as Record<string, unknown>;
    delete old['story'];
    const p = sanitizeProfile(JSON.parse(JSON.stringify(old)), 1000);
    expect(p.story).toEqual({
      prologueSeen: false,
      chapterIntros: [],
      chapterOutros: [],
      modesSeen: ['adventure'],
    });
    const save = createDefaultSave();
    const raw = JSON.parse(JSON.stringify(save)) as Record<string, unknown>;
    delete (raw['profile'] as Record<string, unknown>)['story'];
    expect(normalizeSave(raw).profile.story.prologueSeen).toBe(false);
  });

  it('keeps valid values, drops junk, round-trips', () => {
    const p = sanitizeProfile({
      story: {
        prologueSeen: true,
        chapterIntros: [2, 1, 1, -3, 'x', 400],
        chapterOutros: 'nope',
        modesSeen: ['dungeon', 42, 'BAD MODE', 'arena'],
      },
    });
    expect(p.story.prologueSeen).toBe(true);
    expect(p.story.chapterIntros).toEqual([1, 2, 99]);
    expect(p.story.chapterOutros).toEqual([]);
    expect(p.story.modesSeen).toEqual(['adventure', 'dungeon', 'arena']);
    expect(sanitizeProfile(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
});

describe('victory rewards report unlocks, chapter completion and XP', () => {
  it('beating The Gaoler unlocks modes and a hero, with XP and stats before/after', () => {
    const p = makeProfile();
    for (const id of ['c1s1', 'c1s2', 'c1s3']) p.submitStageResult(id, 'normal', 3, 60);
    const stage = findAdventureStage('c1s4');
    if (stage === undefined) throw new Error('stage');
    const r = grantAdventureVictory(p, 'kael', stage, 'normal', win(), mulberry32(3));
    const kinds = r.unlockEvents.map((u) => `${u.kind}:${u.id}`);
    expect(kinds).toContain('mode:challenge');
    expect(kinds).toContain('mode:hunts');
    expect(r.unlocks).toEqual(r.unlockEvents.map((u) => u.label));
    expect(r.levelBefore).toBe(1);
    expect(r.xpBefore).toBe(0);
    expect(r.heroLevel).toBe(p.hero('kael').level);
    expect(r.xpAfter).toBe(p.hero('kael').xp);
    if (r.levelsGained > 0) expect(r.statsAfter.power).toBeGreaterThan(r.statsBefore.power);
    expect(r.chapterComplete).toBeNull();
  });

  it('the last stage of a chapter completes it — once', () => {
    const p = makeProfile();
    const ch = CHAPTERS[0];
    if (ch === undefined) throw new Error('chapter');
    for (const s of ch.stages.slice(0, -1)) p.submitStageResult(s.id, 'normal', 3, 60);
    const last = ch.stages[ch.stages.length - 1];
    if (last === undefined) throw new Error('stage');
    const first = grantAdventureVictory(p, 'kael', last, 'normal', win(), mulberry32(1));
    expect(first.chapterComplete).toBe(1);
    expect(first.unlockEvents.some((u) => u.kind === 'mode' && u.id === 'dungeon')).toBe(true);
    expect(p.data.story.chapterOutros).toEqual([1]);
    const again = grantAdventureVictory(p, 'kael', last, 'normal', win(), mulberry32(2));
    expect(again.chapterComplete).toBeNull();
    expect(again.unlockEvents).toEqual([]);
  });
});

describe('attention dots', () => {
  it('new modes stay new until opened; summonable heroes and skills are counted', () => {
    const p = makeProfile();
    expect(p.attention().newModes).toEqual([]);
    p.submitStageResult('c1s4', 'normal', 3, 60);
    expect(p.attention().newModes).toEqual(expect.arrayContaining(['challenge', 'hunts']));
    p.markModeSeen('challenge');
    expect(p.attention().newModes).not.toContain('challenge');
    const brann = HEROES.brann.unlock;
    if (brann === null) throw new Error('brann unlock');
    expect(p.attention().heroes).toBe(0);
    p.wallet.add('souls', brann.souls);
    expect(p.attention().heroes).toBe(1);
    p.wallet.add('gold', 1_000_000);
    expect(p.attention().skills).toBeGreaterThan(0);
  });

  it('a better unworn item flags a gear upgrade; the next stage follows progress', () => {
    const p = makeProfile();
    expect(p.attention().gearUpgrade).toBe(false);
    expect(p.nextStage()?.id).toBe('c1s1');
    p.submitStageResult('c1s1', 'normal', 1, 60);
    expect(p.nextStage()?.id).toBe('c1s2');
  });
});

describe('story content', () => {
  it('covers every chapter, boss and hero with non-empty original lines', () => {
    expect(PROLOGUE.length).toBeGreaterThanOrEqual(3);
    expect(PROLOGUE.length).toBeLessThanOrEqual(4);
    for (const c of CHAPTERS) {
      const s = CHAPTER_STORY[c.number];
      expect(s?.intro.length ?? 0).toBeGreaterThan(20);
      expect(s?.outro.length ?? 0).toBeGreaterThan(20);
    }
    for (const id of Object.keys(BOSSES) as BossId[]) {
      const l = BOSS_LINES[id];
      expect(l.taunt.length).toBeGreaterThan(5);
      expect(l.fall.length).toBeGreaterThan(5);
      expect(l.triumph.length).toBeGreaterThan(5);
    }
    for (const id of Object.keys(HEROES) as (keyof typeof HERO_LINES)[]) {
      expect(HERO_LINES[id].victory.length).toBeGreaterThan(5);
    }
    expect(loreTip(-1)).toBe(LORE_TIPS[LORE_TIPS.length - 1]);
    expect(loreTip(LORE_TIPS.length)).toBe(LORE_TIPS[0]);
  });
});
