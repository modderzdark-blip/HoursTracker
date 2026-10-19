/**
 * Stage content (what a battle contains) and the Adventure chapters built from it. A battle is a
 * StageDef plus runtime choices (hero, difficulty) made by the mode that starts it.
 */
import type { ArenaId } from './arenas';
import type { BossId } from './bosses';
import type { EnemyId } from './enemies';
import type { DropTableId } from './progression';

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
  readonly arena: ArenaId;
  /** Enemy level (stats scale with ENEMY_SCALING). */
  readonly level: number;
  /** Training dummy available before the first wave. */
  readonly trainingDummy: boolean;
  /** Countdown before wave 1 (practice time when there is a dummy). */
  readonly introCountdownMs: number;
  readonly waves: readonly WaveDef[];
  readonly boss: BossId | null;
  readonly stars: StarRules;
  /** Pause between a cleared wave and the next. */
  readonly interWaveMs: number;
}

export type StageKind = 'normal' | 'miniboss' | 'boss';

export interface AdventureStageDef extends StageDef {
  readonly chapter: number;
  /** 0-based index inside the chapter. */
  readonly index: number;
  readonly kind: StageKind;
  readonly drops: DropTableId;
  readonly rewards: { readonly gold: number; readonly xp: number };
}

export interface ChapterDef {
  readonly id: string;
  readonly number: number;
  readonly name: string;
  readonly subtitle: string;
  readonly stages: readonly AdventureStageDef[];
}

type SpawnList = readonly (readonly [EnemyId, number])[];

const wave = (spawns: SpawnList, spawnIntervalMs = 450): WaveDef => ({
  spawns: spawns.map(([enemy, count]) => ({ enemy, count })),
  spawnIntervalMs,
});

interface StageSpec {
  readonly name: string;
  readonly arena: ArenaId;
  readonly waves: readonly SpawnList[];
  readonly boss?: BossId;
  readonly kind?: StageKind;
  readonly practice?: boolean;
  readonly parTimeSec?: number;
}

/** Rewards and level grow along the chapter; balancing is the numbers in these helpers. */
function buildChapter(
  number: number,
  id: string,
  name: string,
  subtitle: string,
  firstLevel: number,
  specs: readonly StageSpec[],
): ChapterDef {
  const stages = specs.map((s, index): AdventureStageDef => {
    const level = firstLevel + index;
    const kind = s.kind ?? (s.boss !== undefined ? 'boss' : 'normal');
    const goldBase = 90 + level * 30;
    return {
      id: `c${number}s${index + 1}`,
      name: s.name,
      arena: s.arena,
      level,
      trainingDummy: s.practice === true,
      introCountdownMs: s.practice === true ? 10_000 : 2500,
      waves: s.waves.map((w) => wave(w)),
      boss: s.boss ?? null,
      stars: { maxDamageTakenFrac: 1.2, parTimeSec: s.parTimeSec ?? 150 + s.waves.length * 30 },
      interWaveMs: 2200,
      chapter: number,
      index,
      kind,
      drops: kind === 'boss' ? 'boss' : kind === 'miniboss' ? 'miniboss' : 'stage',
      rewards: {
        gold: Math.round(goldBase * (kind === 'boss' ? 2.5 : kind === 'miniboss' ? 1.6 : 1)),
        xp: Math.round((60 + level * 28) * (kind === 'boss' ? 2.2 : kind === 'miniboss' ? 1.5 : 1)),
      },
    };
  });
  return { id, number, name, subtitle, stages };
}

export const CHAPTERS: readonly ChapterDef[] = [
  buildChapter(1, 'ch1', 'Ashfall March', 'Where the shadow first fell', 1, [
    {
      name: 'The Cinder Court',
      arena: 'cinder_court',
      practice: true,
      waves: [
        [['thrall', 3]],
        [
          ['thrall', 2],
          ['imp', 3],
        ],
      ],
    },
    {
      name: 'Ember Steps',
      arena: 'cinder_court',
      waves: [
        [['imp', 4]],
        [
          ['thrall', 3],
          ['imp', 2],
        ],
        [['thrall', 4]],
      ],
    },
    {
      name: 'Gate of Soot',
      arena: 'ash_gate',
      waves: [
        [
          ['thrall', 3],
          ['imp', 3],
        ],
        [
          ['brute', 1],
          ['thrall', 2],
        ],
        [['imp', 6]],
      ],
    },
    {
      name: "The Gaoler's Yard",
      arena: 'ash_gate',
      kind: 'miniboss',
      boss: 'gaoler',
      waves: [
        [['thrall', 4]],
        [
          ['imp', 4],
          ['thrall', 2],
        ],
      ],
      parTimeSec: 240,
    },
    {
      name: 'Smoke Cloister',
      arena: 'cinder_court',
      waves: [
        [
          ['imp', 5],
          ['thrall', 2],
        ],
        [
          ['brute', 1],
          ['imp', 3],
        ],
        [['brute', 2]],
      ],
    },
    {
      name: 'The Charred Nave',
      arena: 'ash_gate',
      waves: [
        [['thrall', 5]],
        [
          ['brute', 1],
          ['thrall', 3],
          ['imp', 2],
        ],
        [['imp', 8]],
      ],
    },
    {
      name: 'Kiln Approach',
      arena: 'cinder_court',
      waves: [
        [
          ['brute', 2],
          ['imp', 2],
        ],
        [
          ['thrall', 4],
          ['imp', 4],
        ],
        [
          ['brute', 2],
          ['thrall', 3],
        ],
      ],
    },
    {
      name: 'Throne of the Warden',
      arena: 'cinder_court',
      boss: 'hollow_warden',
      waves: [
        [
          ['thrall', 3],
          ['imp', 3],
        ],
        [
          ['brute', 1],
          ['thrall', 2],
        ],
      ],
      parTimeSec: 330,
    },
  ]),
];

export function findAdventureStage(id: string): AdventureStageDef | undefined {
  for (const c of CHAPTERS) {
    const s = c.stages.find((st) => st.id === id);
    if (s !== undefined) return s;
  }
  return undefined;
}
