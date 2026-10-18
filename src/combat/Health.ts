export class Health {
  private value: number;

  constructor(private maxValue: number) {
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

  get dead(): boolean {
    return this.value <= 0;
  }

  /** Returns the damage actually applied (never more than the remaining HP). */
  damage(amount: number): number {
    if (this.dead || !Number.isFinite(amount) || amount <= 0) return 0;
    const applied = Math.min(this.value, amount);
    this.value -= applied;
    return applied;
  }

  heal(amount: number): number {
    if (this.dead || !Number.isFinite(amount) || amount <= 0) return 0;
    const applied = Math.min(this.maxValue - this.value, amount);
    this.value += applied;
    return applied;
  }

  /** Revive / respawn at a fraction of max HP. */
  reset(frac = 1, max = this.maxValue): void {
    this.maxValue = max;
    this.value = Math.max(1, Math.round(max * Math.min(Math.max(frac, 0), 1)));
  }
}
