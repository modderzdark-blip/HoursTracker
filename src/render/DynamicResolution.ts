/**
 * Adaptive battle resolution, decided between fights. During a battle it only measures real
 * frame times; when the battle ends it picks the resolution for the next one, which is applied
 * behind the loading veil. The canvas is never resized mid-fight: on Android a resize clears the
 * picture, and the next frame (new render targets) can take a second, so the screen went black
 * at the heaviest moments (wave starts, ultimates, victory).
 */
export const DYNAMIC_RES_CONFIG = {
  /** Lowest scale (of the quality preset's resolution). */
  min: 0.62,
  /** Largest single step down, and the step back up. */
  maxStepDown: 0.15,
  stepUp: 0.05,
  /** Average frame time above target × this → lower the next battle's resolution. */
  downAbove: 1.15,
  /** Below target × this → raise it a step. */
  upBelow: 0.85,
  /** Frames needed before a battle counts (short fights say little). */
  minFrames: 300,
  /** Frames longer than this (loading hitches, tab switches) are ignored. */
  outlierMs: 120,
} as const;

export class DynamicResolution {
  /** Scale for the next battle (and the current one, once applied). */
  scale = 1;
  private sum = 0;
  private count = 0;

  constructor(private readonly cfg: typeof DYNAMIC_RES_CONFIG = DYNAMIC_RES_CONFIG) {}

  /** Feeds one real battle frame interval. */
  frame(intervalMs: number): void {
    if (!(intervalMs > 0) || intervalMs > this.cfg.outlierMs) return;
    this.sum += intervalMs;
    this.count++;
  }

  /** The battle ended: returns the scale for the next battle (unchanged if it ran fine). */
  settle(targetMs: number): number {
    const n = this.count;
    const avg = n > 0 ? this.sum / n : 0;
    this.sum = this.count = 0;
    if (n < this.cfg.minFrames) return this.scale;
    if (avg > targetMs * this.cfg.downAbove) {
      // Pixel cost goes with the square of the scale; step by the square root of the overshoot.
      const factor = Math.max(1 - this.cfg.maxStepDown, Math.sqrt(targetMs / avg));
      this.scale = Math.max(this.cfg.min, this.scale * Math.min(0.97, factor));
    } else if (avg < targetMs * this.cfg.upBelow) {
      this.scale = Math.min(1, this.scale + this.cfg.stepUp);
    }
    this.scale = Math.round(this.scale * 100) / 100;
    return this.scale;
  }

  /** Discards the frames measured so far (a battle left before it counted). */
  discard(): void {
    this.sum = this.count = 0;
  }
}

/** Frame time to aim for: 60 FPS unless the player capped lower (aiming for 120 would only blur). */
export function dynamicResTargetMs(fpsCap: number): number {
  return 1000 / (fpsCap > 0 && fpsCap < 60 ? fpsCap : 60);
}
