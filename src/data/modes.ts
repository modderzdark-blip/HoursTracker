import type { ArenaId } from './arenas';
import type { BossId } from './bosses';
import type { EnemyId } from './enemies';

/**
 * Game-mode unlock rules and labels. Each mode's own tunables live with the mode (dungeon,
 * tower, challenge, arena sections below are filled in as the modes are added).
 */
export type ModeId = 'adventure' | 'dungeon' | 'tower' | 'challenge' | 'arena';

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
          ['thrall', 4],
          ['imp', 3],
        ],
        [
          ['brute', 1],
          ['thrall', 3],
        ],
      ],
    },
    {
      arena: 'cinder_court',
      name: 'Ember Vault',
      waves: [
        [
          ['seer', 2],
          ['bulwark', 1],
        ],
        [
          ['wretch', 3],
          ['imp', 2],
        ],
      ],
    },
    {
      arena: 'ashen_wastes',
      name: 'Burning Pit',
      waves: [
        [['wretch', 4]],
        [
          ['brute', 2],
          ['seer', 1],
        ],
      ],
    },
    {
      arena: 'bound_spire',
      name: 'Chained Hall',
      waves: [
        [
          ['bulwark', 2],
          ['seer', 2],
        ],
        [
          ['thrall', 5],
          ['brute', 1],
        ],
      ],
    },
    {
      arena: 'ash_gate',
      name: 'Imp Warren',
      waves: [
        [['imp', 6]],
        [
          ['imp', 4],
          ['wretch', 2],
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
          ['seer', 2],
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
  ] satisfies readonly BossId[],
  arenas: ['cinder_court', 'ash_gate', 'ashen_wastes', 'bound_spire'] satisfies readonly ArenaId[],
  /** Enemy types allowed from these floors on. */
  enemyUnlocks: [
    { enemy: 'thrall', floor: 1 },
    { enemy: 'imp', floor: 1 },
    { enemy: 'brute', floor: 3 },
    { enemy: 'seer', floor: 5 },
    { enemy: 'bulwark', floor: 7 },
    { enemy: 'wretch', floor: 9 },
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
  ] satisfies readonly { boss: BossId; stage: string; arena: ArenaId }[],
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
