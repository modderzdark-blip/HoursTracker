/**
 * Hero skill trees. Each node has ranks, a per-rank cost in souls + gold, a prerequisite node
 * and a minimum hero level. Effects are a closed set of kinds the Player understands
 * (`src/progression/skillTree.ts` folds them into HeroMods).
 */
import type { HeroId } from './heroes';
import type { StatusId } from './statusEffects';

export type SkillEffect =
  /** +perRank to one skill's damage multiplier (0.1 = +10%). */
  | { readonly kind: 'skillDamage'; readonly skill: 0 | 1 | 2; readonly perRank: number }
  /** −perRank to one skill's cooldown (0.06 = −6%). */
  | { readonly kind: 'skillCooldown'; readonly skill: 0 | 1 | 2; readonly perRank: number }
  | { readonly kind: 'comboDamage'; readonly perRank: number }
  | { readonly kind: 'ultDamage'; readonly perRank: number }
  /** +perRank ultimate charge gained. */
  | { readonly kind: 'ultGain'; readonly perRank: number }
  /** −perRank dodge cooldown. */
  | { readonly kind: 'dodgeCooldown'; readonly perRank: number }
  /** +perRank to the perfect-dodge counter multiplier. */
  | { readonly kind: 'counterDamage'; readonly perRank: number }
  | { readonly kind: 'critChance'; readonly perRank: number }
  /** Heal this fraction of damage dealt. */
  | { readonly kind: 'lifesteal'; readonly perRank: number }
  /** Modifier: the skill's hits apply a status effect with this chance. */
  | {
      readonly kind: 'skillStatus';
      readonly skill: 0 | 1 | 2;
      readonly status: StatusId;
      readonly chance: number;
    }
  /** Modifier: the skill gains super armor. */
  | { readonly kind: 'skillSuperArmor'; readonly skill: 0 | 1 | 2 };

export interface SkillNodeDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly maxRank: number;
  readonly effect: SkillEffect;
  readonly costSouls: number;
  readonly costGold: number;
  /** Node that needs at least one rank first. */
  readonly requires: string | null;
  readonly minLevel: number;
  /** Grid position for the tree screen (column 0..4, row 0..3). */
  readonly col: number;
  readonly row: number;
}

const skillBranch = (
  prefix: string,
  skill: 0 | 1 | 2,
  skillName: string,
  col: number,
  modifier: { name: string; description: string; effect: SkillEffect },
): SkillNodeDef[] => [
  {
    id: `${prefix}_s${skill}_dmg`,
    name: `${skillName}: Power`,
    description: `+10% ${skillName} damage per rank.`,
    maxRank: 5,
    effect: { kind: 'skillDamage', skill, perRank: 0.1 },
    costSouls: 6,
    costGold: 150,
    requires: null,
    minLevel: 1,
    col,
    row: 0,
  },
  {
    id: `${prefix}_s${skill}_cd`,
    name: `${skillName}: Haste`,
    description: `−6% ${skillName} cooldown per rank.`,
    maxRank: 3,
    effect: { kind: 'skillCooldown', skill, perRank: 0.06 },
    costSouls: 10,
    costGold: 250,
    requires: `${prefix}_s${skill}_dmg`,
    minLevel: 5,
    col,
    row: 1,
  },
  {
    id: `${prefix}_s${skill}_mod`,
    name: modifier.name,
    description: modifier.description,
    maxRank: 1,
    effect: modifier.effect,
    costSouls: 40,
    costGold: 1200,
    requires: `${prefix}_s${skill}_cd`,
    minLevel: 12,
    col,
    row: 2,
  },
];

const coreBranch = (prefix: string, ultName: string): SkillNodeDef[] => [
  {
    id: `${prefix}_combo`,
    name: 'Honed Strikes',
    description: '+5% combo damage per rank.',
    maxRank: 5,
    effect: { kind: 'comboDamage', perRank: 0.05 },
    costSouls: 5,
    costGold: 120,
    requires: null,
    minLevel: 1,
    col: 3,
    row: 0,
  },
  {
    id: `${prefix}_ult`,
    name: `${ultName}: Fury`,
    description: `+10% ${ultName} damage per rank.`,
    maxRank: 5,
    effect: { kind: 'ultDamage', perRank: 0.1 },
    costSouls: 8,
    costGold: 200,
    requires: `${prefix}_combo`,
    minLevel: 3,
    col: 3,
    row: 1,
  },
  {
    id: `${prefix}_ultgain`,
    name: 'Hungering Shadow',
    description: '+10% ultimate charge per rank.',
    maxRank: 3,
    effect: { kind: 'ultGain', perRank: 0.1 },
    costSouls: 12,
    costGold: 300,
    requires: `${prefix}_ult`,
    minLevel: 8,
    col: 3,
    row: 2,
  },
  {
    id: `${prefix}_dodge`,
    name: 'Fleet Shade',
    description: '−10% dodge cooldown per rank.',
    maxRank: 3,
    effect: { kind: 'dodgeCooldown', perRank: 0.1 },
    costSouls: 10,
    costGold: 260,
    requires: `${prefix}_combo`,
    minLevel: 6,
    col: 4,
    row: 0,
  },
  {
    id: `${prefix}_counter`,
    name: 'Riposte',
    description: '+0.2 perfect-dodge counter multiplier per rank.',
    maxRank: 3,
    effect: { kind: 'counterDamage', perRank: 0.2 },
    costSouls: 10,
    costGold: 260,
    requires: `${prefix}_dodge`,
    minLevel: 10,
    col: 4,
    row: 1,
  },
  {
    id: `${prefix}_crit`,
    name: 'Killing Intent',
    description: '+2% crit rate per rank.',
    maxRank: 5,
    effect: { kind: 'critChance', perRank: 0.02 },
    costSouls: 9,
    costGold: 240,
    requires: `${prefix}_counter`,
    minLevel: 8,
    col: 4,
    row: 2,
  },
  {
    id: `${prefix}_leech`,
    name: 'Soul Leech',
    description: 'Heal 1% of damage dealt per rank.',
    maxRank: 3,
    effect: { kind: 'lifesteal', perRank: 0.01 },
    costSouls: 25,
    costGold: 800,
    requires: `${prefix}_ultgain`,
    minLevel: 15,
    col: 3,
    row: 3,
  },
];

export const SKILL_TREES: Readonly<Record<HeroId, readonly SkillNodeDef[]>> = {
  kael: [
    ...skillBranch('kael', 0, 'Phantom Rush', 0, {
      name: 'Deep Rend',
      description: 'Phantom Rush also burns enemies.',
      effect: { kind: 'skillStatus', skill: 0, status: 'burn', chance: 1 },
    }),
    ...skillBranch('kael', 1, 'Blade Tempest', 1, {
      name: 'Crippling Gyre',
      description: 'Blade Tempest slows enemies it hits.',
      effect: { kind: 'skillStatus', skill: 1, status: 'slow', chance: 0.6 },
    }),
    ...skillBranch('kael', 2, 'Umbral Execution', 2, {
      name: 'Unstoppable Shade',
      description: 'Umbral Execution gains super armor.',
      effect: { kind: 'skillSuperArmor', skill: 2 },
    }),
    ...coreBranch('kael', 'Night of a Thousand Blades'),
  ],
  brann: [
    ...skillBranch('brann', 0, 'Titan Fault', 0, {
      name: 'Molten Fissure',
      description: 'Titan Fault sets enemies ablaze.',
      effect: { kind: 'skillStatus', skill: 0, status: 'burn', chance: 1 },
    }),
    ...skillBranch('brann', 1, 'Oathbreaker', 1, {
      name: 'Sundering Oath',
      description: 'Oathbreaker opens bleeding wounds.',
      effect: { kind: 'skillStatus', skill: 1, status: 'bleed', chance: 1 },
    }),
    ...skillBranch('brann', 2, 'Juggernaut', 2, {
      name: 'Crippling Rush',
      description: 'Juggernaut slows enemies it hits.',
      effect: { kind: 'skillStatus', skill: 2, status: 'slow', chance: 1 },
    }),
    ...coreBranch('brann', 'Cataclysm'),
  ],
  lyra: [
    ...skillBranch('lyra', 0, 'Starpiercer', 0, {
      name: 'Searing Gloam',
      description: 'Starpiercer burns everything it passes through.',
      effect: { kind: 'skillStatus', skill: 0, status: 'burn', chance: 1 },
    }),
    ...skillBranch('lyra', 1, 'Starfall Volley', 1, {
      name: 'Barbed Volley',
      description: 'Starfall Volley arrows cause bleeding.',
      effect: { kind: 'skillStatus', skill: 1, status: 'bleed', chance: 0.5 },
    }),
    ...skillBranch('lyra', 2, 'Moonlit Snare', 2, {
      name: 'Steadfast Leap',
      description: 'Moonlit Snare gains super armor.',
      effect: { kind: 'skillSuperArmor', skill: 2 },
    }),
    ...coreBranch('lyra', 'Gloamstorm'),
  ],
};
