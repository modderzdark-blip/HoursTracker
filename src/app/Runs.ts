import { BOSSES, type BossId } from '../data/bosses';
import { DIFFICULTIES, type DifficultyId } from '../data/difficulty';
import { HEROES } from '../data/heroes';
import {
  ARENA_CONFIG,
  CHALLENGE_CONFIG,
  DUNGEON_CONFIG,
  HUNT_CONFIG,
  HUNT_OMENS,
  TOWER_CONFIG,
} from '../data/modes';
import { chapterDef, findAdventureStage } from '../data/adventure';
import type { AdventureStageDef, StageDef } from '../data/stages';
import type { ChapterCard } from '../ui/BattleCallouts';
import type { BattleOutcome, BattleSetup, PetSetup } from '../modes/BattleMode';
import {
  challengeMult,
  challengeStage,
  consumeDungeonEntry,
  highestClearedLevel,
  huntMult,
  huntRank,
  huntRewards,
  huntStage,
  isTowerBossFloor,
  planDungeon,
  ratingChange,
  towerEnemyMult,
  towerMilestone,
  towerStage,
  type ArenaOpponent,
  type ChallengeBoss,
  type HuntDef,
} from '../modes/meta';
import {
  grantAdventureVictory,
  grantVictory,
  heroStatLine,
  recordDefeat,
  type RewardSummary,
} from '../modes/rewards';
import type { PetCompanion, PlayerProfile } from '../progression/PlayerProfile';
import type { MenuContext } from '../ui/menu/context';
import { BOSS_LINES, chapterStory } from '../data/story';
import { renderDefeat, renderVictory, type ResultButton } from '../ui/menu/rewardScreen';
import { recommendedPower } from '../ui/menu/stageMapScreen';
import type { Menus } from './Menus';

/** Dungeon XP grows with its level so it stays worth running as heroes level up. */
function dungeonXpScale(level: number): number {
  return 1 + Math.max(0, level - 1) * 0.12;
}

/** What the current battle belongs to, so retry / next / rewards know where it came from. */
export type Run =
  | { readonly kind: 'adventure'; readonly stageId: string; readonly difficulty: DifficultyId }
  | {
      readonly kind: 'dungeon';
      readonly difficulty: DifficultyId;
      readonly level: number;
      readonly rooms: readonly StageDef[];
      readonly index: number;
      readonly hpFrac: number;
      readonly souls: number;
      readonly kills: number;
      readonly timeSec: number;
    }
  | { readonly kind: 'tower'; readonly floor: number }
  | { readonly kind: 'challenge'; readonly entry: ChallengeBoss; readonly tier: number }
  | { readonly kind: 'hunt'; readonly hunt: HuntDef }
  | { readonly kind: 'arena'; readonly opponent: ArenaOpponent };

export interface RunHost {
  readonly profile: PlayerProfile;
  readonly menus: Menus;
  readonly rng: () => number;
  startBattle(setup: BattleSetup): void;
  /** The hub preview may need the (levelled) hero rebuilt. */
  refreshHub(): void;
}

/**
 * Turns menu actions into battles and battle outcomes into rewards / next steps for every
 * mode: Adventure, Dungeon (room chain with HP carried over), Demon Tower (floors + milestones),
 * Boss Challenge (tiers), Hunts (daily omen-twisted bosses) and the Arena (rating, async duels).
 */
export class Runs {
  private current: Run | null = null;

  constructor(private readonly host: RunHost) {}

  private get ctx(): MenuContext {
    return this.host.menus.ctx;
  }

  get run(): Run | null {
    return this.current;
  }

  begin(run: Run): void {
    const setup = this.setupFor(run);
    if (setup === null) return;
    this.current = run;
    this.host.startBattle(setup);
  }

  // ------------------------------------------------------------------ starting

  startAdventure(stageId: string, difficulty: DifficultyId): void {
    this.begin({ kind: 'adventure', stageId, difficulty });
  }

  startDungeon(difficulty: DifficultyId): boolean {
    const p = this.host.profile;
    if (!consumeDungeonEntry(p.data.dungeon, Date.now())) return false;
    p.commit();
    const level =
      highestClearedLevel((id) => p.stageClearedAnyDifficulty(id)) + DUNGEON_CONFIG.levelBonus;
    const elites = DUNGEON_CONFIG.elites.filter((b) =>
      CHALLENGE_CONFIG.bosses.some((c) => c.boss === b && p.stageClearedAnyDifficulty(c.stage)),
    );
    const rooms = planDungeon(this.host.rng, level, elites);
    this.begin({
      kind: 'dungeon',
      difficulty,
      level,
      rooms,
      index: 0,
      hpFrac: 1,
      souls: 0,
      kills: 0,
      timeSec: 0,
    });
    return true;
  }

  startTower(floor: number): void {
    this.begin({ kind: 'tower', floor });
  }

  startChallenge(entry: ChallengeBoss, tier: number): void {
    this.begin({ kind: 'challenge', entry, tier });
  }

  startHunt(hunt: HuntDef): void {
    this.begin({ kind: 'hunt', hunt });
  }

  startArena(opponent: ArenaOpponent): void {
    this.begin({ kind: 'arena', opponent });
  }

  // ------------------------------------------------------------------ setups

  private baseSetup(stage: StageDef, label: string): Omit<BattleSetup, 'difficulty'> {
    const p = this.host.profile;
    const heroId = p.selectedHero;
    return {
      stage,
      hero: HEROES[heroId],
      heroStats: p.stats(heroId),
      mods: p.mods(heroId),
      label,
      startHpFrac: 1,
      enemyMult: { hp: 1, atk: 1 },
      allowRevive: true,
      pet: petSetup(p.petCompanion()),
    };
  }

  private setupFor(run: Run): BattleSetup | null {
    switch (run.kind) {
      case 'adventure': {
        const stage = findAdventureStage(run.stageId);
        if (stage === undefined) return null;
        const intro = this.chapterIntro(stage);
        const base = {
          ...this.baseSetup(stage, `${stage.chapter}-${stage.index + 1} · ${stage.name}`),
          ...(intro !== null ? { chapterIntro: intro } : {}),
        };
        const b = this.host.profile.blessing(stage.id, run.difficulty);
        if (b.stacks === 0) return { ...base, difficulty: run.difficulty };
        return {
          ...base,
          label: `${base.label} · Ember Blessing ${'✦'.repeat(b.stacks)}`,
          heroStats: {
            ...base.heroStats,
            atk: Math.round(base.heroStats.atk * b.atkMult),
            maxHp: Math.round(base.heroStats.maxHp * b.hpMult),
          },
          difficulty: run.difficulty,
        };
      }
      case 'dungeon': {
        const room = run.rooms[run.index];
        if (room === undefined) return null;
        return {
          ...this.baseSetup(room, `Dungeon ${run.index + 1}/${run.rooms.length} · ${room.name}`),
          difficulty: run.difficulty,
          startHpFrac: run.hpFrac,
        };
      }
      case 'tower': {
        const stage = towerStage(run.floor);
        return {
          ...this.baseSetup(stage, `Demon Tower · ${stage.name}`),
          difficulty: 'normal',
          enemyMult: towerEnemyMult(run.floor),
          allowRevive: false,
        };
      }
      case 'challenge': {
        const stage = challengeStage(run.entry, run.tier);
        return {
          ...this.baseSetup(stage, `Boss Challenge · ${stage.name}`),
          difficulty: 'normal',
          enemyMult: challengeMult(run.tier),
        };
      }
      case 'hunt': {
        const stage = huntStage(run.hunt);
        const m = huntMult(run.hunt);
        const omens = run.hunt.omens.map((id) => HUNT_OMENS[id].name).join(' · ');
        return {
          ...this.baseSetup(stage, `${stage.name} · ${omens}`),
          difficulty: 'normal',
          enemyMult: { hp: m.hp, atk: m.atk, speed: m.speed },
        };
      }
      case 'arena': {
        const o = run.opponent;
        const stage: StageDef = {
          id: 'arena_duel',
          name: 'Arena',
          arena: ARENA_CONFIG.arena,
          level: 1,
          trainingDummy: false,
          introCountdownMs: 3000,
          waves: [],
          boss: null,
          duel: true,
          stars: { maxDamageTakenFrac: 1, parTimeSec: 90 },
          interWaveMs: 1000,
        };
        const skill = Math.min(1, Math.max(0, (o.rating - 700) / 1000));
        return {
          ...this.baseSetup(stage, `Arena · ${o.name}`),
          difficulty: 'normal',
          allowRevive: false,
          duel: {
            name: o.name,
            title: `${HEROES[o.heroId].name} · Lv ${o.level} · Rating ${o.rating}`,
            hero: HEROES[o.heroId],
            stats: o.stats,
            mods: o.mods,
            skill,
          },
        };
      }
    }
  }

  /** A chapter's first stage opens with its card (longer the first time it is seen). */
  private chapterIntro(stage: AdventureStageDef): ChapterCard | null {
    if (stage.index !== 0) return null;
    const chapter = chapterDef(stage.chapter);
    if (chapter === undefined) return null;
    const story = chapterStory(chapter);
    const seen = this.host.profile.data.story.chapterIntros;
    const first = !seen.includes(stage.chapter);
    if (first) {
      seen.push(stage.chapter);
      this.host.profile.commit();
    }
    return {
      numeral: story.numeral,
      name: chapter.name,
      subtitle: chapter.subtitle,
      lore: story.intro,
      long: first,
    };
  }

  // ------------------------------------------------------------------ outcomes

  /** Shows the right result screen and grants rewards for the battle that just ended. */
  finish(outcome: BattleOutcome): void {
    const run = this.current;
    if (run === null) {
      this.host.menus.hub();
      return;
    }
    this.host.profile.trackBattle(
      run.kind,
      outcome,
      run.kind === 'adventure' ? { stageId: run.stageId, difficulty: run.difficulty } : undefined,
    );
    switch (run.kind) {
      case 'adventure':
        this.finishAdventure(run, outcome);
        break;
      case 'dungeon':
        this.finishDungeon(run, outcome);
        break;
      case 'tower':
        this.finishTower(run, outcome);
        break;
      case 'challenge':
        this.finishChallenge(run, outcome);
        break;
      case 'hunt':
        this.finishHunt(run, outcome);
        break;
      case 'arena':
        this.finishArena(run, outcome);
        break;
    }
    this.host.refreshHub();
  }

  private finishAdventure(run: Extract<Run, { kind: 'adventure' }>, outcome: BattleOutcome): void {
    const p = this.host.profile;
    const stage = findAdventureStage(run.stageId);
    if (stage === undefined) {
      this.host.menus.hub();
      return;
    }
    const retry: ResultButton = {
      label: 'Retry',
      testid: 'result-retry-run',
      run: () => this.begin(run),
    };
    const toMap: ResultButton = {
      label: 'Stage map',
      testid: 'result-map',
      run: () => this.host.menus.stageMap(stage.chapter),
    };
    if (!outcome.victory) {
      recordDefeat(p, outcome);
      const b = p.blessing(stage.id, run.difficulty);
      const help =
        b.stacks > 0
          ? ` — Ember Blessing ${'✦'.repeat(b.stacks)}: +${Math.round((b.atkMult - 1) * 100)}% ATK and +${Math.round((b.hpMult - 1) * 100)}% HP here until you win`
          : '';
      const boss = stage.boss !== null && outcome.bossReached ? BOSSES[stage.boss] : null;
      renderDefeat(
        this.ctx,
        `${stage.chapter}-${stage.index + 1} · ${stage.name}${help}`,
        [toMap, { ...retry, primary: true }],
        'Defeat',
        {
          ...(boss !== null
            ? { bossLine: { name: boss.name, line: BOSS_LINES[boss.id as BossId].triumph } }
            : {}),
          recommended: recommendedPower(stage.level, run.difficulty),
        },
      );
      return;
    }
    const summary = grantAdventureVictory(
      p,
      p.selectedHero,
      stage,
      run.difficulty,
      outcome,
      this.host.rng,
    );
    const buttons: ResultButton[] = [toMap, retry];
    const next =
      chapterDef(stage.chapter)?.stages[stage.index + 1] ??
      chapterDef(stage.chapter + 1)?.stages[0];
    if (next !== undefined && p.stageUnlocked(next, run.difficulty)) {
      buttons.push({
        label: 'Next stage',
        primary: true,
        testid: 'result-next',
        run: () => this.startAdventure(next.id, run.difficulty),
      });
    } else {
      buttons[0] = { ...toMap, primary: true };
    }
    renderVictory(this.ctx, summary, buttons);
  }

  private finishDungeon(run: Extract<Run, { kind: 'dungeon' }>, outcome: BattleOutcome): void {
    const p = this.host.profile;
    const cleared = run.index + (outcome.victory ? 1 : 0);
    const total = run.rooms.length;
    const souls = run.souls + outcome.souls;
    const kills = run.kills + outcome.kills;
    const timeSec = run.timeSec + outcome.timeSec;
    const toMenu: ResultButton = {
      label: 'Dungeon',
      testid: 'result-dungeon',
      run: () => this.host.menus.mode('dungeon'),
    };
    if (outcome.victory && cleared < total) {
      // Room cleared: continue (HP carries over) or leave with the rooms cleared so far.
      const next: Run = {
        ...run,
        index: cleared,
        hpFrac: Math.max(0.25, outcome.hpFrac),
        souls,
        kills,
        timeSec,
      };
      this.current = next;
      renderDefeat(
        this.ctx,
        `Room ${cleared}/${total} cleared — HP ${Math.round(outcome.hpFrac * 100)}% carries over`,
        [
          {
            label: 'Leave with spoils',
            testid: 'dungeon-leave',
            run: () => this.dungeonPartial(next, cleared, toMenu),
          },
          {
            label: `Room ${cleared + 1}`,
            primary: true,
            testid: 'dungeon-next',
            run: () => this.begin(next),
          },
        ],
        'Room cleared',
      );
      return;
    }
    if (!outcome.victory) {
      recordDefeat(p, outcome);
      this.dungeonPartial({ ...run, souls, kills, timeSec }, cleared, toMenu);
      return;
    }
    // Full clear: the big reward.
    p.data.dungeon.runs++;
    p.track('dungeonRun', 1);
    p.data.dungeon.bestRooms = Math.max(p.data.dungeon.bestRooms, total);
    const summary = grantVictory({
      profile: p,
      heroId: p.selectedHero,
      difficulty: run.difficulty,
      outcome: { ...outcome, souls, kills, timeSec, stars: 3 },
      level: run.level + total - 1,
      drops: 'dungeon',
      gold: DUNGEON_CONFIG.roomGold * total,
      xp: Math.round(DUNGEON_CONFIG.roomXp * total * dungeonXpScale(run.level)),
      rng: this.host.rng,
      title: 'Dungeon cleared',
      subtitle: `${total} rooms · ${DIFFICULTIES[run.difficulty].label}`,
    });
    renderVictory(this.ctx, summary, [{ ...toMenu, primary: true }]);
  }

  /** Leaving / falling: gold and XP for the rooms cleared, no gear. */
  private dungeonPartial(
    run: Extract<Run, { kind: 'dungeon' }>,
    cleared: number,
    toMenu: ResultButton,
  ): void {
    const p = this.host.profile;
    const d = DIFFICULTIES[run.difficulty];
    p.data.dungeon.bestRooms = Math.max(p.data.dungeon.bestRooms, cleared);
    p.data.dungeon.runs++;
    p.track('dungeonRun', 1);
    if (cleared === 0) {
      p.commit();
      renderDefeat(this.ctx, 'The dungeon claims another hunter. No rooms cleared.', [
        { ...toMenu, primary: true },
      ]);
      return;
    }
    const gold = Math.round(DUNGEON_CONFIG.roomGold * cleared * d.rewards);
    const xp = Math.round(DUNGEON_CONFIG.roomXp * cleared * d.rewards * dungeonXpScale(run.level));
    p.wallet.add('gold', gold);
    if (run.souls > 0) p.wallet.add('souls', run.souls);
    const levels = p.grantXp(p.selectedHero, xp);
    p.commit();
    renderDefeat(
      this.ctx,
      `${cleared} room(s) cleared: +${gold} gold, +${xp} XP${run.souls > 0 ? `, +${run.souls} souls` : ''}${levels > 0 ? ' — LEVEL UP!' : ''}`,
      [{ ...toMenu, primary: true }],
      'Dungeon left',
    );
    this.current = null;
  }

  private finishTower(run: Extract<Run, { kind: 'tower' }>, outcome: BattleOutcome): void {
    const p = this.host.profile;
    const toMenu: ResultButton = {
      label: 'Tower',
      testid: 'result-tower',
      run: () => this.host.menus.mode('tower'),
    };
    if (!outcome.victory) {
      recordDefeat(p, outcome);
      renderDefeat(this.ctx, `Floor ${run.floor} · best floor ${p.data.tower.bestFloor}`, [
        toMenu,
        {
          label: 'Retry floor',
          primary: true,
          testid: 'result-retry-run',
          run: () => this.begin(run),
        },
      ]);
      return;
    }
    const t = p.data.tower;
    const firstTime = run.floor > t.bestFloor;
    t.bestFloor = Math.max(t.bestFloor, run.floor);
    const milestone = towerMilestone(run.floor);
    let bonusGems = 0;
    let bonusTickets = 0;
    if (milestone !== null && !t.claimed.includes(run.floor)) {
      t.claimed.push(run.floor);
      bonusGems = milestone.gems;
      bonusTickets = milestone.tickets;
    }
    const scale = 1 + run.floor * 0.05;
    const summary: RewardSummary = grantVictory({
      profile: p,
      heroId: p.selectedHero,
      difficulty: 'normal',
      outcome,
      level: towerStage(run.floor).level,
      drops: isTowerBossFloor(run.floor) ? 'boss' : 'tower',
      gold: Math.round(TOWER_CONFIG.floorGold * scale),
      xp: Math.round(TOWER_CONFIG.floorXp * scale),
      bonusGems,
      bonusTickets,
      rng: this.host.rng,
      title: `Floor ${run.floor} cleared`,
      subtitle: `${firstTime ? 'New best floor! ' : ''}${milestone !== null && bonusGems > 0 ? 'Milestone reward claimed.' : ''}`,
    });
    renderVictory(this.ctx, summary, [
      toMenu,
      {
        label: `Floor ${run.floor + 1}`,
        primary: true,
        testid: 'result-next',
        run: () => this.startTower(run.floor + 1),
      },
    ]);
  }

  private finishChallenge(run: Extract<Run, { kind: 'challenge' }>, outcome: BattleOutcome): void {
    const p = this.host.profile;
    const toMenu: ResultButton = {
      label: 'Challenges',
      testid: 'result-challenge',
      run: () => this.host.menus.mode('challenge'),
    };
    const name = BOSSES[run.entry.boss].name;
    if (!outcome.victory) {
      recordDefeat(p, outcome);
      renderDefeat(this.ctx, `${name} · Tier ${run.tier}`, [
        toMenu,
        { label: 'Retry', primary: true, testid: 'result-retry-run', run: () => this.begin(run) },
      ]);
      return;
    }
    const best = p.data.challenge[run.entry.boss] ?? 0;
    const firstClear = run.tier > best;
    if (firstClear) p.data.challenge[run.entry.boss] = run.tier;
    const summary = grantVictory({
      profile: p,
      heroId: p.selectedHero,
      difficulty: 'normal',
      outcome,
      level: challengeStage(run.entry, run.tier).level,
      drops: 'challenge',
      gold: CHALLENGE_CONFIG.goldPerTier * run.tier,
      xp: CHALLENGE_CONFIG.xpPerTier * run.tier,
      bonusGems: firstClear ? CHALLENGE_CONFIG.firstClearGemsPerTier * run.tier : 0,
      rng: this.host.rng,
      title: 'Challenge won',
      subtitle: `${name} · Tier ${run.tier}${firstClear ? ' · first clear' : ''}`,
    });
    const buttons: ResultButton[] = [toMenu];
    if (run.tier < CHALLENGE_CONFIG.maxTier)
      buttons.push({
        label: `Tier ${run.tier + 1}`,
        primary: true,
        testid: 'result-next',
        run: () => this.startChallenge(run.entry, run.tier + 1),
      });
    else buttons[0] = { ...toMenu, primary: true };
    renderVictory(this.ctx, summary, buttons);
  }

  private finishHunt(run: Extract<Run, { kind: 'hunt' }>, outcome: BattleOutcome): void {
    const p = this.host.profile;
    const h = run.hunt;
    const name = BOSSES[h.entry.boss].name;
    const toMenu: ResultButton = {
      label: 'Hunts',
      testid: 'result-hunts',
      run: () => this.host.menus.mode('hunts'),
    };
    if (!outcome.victory) {
      recordDefeat(p, outcome);
      renderDefeat(this.ctx, `Hunt · ${name}`, [
        toMenu,
        { label: 'Retry', primary: true, testid: 'result-retry-run', run: () => this.begin(run) },
      ]);
      return;
    }
    // A hunt from yesterday's board (fought across midnight) still pays as a first kill.
    const board = p.huntBoard();
    const replay = p.data.hunts.won.includes(h.id);
    const rankBefore = huntRank(p.data.hunts.completed);
    if (!replay) {
      if (board.some((b) => b.id === h.id)) p.data.hunts.won.push(h.id);
      p.data.hunts.completed++;
    }
    const rankAfter = huntRank(p.data.hunts.completed);
    const r = huntRewards(h, replay);
    const summary = grantVictory({
      profile: p,
      heroId: p.selectedHero,
      difficulty: HUNT_CONFIG.lootQuality,
      outcome,
      level: h.level,
      drops: 'hunt',
      // grantVictory applies the loot quality's reward multiplier; hunts pay their own numbers.
      gold: r.gold / DIFFICULTIES[HUNT_CONFIG.lootQuality].rewards,
      xp: r.xp / DIFFICULTIES[HUNT_CONFIG.lootQuality].rewards,
      bonusGems: r.gems,
      rng: this.host.rng,
      title: replay ? 'Hunt won again' : 'Hunt complete',
      subtitle:
        `${name} · ${h.omens.map((id) => HUNT_OMENS[id].name).join(' · ')}` +
        (rankAfter > rankBefore ? ` · Hunt rank ${rankAfter}!` : ''),
    });
    renderVictory(this.ctx, summary, [{ ...toMenu, primary: true }]);
  }

  private finishArena(run: Extract<Run, { kind: 'arena' }>, outcome: BattleOutcome): void {
    const p = this.host.profile;
    const a = p.data.arena;
    const won = outcome.victory;
    const delta = ratingChange(a.rating, run.opponent.rating, won);
    a.rating = Math.max(0, a.rating + delta);
    a.bestRating = Math.max(a.bestRating, a.rating);
    if (won) {
      a.wins++;
      a.streak = Math.max(1, a.streak + 1);
    } else {
      a.losses++;
      a.streak = Math.min(-1, a.streak - 1);
    }
    a.opponentSeed = (a.opponentSeed * 48271 + 7) % 2147483647 || 1;
    const toMenu: ResultButton = {
      label: 'Arena',
      primary: true,
      testid: 'result-arena',
      run: () => this.host.menus.mode('arena'),
    };
    if (!won) {
      recordDefeat(p, outcome);
      renderDefeat(this.ctx, `${run.opponent.name} prevails · rating ${delta} → ${a.rating}`, [
        toMenu,
      ]);
      return;
    }
    const gold = ARENA_CONFIG.winGold;
    const gems = ARENA_CONFIG.winGems;
    p.wallet.add('gold', gold);
    p.wallet.add('gems', gems);
    p.data.lifetime.battles++;
    p.data.lifetime.victories++;
    p.commit();
    const hero = p.hero(p.selectedHero);
    const line = heroStatLine(p, p.selectedHero);
    renderVictory(
      this.ctx,
      {
        title: 'Duel won',
        subtitle: `${run.opponent.name} defeated · rating +${delta} → ${a.rating}`,
        stars: 3,
        previousStars: 3,
        timeSec: outcome.timeSec,
        gold,
        gems,
        souls: 0,
        materials: 0,
        tickets: 0,
        xp: 0,
        items: [],
        autoSalvaged: { count: 0, materials: 0, gold: 0 },
        heroId: p.selectedHero,
        levelsGained: 0,
        heroLevel: hero.level,
        firstClear: false,
        unlocks: [],
        unlockEvents: [],
        levelBefore: hero.level,
        xpBefore: hero.xp,
        xpAfter: hero.xp,
        statsBefore: line,
        statsAfter: line,
        chapterComplete: null,
      },
      [toMenu],
    );
  }
}

function petSetup(c: PetCompanion | null): PetSetup | null {
  if (c === null) return null;
  return {
    name: c.def.name,
    look: c.def.look,
    everySec: c.def.strike.everySec,
    mult: c.strikeMult,
    rangeM: c.def.strike.rangeM,
  };
}
