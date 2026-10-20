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
    ...skillBranch('kael', 0, 'Rending Dash', 0, {
      name: 'Deep Rend',
      description: 'Rending Dash also burns enemies.',
      effect: { kind: 'skillStatus', skill: 0, status: 'burn', chance: 1 },
    }),
    ...skillBranch('kael', 1, 'Blade Gyre', 1, {
      name: 'Crippling Gyre',
      description: 'Blade Gyre slows enemies it hits.',
      effect: { kind: 'skillStatus', skill: 1, status: 'slow', chance: 0.6 },
    }),
    ...skillBranch('kael', 2, 'Umbral Step', 2, {
      name: 'Unstoppable Shade',
      description: 'Umbral Step gains super armor.',
      effect: { kind: 'skillSuperArmor', skill: 2 },
    }),
    ...coreBranch('kael', 'Hollow Legion'),
  ],
  brann: [
    ...skillBranch('brann', 0, 'Earthsplitter', 0, {
      name: 'Molten Fissure',
      description: 'Earthsplitter sets enemies ablaze.',
      effect: { kind: 'skillStatus', skill: 0, status: 'burn', chance: 1 },
    }),
    ...skillBranch('brann', 1, 'Oathbreaker', 1, {
      name: 'Sundering Oath',
      description: 'Oathbreaker opens bleeding wounds.',
      effect: { kind: 'skillStatus', skill: 1, status: 'bleed', chance: 1 },
    }),
    ...skillBranch('brann', 2, 'Bulwark Rush', 2, {
      name: 'Crippling Rush',
      description: 'Bulwark Rush slows enemies it hits.',
      effect: { kind: 'skillStatus', skill: 2, status: 'slow', chance: 1 },
    }),
    ...coreBranch('brann', 'Meteor Cleave'),
  ],
  lyra: [
    ...skillBranch('lyra', 0, 'Piercing Gloam', 0, {
      name: 'Searing Gloam',
      description: 'Piercing Gloam burns everything it passes through.',
      effect: { kind: 'skillStatus', skill: 0, status: 'burn', chance: 1 },
    }),
    ...skillBranch('lyra', 1, 'Ashfall Volley', 1, {
      name: 'Barbed Volley',
      description: 'Ashfall Volley arrows cause bleeding.',
      effect: { kind: 'skillStatus', skill: 1, status: 'bleed', chance: 0.5 },
    }),
    ...skillBranch('lyra', 2, 'Snare Leap', 2, {
      name: 'Steadfast Leap',
      description: 'Snare Leap gains super armor.',
      effect: { kind: 'skillSuperArmor', skill: 2 },
    }),
    ...coreBranch('lyra', 'Gloamstorm'),
  ],
  garrick: [
    ...skillBranch('garrick', 0, 'Rampart Charge', 0, {
      name: 'Crushing Rampart',
      description: 'Rampart Charge opens bleeding wounds.',
      effect: { kind: 'skillStatus', skill: 0, status: 'bleed', chance: 1 },
    }),
    ...skillBranch('garrick', 1, 'Challenge Roar', 1, {
      name: 'Scorching Challenge',
      description: 'Challenge Roar sets the dragged enemies ablaze.',
      effect: { kind: 'skillStatus', skill: 1, status: 'burn', chance: 1 },
    }),
    ...skillBranch('garrick', 2, 'Iron Vigil', 2, {
      name: 'Spiked Vigil',
      description: 'Iron Vigil pulses make enemies bleed.',
      effect: { kind: 'skillStatus', skill: 2, status: 'bleed', chance: 0.6 },
    }),
    ...coreBranch('garrick', 'Bastion Fall'),
  ],
  seraphine: [
    ...skillBranch('seraphine', 0, 'Cinder Wave', 0, {
      name: 'Choking Cinders',
      description: 'Cinder Wave also slows the enemies it scorches.',
      effect: { kind: 'skillStatus', skill: 0, status: 'slow', chance: 1 },
    }),
    ...skillBranch('seraphine', 1, 'Frost Nova', 1, {
      name: 'Unbroken Focus',
      description: 'Frost Nova gains super armor.',
      effect: { kind: 'skillSuperArmor', skill: 1 },
    }),
    ...skillBranch('seraphine', 2, 'Starfall Brand', 2, {
      name: 'Shattering Star',
      description: 'Starfall Brand shards cause bleeding.',
      effect: { kind: 'skillStatus', skill: 2, status: 'bleed', chance: 1 },
    }),
    ...coreBranch('seraphine', 'Pyre of Heaven'),
  ],
  ryn: [
    ...skillBranch('ryn', 0, 'Comet Kick', 0, {
      name: 'Burning Comet',
      description: 'Comet Kick sets enemies ablaze.',
      effect: { kind: 'skillStatus', skill: 0, status: 'burn', chance: 1 },
    }),
    ...skillBranch('ryn', 1, 'Cyclone Heel', 1, {
      name: 'Rending Heel',
      description: 'Cyclone Heel kicks cause bleeding.',
      effect: { kind: 'skillStatus', skill: 1, status: 'bleed', chance: 0.6 },
    }),
    ...skillBranch('ryn', 2, 'Skybreaker Palm', 2, {
      name: 'Rooted Palm',
      description: 'Skybreaker Palm gains super armor.',
      effect: { kind: 'skillSuperArmor', skill: 2 },
    }),
    ...coreBranch('ryn', 'Hundred Ash Fists'),
  ],
  valka: [
    ...skillBranch('valka', 0, 'Thunderdive', 0, {
      name: 'Searing Dive',
      description: 'Thunderdive scorches the ground it lands on.',
      effect: { kind: 'skillStatus', skill: 0, status: 'burn', chance: 1 },
    }),
    ...skillBranch('valka', 1, 'Piercing Gale', 1, {
      name: 'Gale Wall',
      description: 'Piercing Gale gains super armor.',
      effect: { kind: 'skillSuperArmor', skill: 1 },
    }),
    ...skillBranch('valka', 2, 'Tempest Wheel', 2, {
      name: 'Barbed Wheel',
      description: 'Tempest Wheel cuts cause bleeding.',
      effect: { kind: 'skillStatus', skill: 2, status: 'bleed', chance: 0.6 },
    }),
    ...coreBranch('valka', 'Skyfall Lances'),
  ],
  morrow: [
    ...skillBranch('morrow', 0, 'Grave Tithe', 0, {
      name: 'Binding Tithe',
      description: 'Grave Tithe slows everything standing in it.',
      effect: { kind: 'skillStatus', skill: 0, status: 'slow', chance: 1 },
    }),
    ...skillBranch('morrow', 1, 'Hex Rupture', 1, {
      name: 'Pyre Hex',
      description: 'Hex Rupture also sets enemies ablaze.',
      effect: { kind: 'skillStatus', skill: 1, status: 'burn', chance: 1 },
    }),
    ...skillBranch('morrow', 2, 'Wraith Orbs', 2, {
      name: 'Chilling Wraiths',
      description: 'Wraith Orbs slow the enemies they find.',
      effect: { kind: 'skillStatus', skill: 2, status: 'slow', chance: 1 },
    }),
    ...coreBranch('morrow', 'Ossuary Bloom'),
  ],
};
