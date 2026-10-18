export interface FixedTimestepConfig {
  readonly stepHz: number;
  readonly maxSubSteps: number;
  readonly maxFrameMs: number;
}

/**
 * Classic accumulator: logic advances in fixed steps, rendering interpolates between the last two
 * logic states using `alpha`. Pure and deterministic so it can be unit tested.
 */
export class FixedTimestep {
  readonly stepMs: number;
  readonly stepSec: number;
  private accumulatorMs = 0;
  private lastAlpha = 0;
  /** Logic time dropped because the frame needed more than `maxSubSteps` steps. */
  droppedMs = 0;

  constructor(private readonly config: FixedTimestepConfig) {
    if (config.stepHz <= 0) throw new Error('stepHz must be positive');
    this.stepMs = 1000 / config.stepHz;
    this.stepSec = 1 / config.stepHz;
  }

  /**
   * Adds `logicMs` of (already time-scaled) game time and runs as many fixed steps as fit.
   * Returns the number of steps run.
   */
  advance(logicMs: number, step: (dtSec: number) => void): number {
    const clamped = Math.min(Math.max(logicMs, 0), this.config.maxFrameMs);
    this.accumulatorMs += clamped;
    let steps = 0;
    while (this.accumulatorMs >= this.stepMs && steps < this.config.maxSubSteps) {
      step(this.stepSec);
      this.accumulatorMs -= this.stepMs;
      steps++;
    }
    if (steps === this.config.maxSubSteps && this.accumulatorMs >= this.stepMs) {
      // Can't keep up: drop the backlog instead of spiralling.
      const keep = this.accumulatorMs % this.stepMs;
      this.droppedMs += this.accumulatorMs - keep;
      this.accumulatorMs = keep;
    }
    this.lastAlpha = this.accumulatorMs / this.stepMs;
    return steps;
  }

  /** Interpolation factor (0..1) between the previous and current logic state. */
  get alpha(): number {
    return this.lastAlpha;
  }

  reset(): void {
    this.accumulatorMs = 0;
    this.lastAlpha = 0;
  }
}
