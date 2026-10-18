import type { BossId } from './bosses';
import type { DifficultyId } from './difficulty';
import type { EnemyId } from './enemies';

export interface WaveDef {
  readonly spawns: readonly { readonly enemy: EnemyId; readonly count: number }[];
  /** Delay between individual spawns. */
  readonly spawnIntervalMs: number;
}

export interface StarRules {
  /** 2nd star: cleared without reviving and took at most this many × max HP in total damage. */
  readonly maxDamageTakenFrac: number;
  /** 3rd star: cleared within this time. */
  readonly parTimeSec: number;
}

export interface StageDef {
  readonly id: string;
  readonly name: string;
  readonly difficulty: DifficultyId;
  /** Training dummy available before the first wave. */
  readonly trainingDummy: boolean;
  /** Countdown before wave 1 (time to practise on the dummy). */
  readonly introCountdownMs: number;
  readonly waves: readonly WaveDef[];
  readonly boss: BossId | null;
  readonly stars: StarRules;
  /** Pause between a cleared wave and the next. */
  readonly interWaveMs: number;
  readonly rewards: { readonly gold: number; readonly gems: number };
}

export const STAGES = {
  proto_cinder_court: {
    id: 'proto_cinder_court',
    name: 'The Cinder Court',
    difficulty: 'normal',
    trainingDummy: true,
    introCountdownMs: 12_000,
    waves: [
      { spawns: [{ enemy: 'thrall', count: 3 }], spawnIntervalMs: 500 },
      {
        spawns: [
          { enemy: 'imp', count: 5 },
          { enemy: 'thrall', count: 1 },
        ],
        spawnIntervalMs: 350,
      },
      {
        spawns: [
          { enemy: 'brute', count: 1 },
          { enemy: 'thrall', count: 2 },
          { enemy: 'imp', count: 2 },
        ],
        spawnIntervalMs: 500,
      },
    ],
    boss: 'hollow_warden',
    stars: { maxDamageTakenFrac: 1.5, parTimeSec: 420 },
    interWaveMs: 2500,
    rewards: { gold: 300, gems: 5 },
  },
} as const satisfies Record<string, StageDef>;

export type StageId = keyof typeof STAGES;
export const DEFAULT_STAGE: StageId = 'proto_cinder_court';
