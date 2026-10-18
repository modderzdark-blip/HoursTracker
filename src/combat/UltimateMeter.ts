/**
 * Ultimate charge 0..1. Charged by dealing and taking damage (rates come from hero data in M5).
 */
export class UltimateMeter {
  private charge = 0;

  get value(): number {
    return this.charge;
  }

  get isReady(): boolean {
    return this.charge >= 1;
  }

  add(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.charge = Math.min(1, this.charge + amount);
  }

  /** Spends a full meter; returns false (and spends nothing) if not full. */
  tryConsume(): boolean {
    if (!this.isReady) return false;
    this.charge = 0;
    return true;
  }

  reset(): void {
    this.charge = 0;
  }
}
