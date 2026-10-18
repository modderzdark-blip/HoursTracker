import type { HitShape } from '../data/combatTypes';

/**
 * Ground indicators for telegraphed area attacks. Implemented by vfx/TelegraphDecals; AI code
 * only sees this interface (keeps ai/ free of rendering imports).
 */
export interface TelegraphPort {
  /** Returns a handle, or -1 if the pool is exhausted (the attack still works). */
  show(shape: HitShape, x: number, z: number, yaw: number, color: number): number;
  /** progress 0..1 fills the indicator; position/facing may follow the attacker. */
  update(handle: number, progress: number, x: number, z: number, yaw: number): void;
  hide(handle: number): void;
}
