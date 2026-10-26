import type { EnemyScale } from '../actors/Enemy';
import { combineAffixes, type AffixId } from '../data/affixes';
import { DIFFICULTIES, type DifficultyId } from '../data/difficulty';
import { ENEMY_SCALING } from '../data/progression';
import type { StageDef } from '../data/stages';

type ModeMult = { readonly hp: number; readonly atk: number; readonly speed?: number };

/** A mode's multipliers times the stage's own depth pressure (Endless chapters). */
export function stageEnemyMult(stage: StageDef, mode: ModeMult): ModeMult {
  const p = stage.pressure;
  if (p === undefined) return mode;
  return { ...mode, hp: mode.hp * p.hp, atk: mode.atk * p.atk };
}

/**
 * Enemy stat multipliers for a stage level and difficulty, times optional mode multipliers
 * (tower floors, challenge tiers) and elite affixes (their stats fold in here, their behaviours
 * ride along as `affix`). Enemy → player damage additionally uses the difficulty's
 * `enemyDamage` as the formula's difficulty modifier.
 */
export function enemyScaleFor(
  level: number,
  difficulty: DifficultyId,
  extra: ModeMult = { hp: 1, atk: 1 },
  affixes: readonly AffixId[] = [],
): EnemyScale {
  const l = Math.max(1, level) - 1;
  const d = DIFFICULTIES[difficulty];
  const a = combineAffixes(affixes);
  const scale: EnemyScale = {
    hp: (1 + ENEMY_SCALING.hpPerLevel * l) * d.enemyHp * extra.hp * a.hp,
    atk: (1 + ENEMY_SCALING.atkPerLevel * l) * extra.atk * a.atk,
    def: (1 + ENEMY_SCALING.defPerLevel * l) * a.def,
    poise: (1 + ENEMY_SCALING.poisePerLevel * l) * d.enemyPoise * a.poise,
    speed: (extra.speed ?? 1) * a.speed,
  };
  return affixes.length > 0 ? { ...scale, affix: a.effects } : scale;
}
