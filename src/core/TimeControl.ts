/**
 * Converts real elapsed time into game (logic) time, applying hit-stop freezes and slow motion.
 * Hit-stop: game time stops entirely for N real ms. Slow motion: game time runs at `scale` for N
 * real ms. Both are measured in real time so a freeze never extends itself.
 */
export class TimeControl {
  private hitStopRemainingMs = 0;
  private slowRemainingMs = 0;
  private slowScale = 1;
  /** Global multiplier (debug / accessibility). */
  baseScale = 1;

  /** Freezes game time. Overlapping requests keep the longer one rather than stacking. */
  hitStop(ms: number): void {
    if (ms > this.hitStopRemainingMs) this.hitStopRemainingMs = ms;
  }

  slowMotion(scale: number, ms: number): void {
    this.slowScale = Math.min(Math.max(scale, 0), 1);
    this.slowRemainingMs = Math.max(this.slowRemainingMs, ms);
  }

  get isFrozen(): boolean {
    return this.hitStopRemainingMs > 0;
  }

  get isSlowed(): boolean {
    return this.slowRemainingMs > 0;
  }

  /** Current game-time rate (0 during hit-stop) — used to scale cosmetic animation. */
  get currentScale(): number {
    if (this.hitStopRemainingMs > 0) return 0;
    return (this.slowRemainingMs > 0 ? this.slowScale : 1) * this.baseScale;
  }

  /** Consumes `realMs` of wall-clock time and returns the game time it maps to. */
  advance(realMs: number): number {
    let remaining = Math.max(realMs, 0);
    let gameMs = 0;
    if (this.hitStopRemainingMs > 0) {
      const used = Math.min(this.hitStopRemainingMs, remaining);
      this.hitStopRemainingMs -= used;
      remaining -= used;
    }
    if (this.slowRemainingMs > 0 && remaining > 0) {
      const used = Math.min(this.slowRemainingMs, remaining);
      this.slowRemainingMs -= used;
      remaining -= used;
      gameMs += used * this.slowScale * this.baseScale;
    }
    gameMs += remaining * this.baseScale;
    return gameMs;
  }

  reset(): void {
    this.hitStopRemainingMs = 0;
    this.slowRemainingMs = 0;
    this.slowScale = 1;
  }
}
