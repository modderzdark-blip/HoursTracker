/**
 * Rolling frame statistics over the last N frames (fps, mean/max/p95 interval, logic steps).
 * Allocation-free per frame; percentile uses a preallocated scratch buffer when queried.
 */
export class FrameStats {
  private readonly intervals: Float64Array;
  private readonly scratch: Float64Array;
  private index = 0;
  private filled = 0;
  private sum = 0;
  totalFrames = 0;
  lastSteps = 0;

  constructor(readonly windowSize: number) {
    this.intervals = new Float64Array(windowSize);
    this.scratch = new Float64Array(windowSize);
  }

  push(intervalMs: number, logicSteps: number): void {
    const old = this.intervals[this.index] ?? 0;
    if (this.filled === this.windowSize) this.sum -= old;
    this.intervals[this.index] = intervalMs;
    this.sum += intervalMs;
    this.index = (this.index + 1) % this.windowSize;
    if (this.filled < this.windowSize) this.filled++;
    this.totalFrames++;
    this.lastSteps = logicSteps;
  }

  get count(): number {
    return this.filled;
  }

  get meanMs(): number {
    return this.filled > 0 ? this.sum / this.filled : 0;
  }

  get fps(): number {
    const m = this.meanMs;
    return m > 0 ? 1000 / m : 0;
  }

  get maxMs(): number {
    let max = 0;
    for (let i = 0; i < this.filled; i++) max = Math.max(max, this.intervals[i] ?? 0);
    return max;
  }

  /** Percentile (0..100) of frame interval — p95 shows stutter that the mean hides. */
  percentileMs(p: number): number {
    if (this.filled === 0) return 0;
    const view = this.scratch.subarray(0, this.filled);
    view.set(this.intervals.subarray(0, this.filled));
    view.sort();
    const idx = Math.min(this.filled - 1, Math.max(0, Math.ceil((p / 100) * this.filled) - 1));
    return view[idx] ?? 0;
  }

  reset(): void {
    this.index = 0;
    this.filled = 0;
    this.sum = 0;
  }
}
