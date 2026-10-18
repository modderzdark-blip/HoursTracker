import { STATUS_EFFECTS, STATUS_IDS, type StatusId } from '../data/statusEffects';

const INDEX: Readonly<Record<StatusId, number>> = { bleed: 0, burn: 1, slow: 2 };

/**
 * Active status effects on one combatant, following the data-driven stacking rules in
 * data/statusEffects.ts. Fixed-size arrays: no allocation while ticking.
 */
export class StatusEffects {
  private readonly stacks = new Int32Array(STATUS_IDS.length);
  private readonly remaining = new Float64Array(STATUS_IDS.length);
  private readonly tickTimer = new Float64Array(STATUS_IDS.length);
  private readonly sourceAtk = new Float64Array(STATUS_IDS.length);
  private readonly sourceMult = new Float64Array(STATUS_IDS.length);

  apply(id: StatusId, sourceAtk: number, sourceMult = 1): void {
    const def = STATUS_EFFECTS[id];
    const i = INDEX[id];
    const current = this.stacks[i] ?? 0;
    if (def.stack === 'add') {
      this.stacks[i] = Math.min(def.maxStacks, current + 1);
    } else {
      this.stacks[i] = 1;
    }
    if (current === 0) this.tickTimer[i] = 0;
    this.remaining[i] = def.durationMs;
    // The strongest source wins (a weak re-application can't weaken an existing DoT).
    this.sourceAtk[i] = Math.max(this.sourceAtk[i] ?? 0, sourceAtk);
    this.sourceMult[i] = Math.max(this.sourceMult[i] ?? 0, sourceMult);
  }

  /**
   * Advances timers. `onTick(id, atkUnits, sourceMult)` is called for each damage tick; atkUnits =
   * source ATK × tick multiplier × stacks (defense is applied by the damage pipeline).
   */
  tick(dtMs: number, onTick: (id: StatusId, atkUnits: number, sourceMult: number) => void): void {
    for (let i = 0; i < STATUS_IDS.length; i++) {
      const stacks = this.stacks[i] ?? 0;
      if (stacks === 0) continue;
      const id = STATUS_IDS[i];
      if (id === undefined) continue;
      const def = STATUS_EFFECTS[id];
      const step = Math.min(dtMs, this.remaining[i] ?? 0);
      if (def.tickMs > 0) {
        let timer = (this.tickTimer[i] ?? 0) + step;
        while (timer >= def.tickMs) {
          timer -= def.tickMs;
          onTick(id, (this.sourceAtk[i] ?? 0) * def.tickAtkMult * stacks, this.sourceMult[i] ?? 1);
        }
        this.tickTimer[i] = timer;
      }
      const left = (this.remaining[i] ?? 0) - dtMs;
      if (left <= 0) {
        this.stacks[i] = 0;
        this.remaining[i] = 0;
        this.tickTimer[i] = 0;
        this.sourceAtk[i] = 0;
        this.sourceMult[i] = 0;
      } else {
        this.remaining[i] = left;
      }
    }
  }

  stacksOf(id: StatusId): number {
    return this.stacks[INDEX[id]] ?? 0;
  }

  has(id: StatusId): boolean {
    return this.stacksOf(id) > 0;
  }

  remainingMs(id: StatusId): number {
    return this.remaining[INDEX[id]] ?? 0;
  }

  /** Product of active speed multipliers (e.g. slow). */
  speedMult(): number {
    let m = 1;
    for (let i = 0; i < STATUS_IDS.length; i++) {
      const id = STATUS_IDS[i];
      if (id !== undefined && (this.stacks[i] ?? 0) > 0) m *= STATUS_EFFECTS[id].speedMult;
    }
    return m;
  }

  clear(): void {
    this.stacks.fill(0);
    this.remaining.fill(0);
    this.tickTimer.fill(0);
    this.sourceAtk.fill(0);
    this.sourceMult.fill(0);
  }
}
