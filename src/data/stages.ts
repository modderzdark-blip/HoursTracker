/**
 * Stage content (what a battle contains) and the Adventure chapters built from it. A battle is a
 * StageDef plus runtime choices (hero, difficulty) made by the mode that starts it.
 */
import type { AffixId } from './affixes';
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
  /** Elite affixes on every wave enemy (and summoned add). */
  readonly affixes?: readonly AffixId[];
  /** Elite affixes on the boss. */
  readonly bossAffixes?: readonly AffixId[];
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
          ['gloom_bat', 4],
          ['thrall', 2],
        ],
      ],
    },
    {
      name: 'Ember Steps',
      arena: 'cinder_court',
      waves: [
        [['gloom_bat', 5]],
        [
          ['revenant', 2],
          ['ember_wisp', 2],
        ],
        [
          ['thrall', 4],
          ['gloom_bat', 3],
        ],
      ],
    },
    {
      name: 'Gate of Soot',
      arena: 'ash_gate',
      waves: [
        [
          ['ember_wisp', 3],
          ['thrall', 3],
        ],
        [
          ['revenant', 3],
          ['gloom_bat', 4],
        ],
        [
          ['ember_wisp', 4],
          ['revenant', 2],
        ],
      ],
    },
    {
      name: "The Gaoler's Yard",
      arena: 'ash_gate',
      kind: 'miniboss',
      boss: 'gaoler',
      waves: [
        [
          ['revenant', 2],
          ['gloom_bat', 4],
        ],
        [
          ['ember_wisp', 3],
          ['thrall', 3],
        ],
      ],
      parTimeSec: 240,
    },
    {
      name: 'Smoke Cloister',
      arena: 'cinder_court',
      waves: [
        [
          ['gloom_bat', 6],
          ['ember_wisp', 2],
        ],
        [
          ['revenant', 3],
          ['imp', 4],
        ],
        [
          ['ember_wisp', 3],
          ['revenant', 2],
          ['gloom_bat', 3],
        ],
      ],
    },
    {
      name: 'The Charred Nave',
      arena: 'ash_gate',
      waves: [
        [['revenant', 4]],
        [
          ['ember_wisp', 4],
          ['gloom_bat', 4],
        ],
        [
          ['brute', 1],
          ['revenant', 2],
          ['ember_wisp', 2],
        ],
      ],
    },
    {
      name: 'Kiln Approach',
      arena: 'cinder_court',
      waves: [
        [['gloom_bat', 8]],
        [
          ['revenant', 3],
          ['ember_wisp', 3],
        ],
        [
          ['brute', 1],
          ['gloom_bat', 5],
          ['revenant', 2],
        ],
      ],
    },
    {
      name: 'Throne of the Warden',
      arena: 'cinder_court',
      boss: 'hollow_warden',
      waves: [
        [
          ['revenant', 3],
          ['ember_wisp', 2],
        ],
        [
          ['gloom_bat', 6],
          ['thrall', 3],
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
          ['hexcaller', 1],
          ['revenant', 3],
        ],
        [
          ['ember_wisp', 4],
          ['gloom_bat', 4],
        ],
        [
          ['hex_wisp', 1],
          ['revenant', 3],
        ],
      ],
    },
    {
      name: 'The Seers’ Ridge',
      arena: 'ashen_wastes',
      waves: [
        [
          ['wretch', 3],
          ['gloom_bat', 5],
        ],
        [
          ['hexcaller', 2],
          ['revenant', 2],
        ],
        [
          ['hex_wisp', 1],
          ['ember_wisp', 4],
        ],
      ],
    },
    {
      name: 'Wretch Hollow',
      arena: 'ash_gate',
      waves: [
        [
          ['revenant', 4],
          ['ember_wisp', 3],
        ],
        [
          ['hex_wisp', 2],
          ['gloom_bat', 4],
        ],
        [
          ['brute', 1],
          ['hexcaller', 2],
          ['revenant', 2],
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
          ['ember_wisp', 4],
          ['revenant', 2],
        ],
        [
          ['hex_wisp', 1],
          ['gloom_bat', 5],
        ],
      ],
      parTimeSec: 260,
    },
    {
      name: 'Glass Dunes',
      arena: 'ashen_wastes',
      waves: [
        [
          ['gloom_bat', 8],
          ['ember_wisp', 2],
        ],
        [
          ['hexcaller', 2],
          ['wretch', 3],
        ],
        [
          ['revenant', 3],
          ['hex_wisp', 2],
        ],
      ],
    },
    {
      name: 'The Kiln Bridges',
      arena: 'cinder_court',
      waves: [
        [
          ['magma_golem', 1],
          ['ember_wisp', 3],
        ],
        [
          ['revenant', 4],
          ['gloom_bat', 4],
        ],
        [
          ['hexcaller', 2],
          ['hex_wisp', 1],
          ['revenant', 2],
        ],
      ],
    },
    {
      name: 'Ashstorm Plateau',
      arena: 'ashen_wastes',
      waves: [
        [
          ['hex_wisp', 2],
          ['ember_wisp', 4],
        ],
        [
          ['magma_golem', 1],
          ['revenant', 3],
        ],
        [
          ['gloom_bat', 8],
          ['hexcaller', 2],
        ],
      ],
    },
    {
      name: 'Nest of the Mother',
      arena: 'ashen_wastes',
      boss: 'mother_of_ash',
      waves: [
        [
          ['revenant', 3],
          ['ember_wisp', 3],
        ],
        [
          ['hex_wisp', 2],
          ['gloom_bat', 4],
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
          ['revenant', 3],
        ],
        [
          ['hexcaller', 2],
          ['ember_wisp', 4],
        ],
        [
          ['magma_golem', 1],
          ['gloom_bat', 5],
        ],
      ],
    },
    {
      name: 'Hall of Chains',
      arena: 'ash_gate',
      waves: [
        [
          ['hex_wisp', 2],
          ['revenant', 3],
        ],
        [
          ['bulwark', 2],
          ['ember_wisp', 4],
        ],
        [
          ['magma_golem', 1],
          ['hexcaller', 2],
          ['gloom_bat', 3],
        ],
      ],
    },
    {
      name: 'The Weeping Stair',
      arena: 'bound_spire',
      waves: [
        [['gloom_bat', 10]],
        [
          ['revenant', 4],
          ['hex_wisp', 2],
        ],
        [
          ['magma_golem', 2],
          ['ember_wisp', 3],
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
          ['hexcaller', 2],
        ],
        [
          ['revenant', 3],
          ['gloom_bat', 5],
        ],
      ],
      parTimeSec: 280,
    },
    {
      name: 'Gallery of Ash',
      arena: 'cinder_court',
      waves: [
        [
          ['ember_wisp', 6],
          ['revenant', 2],
        ],
        [
          ['magma_golem', 1],
          ['bulwark', 2],
          ['hex_wisp', 1],
        ],
        [
          ['gloom_bat', 6],
          ['hexcaller', 2],
          ['revenant', 2],
        ],
      ],
    },
    {
      name: 'The Bleeding Vault',
      arena: 'bound_spire',
      waves: [
        [
          ['magma_golem', 2],
          ['gloom_bat', 4],
        ],
        [
          ['hex_wisp', 3],
          ['revenant', 3],
        ],
        [
          ['bulwark', 2],
          ['ember_wisp', 5],
        ],
      ],
    },
    {
      name: 'Throne Approach',
      arena: 'bound_spire',
      waves: [
        [
          ['revenant', 5],
          ['hexcaller', 2],
        ],
        [
          ['magma_golem', 2],
          ['hex_wisp', 2],
        ],
        [
          ['gloom_bat', 8],
          ['revenant', 3],
          ['ember_wisp', 3],
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
          ['hex_wisp', 2],
        ],
        [
          ['magma_golem', 1],
          ['revenant', 3],
          ['gloom_bat', 4],
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
          ['gloom_bat', 4],
        ],
        [
          ['broodling', 5],
          ['ember_wisp', 3],
        ],
        [
          ['magma_golem', 1],
          ['ash_hound', 3],
        ],
      ],
    },
    {
      name: 'Webbed Galleries',
      arena: 'hollow_deep',
      waves: [
        [
          ['broodling', 6],
          ['hex_wisp', 1],
        ],
        [
          ['revenant', 3],
          ['broodling', 4],
        ],
        [
          ['hexcaller', 2],
          ['ash_hound', 3],
        ],
      ],
    },
    {
      name: 'The Kennels of Ash',
      arena: 'ashen_wastes',
      waves: [
        [
          ['ash_hound', 5],
          ['ember_wisp', 3],
        ],
        [
          ['magma_golem', 1],
          ['ash_hound', 3],
        ],
        [
          ['hex_wisp', 2],
          ['gloom_bat', 6],
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
          ['revenant', 2],
        ],
        [
          ['ember_wisp', 4],
          ['gloom_bat', 4],
        ],
      ],
      parTimeSec: 300,
    },
    {
      name: 'The Silk Chasm',
      arena: 'hollow_deep',
      waves: [
        [
          ['broodling', 6],
          ['hexcaller', 2],
        ],
        [
          ['magma_golem', 1],
          ['hex_wisp', 2],
        ],
        [
          ['broodling', 6],
          ['revenant', 3],
        ],
      ],
    },
    {
      name: 'Heart of the Brood',
      arena: 'hollow_deep',
      kind: 'miniboss',
      boss: 'brood_weaver',
      waves: [
        [
          ['broodling', 6],
          ['gloom_bat', 4],
        ],
        [
          ['broodling', 4],
          ['hex_wisp', 2],
        ],
      ],
      parTimeSec: 300,
    },
    {
      name: 'Molten Burrows',
      arena: 'hollow_deep',
      waves: [
        [
          ['ash_hound', 4],
          ['broodling', 4],
        ],
        [
          ['magma_golem', 2],
          ['hexcaller', 2],
        ],
        [
          ['revenant', 4],
          ['hex_wisp', 2],
          ['ash_hound', 3],
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
          ['broodling', 4],
          ['ember_wisp', 3],
        ],
        [
          ['magma_golem', 1],
          ['hex_wisp', 2],
          ['revenant', 2],
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
