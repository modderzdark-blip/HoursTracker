import { ULTIMATE_CONFIG } from '../data/config';
import type { HitSpec } from '../data/combatTypes';

/** The blast that ends every ultimate: everything within the finale radius is launched. */
export function ultimateFinaleHit(): HitSpec {
  const f = ULTIMATE_CONFIG.finale;
  return {
    damage: f.damage,
    poise: 200,
    reaction: 'launch',
    knockback: 3,
    hitStopMs: 140,
    shake: 1,
    shape: { kind: 'circle', radius: f.radius, forward: 0 },
  };
}

/** Damage multiplier of the finale: the ultimate's own bonuses (talents, relics) × its power. */
export function ultimateFinaleMult(ultDamage: number): number {
  return ultDamage * ULTIMATE_CONFIG.power;
}
