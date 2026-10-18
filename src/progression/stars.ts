import type { StarRules } from '../data/stages';

export interface RunResult {
  readonly cleared: boolean;
  readonly timeSec: number;
  /** Total damage taken divided by max HP (can exceed 1 thanks to healing/revives). */
  readonly damageTakenFrac: number;
  readonly revives: number;
}

/**
 * 1 star: cleared. +1: no revive and total damage taken ≤ rules.maxDamageTakenFrac × max HP.
 * +1: cleared within par time. Not cleared = 0.
 */
export function rateRun(run: RunResult, rules: StarRules): number {
  if (!run.cleared) return 0;
  let stars = 1;
  if (run.revives === 0 && run.damageTakenFrac <= rules.maxDamageTakenFrac) stars++;
  if (run.timeSec <= rules.parTimeSec) stars++;
  return stars;
}
