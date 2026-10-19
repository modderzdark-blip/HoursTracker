import type { EnemyScale } from '../actors/Enemy';
import { DIFFICULTIES, type DifficultyId } from '../data/difficulty';
import { ENEMY_SCALING } from '../data/progression';

/**
 * Enemy stat multipliers for a stage level and difficulty, times optional mode multipliers
 * (tower floors, challenge tiers). Enemy → player damage additionally uses the difficulty's
 * `enemyDamage` as the formula's difficulty modifier.
 */
export function enemyScaleFor(
  level: number,
  difficulty: DifficultyId,
  extra: { readonly hp: number; readonly atk: number } = { hp: 1, atk: 1 },
): EnemyScale {
  const l = Math.max(1, level) - 1;
  const d = DIFFICULTIES[difficulty];
  return {
    hp: (1 + ENEMY_SCALING.hpPerLevel * l) * d.enemyHp * extra.hp,
    atk: (1 + ENEMY_SCALING.atkPerLevel * l) * extra.atk,
    def: 1 + ENEMY_SCALING.defPerLevel * l,
    poise: (1 + ENEMY_SCALING.poisePerLevel * l) * d.enemyPoise,
  };
}
