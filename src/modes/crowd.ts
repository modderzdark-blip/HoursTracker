import type { Actor } from '../actors/Actor';

export const CROWD_TUNING = {
  /** Extra spacing kept between bodies (m). */
  padding: 0.12,
  /** Fraction of the overlap resolved per step. */
  strength: 0.5,
} as const;

/**
 * Soft separation between characters (they don't collide physically with each other, so they
 * can never trap the player). Heavier actors (knockbackResist) get pushed less. O(n²) over at
 * most ~15 actors — negligible. Writes into each actor's `push` displacement.
 */
export function separateCrowd(actors: readonly Actor[], count: number): void {
  for (let i = 0; i < count; i++) {
    const a = actors[i];
    if (a === undefined || !a.alive) continue;
    for (let j = i + 1; j < count; j++) {
      const b = actors[j];
      if (b === undefined || !b.alive) continue;
      const dx = b.currFeet.x - a.currFeet.x;
      const dz = b.currFeet.z - a.currFeet.z;
      const minD = a.radius + b.radius + CROWD_TUNING.padding;
      const d2 = dx * dx + dz * dz;
      if (d2 >= minD * minD) continue;
      const d = Math.sqrt(d2);
      const nx = d > 1e-4 ? dx / d : 1;
      const nz = d > 1e-4 ? dz / d : 0;
      const overlap = (minD - d) * CROWD_TUNING.strength;
      const wa = 1 - a.knockbackResist;
      const wb = 1 - b.knockbackResist;
      const total = wa + wb;
      if (total <= 0) continue;
      a.push.x -= nx * overlap * (wa / total);
      a.push.z -= nz * overlap * (wa / total);
      b.push.x += nx * overlap * (wb / total);
      b.push.z += nz * overlap * (wb / total);
    }
  }
}
