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
  /** Arena duel: no waves; the fight ends when the opposing hero falls. */
  readonly duel?: boolean;
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
    // Deeper chapters pay more XP so heroes keep pace with the steeper enemy levels.
    const xpMult = 1 + 0.15 * (number - 1);
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
        xp: Math.round(
          (100 + level * 45) * xpMult * (kind === 'boss' ? 2.2 : kind === 'miniboss' ? 1.5 : 1),
        ),
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
  buildChapter(2, 'ch2', 'The Smoldering Wastes', 'Fire falls like rain here', 9, [
    {
      name: 'Scorched Road',
      arena: 'ashen_wastes',
      waves: [
        [
          ['thrall', 4],
          ['seer', 1],
        ],
        [
          ['imp', 5],
          ['seer', 1],
        ],
        [
          ['bulwark', 1],
          ['thrall', 3],
        ],
      ],
    },
    {
      name: 'The Seers’ Ridge',
      arena: 'ashen_wastes',
      waves: [
        [['seer', 3]],
        [
          ['bulwark', 2],
          ['imp', 3],
        ],
        [
          ['seer', 2],
          ['thrall', 4],
        ],
      ],
    },
    {
      name: 'Wretch Hollow',
      arena: 'ash_gate',
      waves: [
        [
          ['wretch', 3],
          ['thrall', 2],
        ],
        [
          ['wretch', 2],
          ['seer', 2],
        ],
        [
          ['brute', 1],
          ['wretch', 3],
        ],
      ],
    },
    {
      name: 'Choir of Cinders',
      arena: 'ashen_wastes',
      kind: 'miniboss',
      boss: 'seer_exalted',
      waves: [
        [
          ['seer', 2],
          ['imp', 3],
        ],
        [
          ['bulwark', 2],
          ['seer', 1],
        ],
      ],
      parTimeSec: 260,
    },
    {
      name: 'Glass Dunes',
      arena: 'ashen_wastes',
      waves: [
        [
          ['bulwark', 2],
          ['seer', 2],
        ],
        [['wretch', 4]],
        [
          ['brute', 2],
          ['seer', 2],
        ],
      ],
    },
    {
      name: 'The Kiln Bridges',
      arena: 'cinder_court',
      waves: [
        [
          ['thrall', 5],
          ['wretch', 2],
        ],
        [['bulwark', 3]],
        [
          ['seer', 3],
          ['imp', 4],
        ],
      ],
    },
    {
      name: 'Ashstorm Plateau',
      arena: 'ashen_wastes',
      waves: [
        [
          ['brute', 2],
          ['wretch', 2],
        ],
        [
          ['bulwark', 2],
          ['seer', 3],
        ],
        [
          ['brute', 1],
          ['bulwark', 1],
          ['wretch', 3],
          ['seer', 1],
        ],
      ],
    },
    {
      name: 'Nest of the Mother',
      arena: 'ashen_wastes',
      boss: 'mother_of_ash',
      waves: [
        [
          ['imp', 4],
          ['seer', 2],
        ],
        [
          ['wretch', 3],
          ['bulwark', 1],
        ],
      ],
      parTimeSec: 380,
    },
  ]),
  buildChapter(3, 'ch3', 'The Bound Spire', 'The tower that holds the king', 17, [
    {
      name: 'Spire Foothold',
      arena: 'bound_spire',
      waves: [
        [
          ['bulwark', 2],
          ['thrall', 3],
        ],
        [
          ['seer', 2],
          ['imp', 4],
        ],
        [
          ['brute', 1],
          ['wretch', 2],
        ],
      ],
    },
    {
      name: 'Hall of Chains',
      arena: 'ash_gate',
      waves: [
        [['bulwark', 3]],
        [
          ['seer', 3],
          ['wretch', 2],
        ],
        [
          ['brute', 2],
          ['bulwark', 1],
        ],
      ],
    },
    {
      name: 'The Weeping Stair',
      arena: 'bound_spire',
      waves: [
        [
          ['wretch', 4],
          ['seer', 1],
        ],
        [
          ['imp', 6],
          ['bulwark', 1],
        ],
        [
          ['brute', 2],
          ['seer', 2],
        ],
      ],
    },
    {
      name: 'Penitents’ Gate',
      arena: 'bound_spire',
      kind: 'miniboss',
      boss: 'penitent',
      waves: [
        [
          ['bulwark', 2],
          ['seer', 2],
        ],
        [
          ['brute', 1],
          ['wretch', 3],
        ],
      ],
      parTimeSec: 280,
    },
    {
      name: 'Gallery of Ash',
      arena: 'cinder_court',
      waves: [
        [['seer', 4]],
        [
          ['bulwark', 3],
          ['wretch', 2],
        ],
        [
          ['brute', 2],
          ['imp', 4],
          ['seer', 1],
        ],
      ],
    },
    {
      name: 'The Bleeding Vault',
      arena: 'bound_spire',
      waves: [
        [
          ['brute', 2],
          ['bulwark', 2],
        ],
        [['wretch', 5]],
        [
          ['seer', 3],
          ['bulwark', 2],
        ],
      ],
    },
    {
      name: 'Throne Approach',
      arena: 'bound_spire',
      waves: [
        [
          ['bulwark', 2],
          ['seer', 2],
          ['wretch', 2],
        ],
        [['brute', 3]],
        [
          ['brute', 1],
          ['bulwark', 2],
          ['seer', 2],
          ['wretch', 2],
        ],
      ],
    },
    {
      name: 'The Bound Throne',
      arena: 'bound_spire',
      boss: 'bound_king',
      waves: [
        [
          ['bulwark', 2],
          ['seer', 2],
        ],
        [
          ['brute', 1],
          ['wretch', 3],
        ],
      ],
      parTimeSec: 420,
    },
  ]),
  buildChapter(4, 'ch4', 'The Hollow Deep', 'What sleeps beneath the ash', 25, [
    {
      name: 'Mouth of the Deep',
      arena: 'hollow_deep',
      waves: [
        [
          ['ash_hound', 3],
          ['thrall', 2],
        ],
        [
          ['broodling', 5],
          ['seer', 1],
        ],
        [
          ['brute', 1],
          ['ash_hound', 3],
        ],
      ],
    },
    {
      name: 'Webbed Galleries',
      arena: 'hollow_deep',
      waves: [
        [['broodling', 6]],
        [
          ['bulwark', 2],
          ['broodling', 4],
        ],
        [
          ['seer', 2],
          ['ash_hound', 3],
        ],
      ],
    },
    {
      name: 'The Kennels of Ash',
      arena: 'ashen_wastes',
      waves: [
        [['ash_hound', 5]],
        [
          ['brute', 2],
          ['ash_hound', 2],
        ],
        [
          ['wretch', 3],
          ['ash_hound', 4],
        ],
      ],
    },
    {
      name: 'Gorgrath’s Den',
      arena: 'hollow_deep',
      kind: 'miniboss',
      boss: 'ash_behemoth',
      waves: [
        [
          ['ash_hound', 3],
          ['bulwark', 1],
        ],
        [
          ['ash_hound', 2],
          ['seer', 2],
        ],
      ],
      parTimeSec: 300,
    },
    {
      name: 'The Silk Chasm',
      arena: 'hollow_deep',
      waves: [
        [
          ['broodling', 5],
          ['wretch', 2],
        ],
        [
          ['bulwark', 2],
          ['seer', 2],
        ],
        [
          ['broodling', 6],
          ['brute', 1],
        ],
      ],
    },
    {
      name: 'Heart of the Brood',
      arena: 'hollow_deep',
      kind: 'miniboss',
      boss: 'brood_weaver',
      waves: [
        [['broodling', 6]],
        [
          ['broodling', 3],
          ['seer', 2],
        ],
      ],
      parTimeSec: 300,
    },
    {
      name: 'Molten Burrows',
      arena: 'hollow_deep',
      waves: [
        [
          ['ash_hound', 3],
          ['broodling', 3],
        ],
        [
          ['brute', 2],
          ['seer', 2],
        ],
        [
          ['bulwark', 2],
          ['ash_hound', 3],
          ['wretch', 2],
        ],
      ],
    },
    {
      name: 'The Wyrm’s Coil',
      arena: 'hollow_deep',
      boss: 'cinder_wyrm',
      waves: [
        [
          ['ash_hound', 3],
          ['broodling', 3],
        ],
        [
          ['brute', 1],
          ['bulwark', 1],
          ['seer', 2],
        ],
      ],
      parTimeSec: 440,
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
