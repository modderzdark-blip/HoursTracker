import { DIFFICULTIES, type DifficultyId } from '../data/difficulty';
import { HEROES, type HeroId } from '../data/heroes';
import { MODE_ORDER, MODES } from '../data/modes';
import { DROP_TABLES, type DropTableId } from '../data/progression';
import { CHAPTERS, type AdventureStageDef } from '../data/stages';
import type { GearItem } from '../progression/gear';
import { rollDrops } from '../progression/loot';
import {
  DIFFICULTY_ORDER,
  type PlayerProfile,
  type SalvageSummary,
} from '../progression/PlayerProfile';
import type { BattleOutcome } from './BattleMode';

/** Everything a victory screen shows (and that was already granted). */
export interface RewardSummary {
  readonly title: string;
  readonly subtitle: string;
  readonly stars: number;
  readonly previousStars: number;
  readonly timeSec: number;
  readonly gold: number;
  readonly gems: number;
  readonly souls: number;
  readonly materials: number;
  readonly tickets: number;
  readonly xp: number;
  readonly items: readonly GearItem[];
  readonly autoSalvaged: SalvageSummary;
  readonly heroId: HeroId;
  readonly levelsGained: number;
  readonly heroLevel: number;
  readonly firstClear: boolean;
  /** Human-readable unlock notices ("Hard difficulty unlocked", "Dungeon unlocked"). */
  readonly unlocks: readonly string[];
}

interface UnlockSnapshot {
  modes: Set<string>;
  difficulties: Set<string>;
  heroes: Set<string>;
}

function snapshotUnlocks(profile: PlayerProfile): UnlockSnapshot {
  const modes = new Set<string>();
  for (const m of MODE_ORDER) if (profile.modeUnlocked(m)) modes.add(m);
  const difficulties = new Set<string>();
  for (const c of CHAPTERS)
    for (const d of DIFFICULTY_ORDER)
      if (profile.difficultyUnlocked(c.number, d)) difficulties.add(`${c.number}:${d}`);
  const heroes = new Set<string>();
  for (const id of Object.keys(HEROES) as HeroId[]) {
    const b = profile.heroUnlockBlock(id);
    if (b === null || b === 'souls' || b === 'unlocked') heroes.add(id);
  }
  return { modes, difficulties, heroes };
}

function diffUnlocks(before: UnlockSnapshot, after: UnlockSnapshot): string[] {
  const out: string[] = [];
  for (const m of MODE_ORDER)
    if (after.modes.has(m) && !before.modes.has(m)) out.push(`${MODES[m].name} unlocked`);
  for (const key of after.difficulties) {
    if (before.difficulties.has(key)) continue;
    const [ch, d] = key.split(':');
    const label = DIFFICULTIES[d as DifficultyId].label;
    out.push(`Chapter ${ch} — ${label} difficulty unlocked`);
  }
  for (const id of Object.keys(HEROES) as HeroId[]) {
    if (after.heroes.has(id) && !before.heroes.has(id))
      out.push(`${HEROES[id].name} can now be summoned (Heroes)`);
  }
  return out;
}

export interface GrantInput {
  readonly profile: PlayerProfile;
  readonly heroId: HeroId;
  readonly difficulty: DifficultyId;
  readonly outcome: BattleOutcome;
  readonly level: number;
  readonly drops: DropTableId;
  readonly gold: number;
  readonly xp: number;
  /** Extra flat rewards (mode milestones). */
  readonly bonusGems?: number;
  readonly bonusTickets?: number;
  readonly rng: () => number;
  readonly title: string;
  readonly subtitle: string;
  /** Called after the general rewards, before unlocks are compared (records, mode state). */
  readonly record?: () => { firstClear: boolean; previousStars: number; starGems: number };
}

/**
 * Grants a victory's rewards to the profile: gold, gems, souls, XP, materials, tickets and gear
 * (rolled from the drop table with pity), updates lifetime stats, and reports new unlocks.
 */
export function grantVictory(i: GrantInput): RewardSummary {
  const p = i.profile;
  const before = snapshotUnlocks(p);
  const diff = DIFFICULTIES[i.difficulty];
  const gold = Math.round(i.gold * diff.rewards);
  const xp = Math.round(i.xp * diff.rewards);
  const loot = rollDrops(i.rng, DROP_TABLES[i.drops], {
    level: i.level,
    difficulty: i.difficulty,
    pity: p.data.pity,
    nextUid: p.nextUid,
    materialMult: diff.rewards,
  });
  const added = p.addLoot(loot.items);
  const rec = i.record?.() ?? { firstClear: false, previousStars: 0, starGems: 0 };
  const gems = rec.starGems + (i.bonusGems ?? 0);
  const tickets = loot.tickets + (i.bonusTickets ?? 0);
  p.wallet.add('gold', gold);
  if (i.bonusGems !== undefined && i.bonusGems > 0) p.wallet.add('gems', i.bonusGems);
  if (i.outcome.souls > 0) p.wallet.add('souls', i.outcome.souls);
  if (loot.materials > 0) p.wallet.add('materials', loot.materials);
  if (tickets > 0) p.wallet.add('tickets', tickets);
  const lt = p.data.lifetime;
  lt.battles++;
  lt.victories++;
  lt.kills += i.outcome.kills;
  if (i.outcome.bossKilled) lt.bossKills++;
  const levelsGained = p.grantXp(i.heroId, xp);
  const after = snapshotUnlocks(p);
  p.commit();
  return {
    title: i.title,
    subtitle: i.subtitle,
    stars: i.outcome.stars,
    previousStars: rec.previousStars,
    timeSec: i.outcome.timeSec,
    gold,
    gems,
    souls: i.outcome.souls,
    materials: loot.materials,
    tickets,
    xp,
    items: added.kept,
    autoSalvaged: added.salvaged,
    heroId: i.heroId,
    levelsGained,
    heroLevel: p.hero(i.heroId).level,
    firstClear: rec.firstClear,
    unlocks: diffUnlocks(before, after),
  };
}

/** Records a defeat in lifetime stats (no rewards). */
export function recordDefeat(profile: PlayerProfile, outcome: BattleOutcome): void {
  profile.data.lifetime.battles++;
  profile.data.lifetime.kills += outcome.kills;
  profile.commit();
}

/** Adventure: rewards for clearing a stage, plus its record and star gems. */
export function grantAdventureVictory(
  profile: PlayerProfile,
  heroId: HeroId,
  stage: AdventureStageDef,
  difficulty: DifficultyId,
  outcome: BattleOutcome,
  rng: () => number,
): RewardSummary {
  return grantVictory({
    profile,
    heroId,
    difficulty,
    outcome,
    level: stage.level,
    drops: stage.drops,
    gold: stage.rewards.gold,
    xp: stage.rewards.xp,
    rng,
    title: 'Victory',
    subtitle: `${stage.chapter}-${stage.index + 1} · ${stage.name} · ${DIFFICULTIES[difficulty].label}`,
    record: () => profile.submitStageResult(stage.id, difficulty, outcome.stars, outcome.timeSec),
  });
}
