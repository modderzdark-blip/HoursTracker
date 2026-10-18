/**
 * Fixed set of cooldown slots ticked by game time (so hit-stop and slow motion affect them
 * consistently). Allocation-free.
 */
export class Cooldowns {
  private readonly remaining: Float64Array;
  private readonly duration: Float64Array;

  constructor(durationsMs: readonly number[]) {
    this.remaining = new Float64Array(durationsMs.length);
    this.duration = Float64Array.from(durationsMs);
  }

  get count(): number {
    return this.duration.length;
  }

  tick(dtMs: number): void {
    for (let i = 0; i < this.remaining.length; i++) {
      const r = this.remaining[i] ?? 0;
      if (r > 0) this.remaining[i] = Math.max(0, r - dtMs);
    }
  }

  isReady(slot: number): boolean {
    return (this.remaining[slot] ?? 1) <= 0;
  }

  /** Starts the cooldown if ready; returns whether the use succeeded. */
  tryUse(slot: number): boolean {
    if (slot < 0 || slot >= this.duration.length || !this.isReady(slot)) return false;
    this.remaining[slot] = this.duration[slot] ?? 0;
    return true;
  }

  remainingMs(slot: number): number {
    return this.remaining[slot] ?? 0;
  }

  /** 1 = just used, 0 = ready. */
  fraction(slot: number): number {
    const d = this.duration[slot] ?? 0;
    return d > 0 ? (this.remaining[slot] ?? 0) / d : 0;
  }

  setDuration(slot: number, ms: number): void {
    if (slot >= 0 && slot < this.duration.length) this.duration[slot] = Math.max(0, ms);
  }

  resetAll(): void {
    this.remaining.fill(0);
  }
}
