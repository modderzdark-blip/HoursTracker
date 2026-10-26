import { describe, expect, it } from 'vitest';
import { defenseFactor } from '../../src/combat/damage';
import { mulberry32 } from '../../src/core/random';
import {
  adventureFrontier,
  chapterDef,
  findAdventureStage,
  MAX_CHAPTER,
  parseStageId,
} from '../../src/data/adventure';
import { AFFIXES, AFFIX_IDS, combineAffixes } from '../../src/data/affixes';
import { ARENAS } from '../../src/data/arenas';
import { BOSSES, type BossId } from '../../src/data/bosses';
import { ENDLESS_CONFIG, endlessLevel, generateChapter } from '../../src/data/endless';
import { ENEMIES } from '../../src/data/enemies';
import { HEROES } from '../../src/data/heroes';
import { GEAR_SLOTS, type Rarity } from '../../src/data/items';
import { CHALLENGE_CONFIG, TOWER_CONFIG } from '../../src/data/modes';
import { CHAPTERS } from '../../src/data/stages';
import { BOSS_LINES, chapterStory, romanNumeral } from '../../src/data/story';
import { dailyHunts, highestClearedLevel } from '../../src/modes/meta';
import { enemyScaleFor, stageEnemyMult } from '../../src/progression/enemyScale';
import { nextAdventureStage } from '../../src/progression/feel';
import { rollItem } from '../../src/progression/gear';
import { computeHeroStats } from '../../src/progression/heroStats';
import { PlayerProfile } from '../../src/progression/PlayerProfile';
import { createDefaultSave, normalizeSave } from '../../src/save/SaveStore';

const SAMPLE = [5, 6, 7, 8, 9, 10, 13, 20, 37, 50, 120, 500, MAX_CHAPTER];

describe('Endless Adventure: generated chapters', () => {
  it('the hand-made chapters are untouched and come first', () => {
    for (const c of CHAPTERS) expect(chapterDef(c.number)).toBe(c);
    expect(chapterDef(0)).toBeUndefined();
    expect(chapterDef(MAX_CHAPTER + 1)).toBeUndefined();
    expect(chapterDef(2.5)).toBeUndefined();
  });

  it('generation is deterministic (same chapter number → same chapter)', () => {
    for (const n of SAMPLE) expect(generateChapter(n)).toEqual(generateChapter(n));
    expect(
      generateChapter(7).name === generateChapter(8).name &&
        generateChapter(7).stages[0]?.name === generateChapter(8).stages[0]?.name,
    ).toBe(false);
    // Cached: the same object every time.
    expect(chapterDef(12)).toBe(chapterDef(12));
  });

  it('every chapter has 8 stages in the hand-made rhythm with stable ids', () => {
    for (const n of SAMPLE) {
      const c = chapterDef(n);
      if (c === undefined) throw new Error(`no chapter ${n}`);
      expect(c.number).toBe(n);
      expect(c.name.length).toBeGreaterThan(3);
      expect(c.subtitle.length).toBeGreaterThan(3);
      expect(c.stages).toHaveLength(8);
      c.stages.forEach((s, i) => {
        expect(s.id).toBe(`c${n}s${i + 1}`);
        expect(s.chapter).toBe(n);
        expect(s.index).toBe(i);
        expect(findAdventureStage(s.id)).toBe(s);
        expect(parseStageId(s.id)).toEqual({ chapter: n, index: i });
      });
      expect(c.stages[7]?.kind).toBe('boss');
      expect(c.stages[3]?.kind).toBe('miniboss');
      const elites = c.stages.filter((s) => s.kind === 'miniboss').length;
      expect(elites).toBe(n - 4 >= ENDLESS_CONFIG.secondEliteDepth ? 2 : 1);
      for (const s of c.stages) expect(s.boss !== null).toBe(s.kind !== 'normal');
    }
    expect(findAdventureStage('c5s9')).toBeUndefined();
    expect(findAdventureStage('c1000s1')).toBeUndefined();
    expect(findAdventureStage('x5s1')).toBeUndefined();
  });

  it('levels never go down, continue from chapter 4 and keep climbing', () => {
    let prev = CHAPTERS[3]?.stages[7]?.level ?? 0;
    expect(prev).toBe(32);
    expect(chapterDef(5)?.stages[0]?.level).toBe(33);
    for (let n = 5; n <= 200; n++) {
      const c = chapterDef(n);
      for (const s of c?.stages ?? []) {
        expect(s.level).toBeGreaterThanOrEqual(prev);
        prev = s.level;
      }
      // At least one level per chapter, however deep.
      expect(endlessLevel(n + 1, 0)).toBeGreaterThan(endlessLevel(n, 0));
    }
  });

  it('waves reference real enemies, bosses and arenas; variety and density grow', () => {
    const arenaIds = new Set(Object.keys(ARENAS));
    const typesAt = (n: number): number => {
      let sum = 0;
      let waves = 0;
      for (const s of chapterDef(n)?.stages ?? [])
        for (const w of s.waves) {
          sum += w.spawns.length;
          waves++;
        }
      return sum / waves;
    };
    const countAt = (n: number): number => {
      let sum = 0;
      for (const s of chapterDef(n)?.stages ?? [])
        for (const w of s.waves) for (const sp of w.spawns) sum += sp.count;
      return sum;
    };
    for (const n of SAMPLE) {
      for (const s of chapterDef(n)?.stages ?? []) {
        expect(arenaIds.has(s.arena)).toBe(true);
        expect(s.waves.length).toBeGreaterThan(0);
        for (const w of s.waves)
          for (const sp of w.spawns) {
            expect(ENEMIES[sp.enemy], sp.enemy).toBeDefined();
            expect(sp.count).toBeGreaterThan(0);
          }
        if (s.boss !== null) expect(BOSSES[s.boss]).toBeDefined();
        for (const a of [...(s.affixes ?? []), ...(s.bossAffixes ?? [])])
          expect(AFFIXES[a]).toBeDefined();
      }
    }
    expect(typesAt(20)).toBeGreaterThan(typesAt(5));
    expect(countAt(20)).toBeGreaterThan(countAt(5));
  });

  it('the newer bosses are introduced in chapters 5–8, then every boss can return', () => {
    expect(chapterDef(5)?.stages[3]?.boss).toBe('hollow_twin');
    expect(chapterDef(5)?.stages[7]?.boss).toBe('headsman');
    expect(chapterDef(6)?.stages[7]?.boss).toBe('bone_cantor');
    expect(chapterDef(7)?.stages[7]?.boss).toBe('twin_maw');
    expect(chapterDef(8)?.stages[7]?.boss).toBe('ossuary_queen');
    const pools = new Set<BossId>([...ENDLESS_CONFIG.elitePool, ...ENDLESS_CONFIG.lordPool]);
    for (const id of Object.keys(BOSSES) as BossId[]) expect(pools.has(id), id).toBe(true);
    const seen = new Set<BossId>();
    for (let n = 5; n <= 120; n++)
      for (const s of chapterDef(n)?.stages ?? []) if (s.boss !== null) seen.add(s.boss);
    expect(seen.size).toBe(Object.keys(BOSSES).length);
  });

  it('elite affixes stack with depth on foes and bosses', () => {
    const count = (n: number, boss: boolean): number => {
      const st = chapterDef(n)?.stages[7];
      return (boss ? st?.bossAffixes : st?.affixes)?.length ?? 0;
    };
    expect(count(5, false)).toBe(0);
    expect(count(5, true)).toBe(1);
    expect(count(10, true)).toBeGreaterThan(count(5, true));
    expect(count(20, false)).toBeGreaterThan(count(10, false));
    expect(count(50, true)).toBe(ENDLESS_CONFIG.affixes.bossMax);
    for (const n of SAMPLE)
      for (const s of chapterDef(n)?.stages ?? [])
        expect(new Set(s.bossAffixes ?? []).size).toBe((s.bossAffixes ?? []).length);
  });

  it('rewards grow with depth: gold, XP, item level and first-clear gems', () => {
    const boss = (n: number) => chapterDef(n)?.stages[7];
    let prev = { gold: 0, xp: 0, level: 0, gems: 0 };
    for (const n of [4, 5, 10, 20, 50]) {
      const s = boss(n);
      if (s === undefined) throw new Error('no boss stage');
      expect(s.rewards.gold).toBeGreaterThan(prev.gold);
      expect(s.rewards.xp).toBeGreaterThan(prev.xp);
      expect(s.level).toBeGreaterThan(prev.level);
      expect(s.rewards.gems ?? 0).toBeGreaterThanOrEqual(prev.gems);
      prev = { gold: s.rewards.gold, xp: s.rewards.xp, level: s.level, gems: s.rewards.gems ?? 0 };
    }
    expect(boss(4)?.rewards.gems).toBeUndefined();
    expect(boss(5)?.rewards.gems).toBeGreaterThan(0);
  });

  it('generated chapters get lore lines from templates and roman numerals', () => {
    expect(romanNumeral(4)).toBe('IV');
    expect(romanNumeral(49)).toBe('XLIX');
    expect(romanNumeral(999)).toBe('CMXCIX');
    for (const n of SAMPLE) {
      const c = chapterDef(n);
      if (c === undefined) throw new Error('missing');
      const st = chapterStory(c);
      expect(st.numeral).toBe(romanNumeral(n));
      expect(st.intro).not.toMatch(/\{|\}/);
      expect(st.outro).not.toMatch(/\{|\}/);
      expect(st.intro.charAt(0)).toBe(st.intro.charAt(0).toUpperCase());
    }
    for (const id of Object.keys(BOSSES) as BossId[])
      for (const line of [BOSS_LINES[id].taunt, BOSS_LINES[id].fall, BOSS_LINES[id].triumph])
        expect(line.length, id).toBeGreaterThan(10);
  });
});

describe('Endless Adventure: progress and saves', () => {
  const clearChapters = (p: PlayerProfile, upTo: number): void => {
    for (let n = 1; n <= upTo; n++)
      for (const s of chapterDef(n)?.stages ?? []) p.submitStageResult(s.id, 'normal', 3, 100);
  };

  it('the next chapter opens when the previous boss falls; the hub goal keeps going', () => {
    const p = new PlayerProfile(createDefaultSave(), () => undefined, mulberry32(1));
    clearChapters(p, 4);
    expect(p.adventureFrontier()).toBe(5);
    const c5 = chapterDef(5);
    if (c5 === undefined) throw new Error('no chapter 5');
    expect(p.stageUnlocked(c5.stages[0]!, 'normal')).toBe(true);
    expect(p.nextStage()?.id).toBe('c5s1');
    for (const s of c5.stages.slice(0, 7)) p.submitStageResult(s.id, 'normal', 2, 100);
    expect(p.adventureFrontier()).toBe(5);
    expect(p.stageUnlocked(chapterDef(6)!.stages[0]!, 'normal')).toBe(false);
    p.submitStageResult('c5s8', 'normal', 1, 300);
    expect(p.adventureFrontier()).toBe(6);
    expect(p.stageUnlocked(chapterDef(6)!.stages[0]!, 'normal')).toBe(true);
    expect(p.nextStage()?.id).toBe('c6s1');
    expect(p.progressLevel()).toBe(40);
    expect(p.allStars()).toBe(32 * 3 + 7 * 2 + 1);
    expect(highestClearedLevel((id) => p.stageClearedAnyDifficulty(id))).toBe(40);
    expect(nextAdventureStage(() => true)).toBeNull();
  });

  it('generated stage records round-trip through the save, and old saves still load', () => {
    const save = createDefaultSave();
    const p = new PlayerProfile(save, () => undefined, mulberry32(2));
    clearChapters(p, 6);
    p.data.story.chapterIntros.push(5, 6);
    const raw = JSON.parse(JSON.stringify(save)) as Record<string, unknown>;
    const back = normalizeSave(raw);
    expect(back.records['c6s8:normal']?.bestStars).toBe(3);
    expect(back.profile.story.chapterIntros).toEqual([5, 6]);
    const q = new PlayerProfile(back, () => undefined, mulberry32(2));
    expect(q.adventureFrontier()).toBe(7);
    expect(q.nextStage()?.id).toBe('c7s1');
    // A save from before Endless: only hand-made records, no new fields.
    const old = createDefaultSave();
    const oldRaw = JSON.parse(JSON.stringify(old)) as Record<string, unknown>;
    (oldRaw['records'] as Record<string, unknown>)['c1s1:normal'] = {
      bestStars: 2,
      bestTimeSec: 90,
      clears: 1,
    };
    const loaded = new PlayerProfile(normalizeSave(oldRaw), () => undefined, mulberry32(3));
    expect(loaded.adventureFrontier()).toBe(1);
    expect(loaded.nextStage()?.id).toBe('c1s2');
  });

  it('the new bosses join the Demon Tower, Boss Challenge and Hunts', () => {
    const fresh: BossId[] = ['headsman', 'bone_cantor', 'twin_maw', 'ossuary_queen', 'hollow_twin'];
    for (const id of fresh) {
      expect(TOWER_CONFIG.bosses).toContain(id);
      const entry = CHALLENGE_CONFIG.bosses.find((c) => c.boss === id);
      expect(entry, id).toBeDefined();
      const stage = findAdventureStage(entry?.stage ?? '');
      expect(stage?.boss, id).toBe(id);
    }
    const unlocked = CHALLENGE_CONFIG.bosses.filter((c) => fresh.includes(c.boss));
    const hunts = dailyHunts(1234, unlocked, 1, 50);
    for (const h of hunts) {
      expect(fresh).toContain(h.entry.boss);
      expect(h.level).toBeGreaterThanOrEqual(48);
    }
  });

  it('the frontier stops at the last chapter even if every stage reads cleared', () => {
    expect(adventureFrontier(() => true)).toBe(MAX_CHAPTER);
  });
});

/**
 * Difficulty curve guard for the Endless chapters (same yardstick as the hand-made boss balance
 * test in goals.test.ts): average hits at skill multiplier 1 for a hero who keeps gear at the
 * stage's level, getting better rarity and upgrades deeper down. Bosses carry their affixes and
 * the chapter's depth pressure.
 */
describe('Endless Adventure: difficulty curve', () => {
  const gearFor = (chapter: number): { rarity: Rarity; plus: number } =>
    chapter < 10
      ? { rarity: 'epic', plus: 3 }
      : chapter < 20
        ? { rarity: 'epic', plus: 6 }
        : chapter < 35
          ? { rarity: 'legendary', plus: 6 }
          : { rarity: 'legendary', plus: 9 };
  const rows = [5, 6, 7, 8, 10, 20, 50].map((n) => {
    const stage = chapterDef(n)?.stages[7];
    if (stage === undefined || stage.boss === null) throw new Error('no boss');
    const b = BOSSES[stage.boss];
    const g = gearFor(n);
    const rng = mulberry32(n);
    const gear = GEAR_SLOTS.map((slot, i) => {
      const it = rollItem(rng, i + 1, slot, g.rarity, stage.level - 1);
      it.plus = g.plus;
      return it;
    });
    const hs = computeHeroStats(HEROES.kael, Math.min(50, stage.level - 2), gear, null);
    const sc = enemyScaleFor(
      stage.level,
      'normal',
      stageEnemyMult(stage, { hp: 1, atk: 1 }),
      stage.bossAffixes,
    );
    const hit =
      hs.atk * defenseFactor(b.stats.def * sc.def) * (1 + hs.critChance * (hs.critDamage - 1));
    const bossHit = b.stats.atk * sc.atk * 1.5 * defenseFactor(hs.def);
    const ward = combineAffixes(stage.bossAffixes ?? []).effects.ward;
    const wardHits = ward !== null ? (b.stats.maxHp * sc.hp * ward.frac) / hit : 0;
    return {
      chapter: n,
      level: stage.level,
      boss: stage.boss,
      affixes: (stage.bossAffixes ?? []).join(','),
      hitsToKill: Math.round((b.stats.maxHp * sc.hp) / hit + wardHits),
      hitsToDie: Math.round((hs.maxHp / bossHit) * 10) / 10,
    };
  });

  it('bosses get tougher and more dangerous with depth, but stay beatable', () => {
    console.info(rows);
    for (const r of rows) {
      expect(r.hitsToKill, `${r.chapter}`).toBeGreaterThan(70);
      expect(r.hitsToKill, `${r.chapter}`).toBeLessThan(420);
      expect(r.hitsToDie, `${r.chapter}`).toBeGreaterThan(8);
    }
    const first = rows[0];
    const last = rows[rows.length - 1];
    if (first === undefined || last === undefined) throw new Error('rows');
    expect(last.hitsToKill).toBeGreaterThan(first.hitsToKill);
    expect(last.hitsToDie).toBeLessThan(first.hitsToDie);
  });

  it('affix stats fold in multiplicatively; behaviours keep the strongest', () => {
    const t = combineAffixes(['ironclad', 'hulking', 'quickened', 'warded', 'bloodsworn']);
    expect(t.def).toBeCloseTo(1.6);
    expect(t.hp).toBeCloseTo(1.4);
    expect(t.speed).toBeCloseTo(1.15);
    expect(t.effects.drain).toBeCloseTo(0.3);
    expect(t.effects.ward).toEqual(AFFIXES.warded.ward);
    expect(combineAffixes([]).effects.ward).toBeNull();
    expect(AFFIX_IDS.length).toBeGreaterThanOrEqual(5);
  });
});
