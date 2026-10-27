/**
 * Relics: ancient artifacts carried in two relic slots (account-wide). Each lends a stat bonus
 * and one signature effect that changes how a fight plays (ultimate power, life drain, cooldowns,
 * counters). Found in Reliquary caskets (Shop); a duplicate raises the relic's level. Names are
 * original.
 */
import type { Rarity } from './items';
import type { PetStat } from './pets';

export type RelicId =
  | 'pyre_heart'
  | 'ossuary_chalice'
  | 'first_fire'
  | 'widows_hourglass'
  | 'warden_eye'
  | 'chained_crown'
  | 'ashen_censer'
  | 'bloodsworn_blade'
  | 'gaolers_key'
  | 'void_lantern';

/** Effects folded into the hero's modifiers (same rules as the skill trees). */
export type RelicEffectKind =
  | 'ultDamage'
  | 'ultGain'
  | 'lifesteal'
  | 'critChance'
  | 'comboDamage'
  | 'skillDamage'
  | 'skillCooldown'
  | 'dodgeCooldown'
  | 'counterBonus';

export interface RelicDef {
  readonly id: RelicId;
  readonly name: string;
  readonly rarity: Rarity;
  readonly lore: string;
  readonly bonus: readonly {
    readonly stat: PetStat;
    readonly base: number;
    readonly perLevel: number;
  }[];
  readonly effect: {
    readonly kind: RelicEffectKind;
    readonly base: number;
    readonly perLevel: number;
    /** Shown to the player, `{v}` replaced by the value (as a percentage). */
    readonly text: string;
  };
  /** Glow colour of the relic. */
  readonly color: string;
}

export const RELICS: Readonly<Record<RelicId, RelicDef>> = {
  pyre_heart: {
    id: 'pyre_heart',
    name: 'Heart of the Pyre',
    rarity: 'legendary',
    lore: 'Still beating, still burning. It wants to be spent.',
    bonus: [{ stat: 'atkPct', base: 0.06, perLevel: 0.012 }],
    effect: { kind: 'ultDamage', base: 0.25, perLevel: 0.05, text: 'Ultimate damage +{v}' },
    color: '#ff7a2a',
  },
  ossuary_chalice: {
    id: 'ossuary_chalice',
    name: 'Ossuary Chalice',
    rarity: 'epic',
    lore: 'Drink from it and the wounds you deal close your own.',
    bonus: [{ stat: 'hpPct', base: 0.06, perLevel: 0.012 }],
    effect: { kind: 'lifesteal', base: 0.03, perLevel: 0.006, text: 'Heal {v} of damage dealt' },
    color: '#d94a5a',
  },
  first_fire: {
    id: 'first_fire',
    name: 'Shard of the First Fire',
    rarity: 'mythic',
    lore: 'A splinter of the flame that lit the world, and will end it.',
    bonus: [
      { stat: 'atkPct', base: 0.08, perLevel: 0.015 },
      { stat: 'critDamage', base: 0.1, perLevel: 0.02 },
    ],
    effect: { kind: 'ultGain', base: 0.2, perLevel: 0.04, text: 'Ultimate charges {v} faster' },
    color: '#ffd27a',
  },
  widows_hourglass: {
    id: 'widows_hourglass',
    name: 'Widow’s Hourglass',
    rarity: 'legendary',
    lore: 'The sand runs upward when she is angry.',
    bonus: [{ stat: 'attackSpeed', base: 0.04, perLevel: 0.008 }],
    effect: { kind: 'skillCooldown', base: 0.1, perLevel: 0.02, text: 'Skill cooldowns −{v}' },
    color: '#c48aff',
  },
  warden_eye: {
    id: 'warden_eye',
    name: 'Eye of the Warden',
    rarity: 'epic',
    lore: 'It saw every escape. Now it sees every opening.',
    bonus: [{ stat: 'critChance', base: 0.03, perLevel: 0.006 }],
    effect: {
      kind: 'counterBonus',
      base: 0.3,
      perLevel: 0.06,
      text: 'Perfect-dodge counters +{v} damage',
    },
    color: '#9ad8ff',
  },
  chained_crown: {
    id: 'chained_crown',
    name: 'The Chained Crown',
    rarity: 'legendary',
    lore: 'Whoever wears it rules, and whoever rules is bound.',
    bonus: [{ stat: 'defPct', base: 0.08, perLevel: 0.015 }],
    effect: { kind: 'skillDamage', base: 0.15, perLevel: 0.03, text: 'Skill damage +{v}' },
    color: '#e8be6e',
  },
  ashen_censer: {
    id: 'ashen_censer',
    name: 'Ashen Censer',
    rarity: 'epic',
    lore: 'Its smoke hides you a heartbeat longer than it should.',
    bonus: [{ stat: 'hpPct', base: 0.04, perLevel: 0.01 }],
    effect: { kind: 'dodgeCooldown', base: 0.12, perLevel: 0.02, text: 'Dodge cooldown −{v}' },
    color: '#b8aea0',
  },
  bloodsworn_blade: {
    id: 'bloodsworn_blade',
    name: 'Bloodsworn Blade',
    rarity: 'legendary',
    lore: 'A sword with no hilt. You hold it by the oath.',
    bonus: [{ stat: 'atkPct', base: 0.05, perLevel: 0.01 }],
    effect: { kind: 'comboDamage', base: 0.15, perLevel: 0.03, text: 'Combo damage +{v}' },
    color: '#ff4a5a',
  },
  gaolers_key: {
    id: 'gaolers_key',
    name: 'The Gaoler’s Key',
    rarity: 'epic',
    lore: 'It opens any lock, and every weak point.',
    bonus: [{ stat: 'critDamage', base: 0.08, perLevel: 0.016 }],
    effect: { kind: 'critChance', base: 0.02, perLevel: 0.004, text: 'Crit rate +{v}' },
    color: '#c9a24a',
  },
  void_lantern: {
    id: 'void_lantern',
    name: 'Void Lantern',
    rarity: 'mythic',
    lore: 'Light from the bottom of the Hollow Deep. Things follow it home.',
    bonus: [
      { stat: 'hpPct', base: 0.08, perLevel: 0.015 },
      { stat: 'defPct', base: 0.06, perLevel: 0.012 },
    ],
    effect: { kind: 'ultDamage', base: 0.35, perLevel: 0.06, text: 'Ultimate damage +{v}' },
    color: '#6af0ff',
  },
};

export const RELIC_IDS = Object.keys(RELICS) as RelicId[];

export const RELIC_CONFIG = {
  maxLevel: 5,
  slots: 2,
  /** A duplicate of a maxed relic turns into this many souls. */
  maxedDuplicateSouls: 60,
} as const;

/** Reliquary caskets: rarity weights. */
export const CASKETS = {
  reliquary: { name: 'Reliquary Casket', weights: { epic: 75, legendary: 22, mythic: 3 } },
  sealed: { name: 'Sealed Reliquary', weights: { epic: 0, legendary: 85, mythic: 15 } },
} as const;

export type CasketId = keyof typeof CASKETS;
