import { XP_CONFIG } from '../data/progression';

/** XP needed to advance from `level` to `level + 1` (0 at max level). */
export function xpToNext(level: number): number {
  if (level >= XP_CONFIG.maxLevel) return 0;
  return Math.round(XP_CONFIG.base * Math.pow(Math.max(1, level), XP_CONFIG.exponent));
}

export interface LevelState {
  level: number;
  /** XP into the current level. */
  xp: number;
}

/**
 * Adds XP and applies level-ups. Invalid amounts are ignored; at max level XP stops
 * accumulating. Returns how many levels were gained.
 */
export function addXp(state: LevelState, amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (state.level >= XP_CONFIG.maxLevel) {
    state.xp = 0;
    return 0;
  }
  let gained = 0;
  state.xp += Math.floor(amount);
  while (state.level < XP_CONFIG.maxLevel) {
    const need = xpToNext(state.level);
    if (state.xp < need) break;
    state.xp -= need;
    state.level++;
    gained++;
  }
  if (state.level >= XP_CONFIG.maxLevel) state.xp = 0;
  return gained;
}

/** Total XP from level 1 to reach `level` (for display / tests). */
export function totalXpToReach(level: number): number {
  let sum = 0;
  for (let l = 1; l < Math.min(level, XP_CONFIG.maxLevel); l++) sum += xpToNext(l);
  return sum;
}
