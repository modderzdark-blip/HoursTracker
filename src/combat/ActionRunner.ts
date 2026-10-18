import type { ActionDef, MoveSpec } from '../data/combatTypes';

export type ActionPhase = 'startup' | 'active' | 'recovery' | 'done';

function ease(kind: MoveSpec['ease'], t: number): number {
  const x = Math.min(Math.max(t, 0), 1);
  switch (kind) {
    case 'linear':
      return x;
    case 'out':
      return 1 - (1 - x) * (1 - x);
    case 'inOut':
      return x * x * (3 - 2 * x);
  }
}

/**
 * Runs one timed action (combo step, skill, enemy attack) on game time: phase, hit timing,
 * cancel window, i-frames, super armor and data-driven movement. Pure logic — no rendering or
 * physics — so combat timing is unit-testable. `speed` scales every duration (attack speed).
 */
export class ActionRunner {
  def: ActionDef | null = null;
  private speed = 1;
  private elapsed = 0;
  private hitFired: boolean[] = [];

  start(def: ActionDef, speed = 1): void {
    this.def = def;
    this.speed = speed > 0 ? speed : 1;
    this.elapsed = 0;
    this.hitFired = def.hits.map(() => false);
  }

  stop(): void {
    this.def = null;
  }

  get running(): boolean {
    return this.def !== null && this.phase !== 'done';
  }

  get elapsedMs(): number {
    return this.elapsed;
  }

  private scaled(ms: number): number {
    return ms / this.speed;
  }

  get totalMs(): number {
    const d = this.def;
    return d === null ? 0 : this.scaled(d.startupMs + d.activeMs + d.recoveryMs);
  }

  get startupEndMs(): number {
    return this.def === null ? 0 : this.scaled(this.def.startupMs);
  }

  get activeEndMs(): number {
    const d = this.def;
    return d === null ? 0 : this.scaled(d.startupMs + d.activeMs);
  }

  get phase(): ActionPhase {
    const d = this.def;
    if (d === null) return 'done';
    if (this.elapsed < this.startupEndMs) return 'startup';
    if (this.elapsed < this.activeEndMs) return 'active';
    if (this.elapsed < this.totalMs) return 'recovery';
    return 'done';
  }

  /** Fraction of the startup (telegraph) elapsed, 0..1. */
  get startupProgress(): number {
    const s = this.startupEndMs;
    return s > 0 ? Math.min(1, this.elapsed / s) : 1;
  }

  canCancel(): boolean {
    const d = this.def;
    return d !== null && this.elapsed >= this.scaled(d.cancelAtMs);
  }

  isInvulnerable(): boolean {
    const inv = this.def?.invulnerable;
    if (inv === undefined) return false;
    return this.elapsed >= this.scaled(inv.fromMs) && this.elapsed < this.scaled(inv.toMs);
  }

  hasSuperArmor(): boolean {
    return this.def?.superArmor === true && this.phase !== 'done';
  }

  /** True while a sweep action's active phase should re-test its hit shape every step. */
  get sweeping(): boolean {
    return this.def?.sweep === true && this.phase === 'active';
  }

  /**
   * Advances time. Calls `onHit(index)` for each timed hit whose moment is crossed (at most once
   * each). Returns the fraction (0..1) of the move distance to apply this step.
   */
  advance(dtMs: number, onHit: (index: number) => void): number {
    const d = this.def;
    if (d === null) return 0;
    const before = this.elapsed;
    this.elapsed += Math.max(0, dtMs);
    for (let i = 0; i < d.hits.length; i++) {
      if (this.hitFired[i] === true) continue;
      const hit = d.hits[i];
      if (hit === undefined) continue;
      const at = this.scaled(d.startupMs + hit.offsetMs);
      if (this.elapsed >= at) {
        this.hitFired[i] = true;
        onHit(i);
      }
    }
    return this.moveFraction(before, this.elapsed);
  }

  private moveFraction(fromMs: number, toMs: number): number {
    const m = this.def?.move;
    if (m === undefined) return 0;
    const s = this.scaled(m.startMs);
    const e = this.scaled(m.endMs);
    if (e <= s) return 0;
    const a = ease(m.ease, (fromMs - s) / (e - s));
    const b = ease(m.ease, (toMs - s) / (e - s));
    return b - a;
  }
}
