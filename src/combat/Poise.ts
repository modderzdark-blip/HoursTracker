/**
 * Poise: hits wear it down; at 0 the owner is staggered (bonus damage window) and poise refills.
 * Regenerates after a delay without being hit. Bosses use the same class as their break bar.
 */
export class Poise {
  private value: number;
  private sinceHitMs = 0;

  constructor(
    private maxValue: number,
    private readonly regenDelayMs = 2000,
    /** Fraction of max regenerated per second. */
    private readonly regenFracPerSec = 0.25,
  ) {
    this.value = maxValue;
  }

  get current(): number {
    return this.value;
  }

  get max(): number {
    return this.maxValue;
  }

  get frac(): number {
    return this.maxValue > 0 ? this.value / this.maxValue : 0;
  }

  /** Returns true if this hit broke poise. */
  apply(amount: number): boolean {
    if (!Number.isFinite(amount) || amount <= 0 || this.maxValue <= 0) return false;
    this.sinceHitMs = 0;
    this.value -= amount;
    if (this.value <= 0) {
      this.value = 0;
      return true;
    }
    return false;
  }

  tick(dtMs: number): void {
    this.sinceHitMs += dtMs;
    if (this.sinceHitMs >= this.regenDelayMs && this.value < this.maxValue) {
      this.value = Math.min(
        this.maxValue,
        this.value + this.maxValue * this.regenFracPerSec * (dtMs / 1000),
      );
    }
  }

  refill(max = this.maxValue): void {
    this.maxValue = max;
    this.value = max;
    this.sinceHitMs = 0;
  }
}
