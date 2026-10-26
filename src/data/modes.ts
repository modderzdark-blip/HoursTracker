import type { ArenaId } from './arenas';
import type { BossId } from './bosses';
import type { DifficultyId } from './difficulty';
import type { EnemyId } from './enemies';

/**
 * Game-mode unlock rules and labels. Each mode's own tunables live with the mode (dungeon,
 * tower, challenge, arena sections below are filled in as the modes are added).
 */
export type ModeId = 'adventure' | 'dungeon' | 'tower' | 'challenge' | 'hunts' | 'arena';

export interface ModeInfo {
  readonly id: ModeId;
  readonly name: string;
  readonly blurb: string;
  /** Stage id that must be cleared (any difficulty) to unlock; null = always open. */
  readonly requiresStage: string | null;
  readonly requiresLabel: string;
}

export const MODES: Readonly<Record<ModeId, ModeInfo>> = {
  adventure: {
    id: 'adventure',
    name: 'Adventure',
    blurb: 'Fight through the fallen lands, chapter by chapter.',
    requiresStage: null,
    requiresLabel: '',
  },
  dungeon: {
    id: 'dungeon',
    name: 'Dungeon',
    blurb: 'Delve through random chambers for richer spoils.',
    requiresStage: 'c1s8',
    requiresLabel: 'Clear Chapter 1',
  },
  challenge: {
    id: 'challenge',
    name: 'Boss Challenge',
    blurb: 'Face defeated bosses again at higher tiers.',
    requiresStage: 'c1s4',
    requiresLabel: 'Defeat The Gaoler (1-4)',
  },
  hunts: {
    id: 'hunts',
    name: 'Hunts',
    blurb: 'Three marked beasts each day, twisted by omens. Richer spoils.',
    requiresStage: 'c1s4',
    requiresLabel: 'Defeat The Gaoler (1-4)',
  },
  arena: {
    id: 'arena',
    name: 'Arena',
    blurb: 'Duel other hunters’ shades for rank and glory.',
    requiresStage: 'c1s8',
    requiresLabel: 'Clear Chapter 1',
  },
  tower: {
    id: 'tower',
    name: 'Demon Tower',
    blurb: 'Climb endless floors. A tyrant waits every tenth.',
    requiresStage: 'c2s8',
    requiresLabel: 'Clear Chapter 2',
  },
};

export const MODE_ORDER: readonly ModeId[] = [
  'adventure',
  'dungeon',
  'challenge',
  'hunts',
  'arena',
  'tower',
];

// ------------------------------------------------------------------ Dungeon

export interface DungeonRoomDef {
  readonly arena: ArenaId;
  readonly name: string;
  readonly waves: readonly (readonly (readonly [EnemyId, number])[])[];
}

export const DUNGEON_CONFIG = {
  maxEntries: 5,
  /** One entry comes back every this many hours (real time). */
  refillHours: 4,
  roomsPerRun: 4,
  /** Dungeon level = highest Adventure stage level cleared + this. */
  levelBonus: 2,
  /** Gold / XP for each cleared room (× difficulty rewards). */
  roomGold: 140,
  roomXp: 90,
  /** Final-room elites (mini-bosses), picked at random from those already defeated. */
  elites: ['gaoler', 'seer_exalted', 'penitent'] satisfies readonly BossId[],
  rooms: [
    {
      arena: 'ash_gate',
      name: 'Ossuary',
      waves: [
        [
          ['revenant', 3],
          ['gloom_bat', 4],
        ],
        [
          ['ember_wisp', 3],
          ['revenant', 2],
        ],
      ],
    },
    {
      arena: 'cinder_court',
      name: 'Ember Vault',
      waves: [
        [
          ['hexcaller', 2],
          ['revenant', 2],
        ],
        [
          ['hex_wisp', 1],
          ['gloom_bat', 5],
        ],
      ],
    },
    {
      arena: 'ashen_wastes',
      name: 'Burning Pit',
      waves: [
        [['ember_wisp', 5]],
        [
          ['magma_golem', 1],
          ['ember_wisp', 2],
        ],
      ],
    },
    {
      arena: 'bound_spire',
      name: 'Chained Hall',
      waves: [
        [
          ['bulwark', 2],
          ['hexcaller', 2],
        ],
        [
          ['revenant', 4],
          ['brute', 1],
        ],
      ],
    },
    {
      arena: 'ash_gate',
      name: 'Bat Roost',
      waves: [
        [['gloom_bat', 8]],
        [
          ['gloom_bat', 5],
          ['hex_wisp', 1],
        ],
      ],
    },
    {
      arena: 'cinder_court',
      name: 'Shield Wall',
      waves: [
        [['bulwark', 3]],
        [
          ['bulwark', 2],
          ['hexcaller', 2],
        ],
      ],
    },
  ] satisfies readonly DungeonRoomDef[],
} as const;

// ------------------------------------------------------------------ Tower

export const TOWER_CONFIG = {
  /** Enemy level on floor n = 1 + floor(n × levelPerFloor). */
  levelPerFloor: 0.9,
  /** Extra HP / ATK per floor on top of level scaling. */
  hpPerFloor: 0.012,
  atkPerFloor: 0.006,
  /** Every Nth floor is a boss floor. */
  bossEvery: 10,
  bosses: [
    'hollow_warden',
    'mother_of_ash',
    'bound_king',
    'gaoler',
    'seer_exalted',
    'penitent',
    'ash_behemoth',
    'brood_weaver',
    'cinder_wyrm',
    'headsman',
    'hollow_twin',
    'bone_cantor',
    'twin_maw',
    'ossuary_queen',
  ] satisfies readonly BossId[],
  arenas: [
    'cinder_court',
    'ash_gate',
    'ashen_wastes',
    'bound_spire',
    'hollow_deep',
  ] satisfies readonly ArenaId[],
  /** Enemy types allowed from these floors on. */
  enemyUnlocks: [
    { enemy: 'thrall', floor: 1 },
    { enemy: 'gloom_bat', floor: 1 },
    { enemy: 'revenant', floor: 2 },
    { enemy: 'ember_wisp', floor: 3 },
    { enemy: 'hexcaller', floor: 5 },
    { enemy: 'hex_wisp', floor: 7 },
    { enemy: 'bulwark', floor: 8 },
    { enemy: 'magma_golem', floor: 10 },
    { enemy: 'ash_hound', floor: 12 },
    { enemy: 'broodling', floor: 14 },
  ] satisfies readonly { enemy: EnemyId; floor: number }[],
  floorGold: 60,
  floorXp: 90,
  /** Milestones every N floors: one-time gems + tickets (× floor / N). */
  milestoneEvery: 5,
  milestoneGems: 8,
  milestoneTickets: 1,
} as const;

// ------------------------------------------------------------------ Boss Challenge

export const CHALLENGE_CONFIG = {
  maxTier: 10,
  /** Enemy level = the boss's Adventure stage level + tier × levelPerTier. */
  levelPerTier: 3,
  hpPerTier: 0.15,
  atkPerTier: 0.08,
  /** First clear of a tier: gems = tier × this. */
  firstClearGemsPerTier: 5,
  goldPerTier: 220,
  xpPerTier: 200,
  /** Which Adventure stage unlocks each boss for the challenge. */
  bosses: [
    { boss: 'gaoler', stage: 'c1s4', arena: 'ash_gate' },
    { boss: 'hollow_warden', stage: 'c1s8', arena: 'cinder_court' },
    { boss: 'seer_exalted', stage: 'c2s4', arena: 'ashen_wastes' },
    { boss: 'mother_of_ash', stage: 'c2s8', arena: 'ashen_wastes' },
    { boss: 'penitent', stage: 'c3s4', arena: 'bound_spire' },
    { boss: 'bound_king', stage: 'c3s8', arena: 'bound_spire' },
    { boss: 'ash_behemoth', stage: 'c4s4', arena: 'hollow_deep' },
    { boss: 'brood_weaver', stage: 'c4s6', arena: 'hollow_deep' },
    { boss: 'cinder_wyrm', stage: 'c4s8', arena: 'hollow_deep' },
    // Met in the Endless Adventure (generated chapters 5–8 introduce them).
    { boss: 'hollow_twin', stage: 'c5s4', arena: 'cinder_court' },
    { boss: 'headsman', stage: 'c5s8', arena: 'ash_gate' },
    { boss: 'bone_cantor', stage: 'c6s8', arena: 'bound_spire' },
    { boss: 'twin_maw', stage: 'c7s8', arena: 'ashen_wastes' },
    { boss: 'ossuary_queen', stage: 'c8s8', arena: 'hollow_deep' },
  ] satisfies readonly { boss: BossId; stage: string; arena: ArenaId }[],
} as const;

// ------------------------------------------------------------------ Hunts

/** Omens that twist a hunted boss (and its adds). Each raises the hunt's rewards. */
export type HuntOmenId = 'ironhide' | 'brutal' | 'swift' | 'swarming' | 'glass';

export interface HuntOmenDef {
  readonly id: HuntOmenId;
  readonly name: string;
  readonly text: string;
  readonly hp: number;
  readonly atk: number;
  readonly speed: number;
  /** A wave of the boss's chapter enemies comes first. */
  readonly adds: boolean;
  /** Reward multiplier (gold, XP). */
  readonly reward: number;
}

export const HUNT_OMENS: Readonly<Record<HuntOmenId, HuntOmenDef>> = {
  ironhide: {
    id: 'ironhide',
    name: 'Ironhide',
    text: '+35% health',
    hp: 1.35,
    atk: 1,
    speed: 1,
    adds: false,
    reward: 1.2,
  },
  brutal: {
    id: 'brutal',
    name: 'Brutal',
    text: '+25% damage',
    hp: 1,
    atk: 1.25,
    speed: 1,
    adds: false,
    reward: 1.2,
  },
  swift: {
    id: 'swift',
    name: 'Swift',
    text: 'Moves and strikes 15% faster',
    hp: 1,
    atk: 1,
    speed: 1.15,
    adds: false,
    reward: 1.2,
  },
  swarming: {
    id: 'swarming',
    name: 'Swarming',
    text: 'Its brood comes first',
    hp: 1,
    atk: 1,
    speed: 1,
    adds: true,
    reward: 1.15,
  },
  glass: {
    id: 'glass',
    name: 'Glass Fury',
    text: '−30% health, +45% damage',
    hp: 0.7,
    atk: 1.45,
    speed: 1,
    adds: false,
    reward: 1.15,
  },
};

export const HUNT_CONFIG = {
  /** Hunts on the board each day (rerolled at local midnight). */
  perDay: 3,
  /** Omens per hunt: the first hunt has `minOmens`, the last `maxOmens`. */
  minOmens: 1,
  maxOmens: 2,
  /** Hunt rank = 1 + completed hunts / huntsPerRank (capped). */
  huntsPerRank: 3,
  maxRank: 25,
  /** Enemy level = max(boss's Adventure level, highest cleared level − 2) + (rank − 1) × this. */
  levelPerRank: 1,
  gold: 350,
  goldPerLevel: 28,
  xp: 260,
  xpPerLevel: 38,
  /** Gems for the first kill of each hunt on its day (× the hunt's slot, 1..perDay). */
  gemsPerSlot: 4,
  /** Hunted bosses drop loot at this difficulty's quality (rarity odds, item level bonus). */
  lootQuality: 'hard' satisfies DifficultyId,
  /** Replaying a hunt already won today pays this share of gold / XP and no gems. */
  replayShare: 0.3,
} as const;

// ------------------------------------------------------------------ Arena

export const ARENA_CONFIG = {
  startRating: 1000,
  /** Rating change = base + (opponent − player) / spread, clamped. */
  winBase: 20,
  lossBase: 16,
  ratingSpread: 25,
  minChange: 6,
  maxChange: 40,
  seasonDays: 7,
  /** Season end: rating moves halfway back to the start. */
  seasonSoftReset: 0.5,
  opponents: 3,
  /** Opponents are generated around the player's rating (±) and power (× range). */
  ratingRange: 160,
  powerRange: [0.85, 1.15] as const,
  winGold: 180,
  winGems: 2,
  arena: 'cinder_court' satisfies ArenaId,
  /** Season rewards by final rating (highest matching tier). */
  seasonRewards: [
    { minRating: 0, label: 'Ash', gems: 10, tickets: 1 },
    { minRating: 1100, label: 'Ember', gems: 25, tickets: 2 },
    { minRating: 1250, label: 'Flame', gems: 45, tickets: 3 },
    { minRating: 1450, label: 'Inferno', gems: 80, tickets: 5 },
  ],
  /** Original duelist names for generated opponents. */
  names: [
    'Varek the Pale',
    'Sister Ashwyn',
    'Corvane',
    'Ilsa Grimhollow',
    'Dath Morrow',
    'The Cinder Twin',
    'Oren Blackvow',
    'Myrrh of the Veil',
    'Tamsin Coalheart',
    'Hask the Unburied',
    'Liesl Duskfire',
    'Brother Kell',
    'Nyra Soothand',
    'Garrow Emberlight',
    'Vey the Hollow',
    'Ansel Ruehart',
  ],
  leaderboardSize: 20,
} as const;
