/**
 * Long-term progress data: daily quests, the login calendar, achievements, the Ember Hearth
 * (rewards that build up over real time) and the Ember Blessing (help after defeats). Logic
 * lives in src/progression/goals.ts.
 */
import type { Currency } from './economy';
import type { ModeId } from './modes';

/** Things the game counts for quests (and lifetime achievements). */
export type GoalEvent =
  | 'kill'
  | 'victory'
  | 'bossKill'
  | 'perfectDodge'
  | 'upgrade'
  | 'salvage'
  | 'dungeonRun'
  | 'arenaFight'
  | 'towerFloor'
  | 'challengeWin'
  | 'threeStars';

export type RewardBundle = Partial<Record<Currency, number>>;

export interface QuestDef {
  readonly id: string;
  readonly text: string;
  readonly event: GoalEvent;
  readonly target: number;
  readonly reward: RewardBundle;
  /** Only offered once this mode is unlocked. */
  readonly needsMode?: ModeId;
}

export const DAILY_QUESTS: readonly QuestDef[] = [
  { id: 'q_kill', text: 'Slay 40 foes', event: 'kill', target: 40, reward: { gold: 600 } },
  {
    id: 'q_win',
    text: 'Win 3 battles',
    event: 'victory',
    target: 3,
    reward: { gold: 400, materials: 6 },
  },
  { id: 'q_boss', text: 'Defeat a boss', event: 'bossKill', target: 1, reward: { gems: 10 } },
  {
    id: 'q_dodge',
    text: 'Land 5 perfect dodges',
    event: 'perfectDodge',
    target: 5,
    reward: { gems: 8 },
  },
  {
    id: 'q_upgrade',
    text: 'Upgrade gear 3 times',
    event: 'upgrade',
    target: 3,
    reward: { materials: 10 },
  },
  {
    id: 'q_salvage',
    text: 'Salvage 5 items',
    event: 'salvage',
    target: 5,
    reward: { gold: 500 },
  },
  {
    id: 'q_stars',
    text: 'Win a stage with 3 stars',
    event: 'threeStars',
    target: 1,
    reward: { gems: 8 },
  },
  {
    id: 'q_dungeon',
    text: 'Finish a Dungeon run',
    event: 'dungeonRun',
    target: 1,
    reward: { tickets: 1 },
    needsMode: 'dungeon',
  },
  {
    id: 'q_arena',
    text: 'Fight 2 Arena duels',
    event: 'arenaFight',
    target: 2,
    reward: { gems: 12 },
    needsMode: 'arena',
  },
  {
    id: 'q_tower',
    text: 'Clear a Demon Tower floor',
    event: 'towerFloor',
    target: 1,
    reward: { materials: 12 },
    needsMode: 'tower',
  },
  {
    id: 'q_challenge',
    text: 'Win a Boss Challenge',
    event: 'challengeWin',
    target: 1,
    reward: { tickets: 1 },
    needsMode: 'challenge',
  },
];

export const DAILY_CONFIG = {
  questsPerDay: 3,
  /** Extra reward for finishing every quest of the day. */
  allDoneBonus: { gems: 25, tickets: 1 } as RewardBundle,
} as const;

/** Login calendar: one reward per day you open the game, cycling every 7 days. */
export const LOGIN_REWARDS: readonly RewardBundle[] = [
  { gold: 500 },
  { materials: 10 },
  { gems: 20 },
  { tickets: 1 },
  { gold: 1200 },
  { materials: 20 },
  { gems: 50, tickets: 2 },
];

/**
 * Ember Hearth: gold, XP and materials build up while you are away, up to `capHours`. The
 * hourly rate grows with the highest Adventure level you have cleared.
 */
export const HEARTH_CONFIG = {
  capHours: 12,
  /** Collecting needs at least this much stored time. */
  minCollectMinutes: 1,
  goldPerHour: { base: 120, perLevel: 25 },
  xpPerHour: { base: 60, perLevel: 22 },
  materialsPerHour: { base: 1, perLevel: 0.2 },
} as const;

/**
 * Ember Blessing: each defeat on a stage adds a stack (up to `maxStacks`) that raises ATK and
 * max HP on that stage until it is cleared, so a wall always turns into a win with time.
 */
export const BLESSING_CONFIG = {
  maxStacks: 3,
  atkPerStack: 0.1,
  hpPerStack: 0.12,
} as const;

/** Lifetime achievements: each has tiers; claiming a tier pays its gems. */
export type AchievementStat =
  | 'kills'
  | 'bossKills'
  | 'victories'
  | 'stars'
  | 'heroLevel'
  | 'towerFloor'
  | 'arenaRating'
  | 'perfectDodges'
  | 'bestPlus'
  | 'heroes';

export interface AchievementDef {
  readonly id: string;
  readonly name: string;
  /** `{n}` is replaced with the tier target. */
  readonly text: string;
  readonly stat: AchievementStat;
  readonly tiers: readonly number[];
  readonly gems: readonly number[];
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  {
    id: 'a_slayer',
    name: 'Ashreaper',
    text: 'Foes slain: {n}',
    stat: 'kills',
    tiers: [100, 500, 2000, 8000],
    gems: [10, 25, 50, 100],
  },
  {
    id: 'a_bosses',
    name: 'Tyrant Breaker',
    text: 'Bosses defeated: {n}',
    stat: 'bossKills',
    tiers: [1, 10, 40, 150],
    gems: [10, 25, 50, 100],
  },
  {
    id: 'a_wins',
    name: 'Unbowed',
    text: 'Battles won: {n}',
    stat: 'victories',
    tiers: [10, 50, 200, 600],
    gems: [10, 25, 50, 100],
  },
  {
    id: 'a_stars',
    name: 'Starlit Path',
    text: 'Earn {n} stars (all difficulties)',
    stat: 'stars',
    tiers: [10, 36, 72, 144, 216],
    gems: [15, 30, 50, 80, 150],
  },
  {
    id: 'a_level',
    name: 'Forged in Ash',
    text: 'Raise a hero to level {n}',
    stat: 'heroLevel',
    tiers: [10, 20, 30, 40, 50],
    gems: [15, 30, 50, 80, 150],
  },
  {
    id: 'a_tower',
    name: 'Spire Climber',
    text: 'Reach Demon Tower floor {n}',
    stat: 'towerFloor',
    tiers: [5, 10, 25, 50],
    gems: [15, 30, 60, 120],
  },
  {
    id: 'a_arena',
    name: 'Crowd Favourite',
    text: 'Reach Arena rating {n}',
    stat: 'arenaRating',
    tiers: [1150, 1400, 1700, 2000],
    gems: [15, 30, 60, 120],
  },
  {
    id: 'a_dodge',
    name: 'Untouchable',
    text: 'Land {n} perfect dodges',
    stat: 'perfectDodges',
    tiers: [10, 100, 500],
    gems: [10, 30, 80],
  },
  {
    id: 'a_forge',
    name: 'Master Smith',
    text: 'Upgrade an item to +{n}',
    stat: 'bestPlus',
    tiers: [5, 10, 13, 15],
    gems: [10, 30, 60, 120],
  },
  {
    id: 'a_heroes',
    name: 'Fellowship',
    text: 'Have {n} heroes',
    stat: 'heroes',
    tiers: [2, 3],
    gems: [20, 40],
  },
];
