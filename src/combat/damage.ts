/**
 * Damage formula (also documented in README → Combat):
 *
 *   damage = ATK × skillMultiplier × critMultiplier × defenseFactor × difficultyModifier × bonus
 *   defenseFactor = 100 / (100 + DEF)
 *   critMultiplier = critDamage on a critical hit (chance = critChance), otherwise 1
 *   bonus = situational multipliers (perfect-dodge counter, boss break window), default 1
 *
 * The result is rounded to the nearest integer and is at least 1.
 */

export interface DamageInput {
  readonly atk: number;
  readonly def: number;
  readonly skillMult: number;
  readonly critChance: number;
  readonly critDamage: number;
  readonly difficultyMod: number;
  readonly bonusMult?: number;
  readonly forceCrit?: boolean;
}

export interface DamageResult {
  amount: number;
  crit: boolean;
}

export function defenseFactor(def: number): number {
  return 100 / (100 + Math.max(0, def));
}

/** `rng` returns [0, 1); it is only consumed when a crit roll is needed. */
export function computeDamage(
  input: DamageInput,
  rng: () => number,
  out?: DamageResult,
): DamageResult {
  const result = out ?? { amount: 0, crit: false };
  const crit =
    input.forceCrit === true ||
    (input.critChance > 0 && rng() < Math.min(1, Math.max(0, input.critChance)));
  const critMult = crit ? Math.max(1, input.critDamage) : 1;
  const raw =
    Math.max(0, input.atk) *
    Math.max(0, input.skillMult) *
    critMult *
    defenseFactor(input.def) *
    Math.max(0, input.difficultyMod) *
    Math.max(0, input.bonusMult ?? 1);
  result.amount = Math.max(1, Math.round(raw));
  result.crit = crit;
  return result;
}

/** Damage-over-time tick: no crit, defense applies. */
export function computeDotDamage(atkUnits: number, def: number, difficultyMod: number): number {
  return Math.max(1, Math.round(atkUnits * defenseFactor(def) * difficultyMod));
}
