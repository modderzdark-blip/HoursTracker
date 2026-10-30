/**
 * Enchant runes: an item gains one at enchant +3, +6 and +9. Each rune is a combat effect (the
 * same kinds as relic signatures) and grows with the milestone it was earned at. Which rune an
 * item gets is rolled from its slot's pool, never the same rune twice on one item.
 */
import type { GearSlot } from './items';
import type { RelicEffectKind } from './relics';

export type RuneId =
  | 'fury'
  | 'precision'
  | 'bloodthirst'
  | 'arcana'
  | 'riposte'
  | 'swiftness'
  | 'haste'
  | 'tempest'
  | 'cataclysm';

export interface RuneDef {
  readonly id: RuneId;
  readonly name: string;
  readonly kind: RelicEffectKind;
  /** Value at the +3, +6 and +9 milestones. */
  readonly values: readonly [number, number, number];
  /** Shown to the player, `{v}` replaced by the value as a percentage. */
  readonly text: string;
  readonly color: string;
}

export const RUNES: Readonly<Record<RuneId, RuneDef>> = {
  fury: {
    id: 'fury',
    name: 'Rune of Fury',
    kind: 'comboDamage',
    values: [0.05, 0.08, 0.12],
    text: 'Combo damage +{v}',
    color: '#ff6a3a',
  },
  precision: {
    id: 'precision',
    name: 'Rune of Precision',
    kind: 'critChance',
    values: [0.02, 0.035, 0.05],
    text: 'Crit rate +{v}',
    color: '#ffd27a',
  },
  bloodthirst: {
    id: 'bloodthirst',
    name: 'Rune of Bloodthirst',
    kind: 'lifesteal',
    values: [0.015, 0.025, 0.04],
    text: 'Heal {v} of damage dealt',
    color: '#ff4a5a',
  },
  arcana: {
    id: 'arcana',
    name: 'Rune of Arcana',
    kind: 'skillDamage',
    values: [0.06, 0.1, 0.15],
    text: 'Ability damage +{v}',
    color: '#c48aff',
  },
  riposte: {
    id: 'riposte',
    name: 'Rune of Riposte',
    kind: 'counterBonus',
    values: [0.1, 0.18, 0.28],
    text: 'Perfect-dodge counters +{v}',
    color: '#9ad8ff',
  },
  swiftness: {
    id: 'swiftness',
    name: 'Rune of Swiftness',
    kind: 'dodgeCooldown',
    values: [0.05, 0.08, 0.12],
    text: 'Dodge cooldown −{v}',
    color: '#8cf0b0',
  },
  haste: {
    id: 'haste',
    name: 'Rune of Haste',
    kind: 'skillCooldown',
    values: [0.04, 0.06, 0.09],
    text: 'Ability cooldowns −{v}',
    color: '#6af0ff',
  },
  tempest: {
    id: 'tempest',
    name: 'Rune of the Tempest',
    kind: 'ultGain',
    values: [0.06, 0.1, 0.15],
    text: 'Ultimate charges {v} faster',
    color: '#5aa8ff',
  },
  cataclysm: {
    id: 'cataclysm',
    name: 'Rune of Cataclysm',
    kind: 'ultDamage',
    values: [0.08, 0.13, 0.2],
    text: 'Ultimate damage +{v}',
    color: '#ffa040',
  },
};

/** Runes each slot can roll. */
export const RUNE_POOLS: Readonly<Record<GearSlot, readonly RuneId[]>> = {
  weapon: ['fury', 'precision', 'bloodthirst', 'arcana'],
  gloves: ['fury', 'precision', 'arcana', 'riposte'],
  armor: ['swiftness', 'haste', 'bloodthirst', 'riposte'],
  helmet: ['swiftness', 'haste', 'arcana', 'tempest'],
  ring: ['tempest', 'cataclysm', 'precision', 'arcana'],
  amulet: ['tempest', 'cataclysm', 'bloodthirst', 'haste'],
};

/** Enchant levels that grant a rune. */
export const RUNE_MILESTONES = [3, 6, 9] as const;

/** Visual tier of an enchant level (0 = none, 4 = radiant at the cap). */
export function enchantTier(ench: number): 0 | 1 | 2 | 3 | 4 {
  if (ench <= 0) return 0;
  if (ench >= 10) return 4;
  return ench <= 3 ? 1 : ench <= 6 ? 2 : 3;
}
