/**
 * Decides whether a requestAnimationFrame callback should render, to cap the frame rate (30/60)
 * on high-refresh displays and save battery. Works with any display refresh rate.
 */
export class FrameLimiter {
  private intervalMs = 0;
  private lastRenderMs = Number.NEGATIVE_INFINITY;

  constructor(capFps: number) {
    this.setCap(capFps);
  }

  /** 0 or less = uncapped. */
  setCap(capFps: number): void {
    this.intervalMs = capFps > 0 ? 1000 / capFps : 0;
  }

  get capFps(): number {
    return this.intervalMs > 0 ? Math.round(1000 / this.intervalMs) : 0;
  }

  shouldRender(nowMs: number): boolean {
    if (this.intervalMs <= 0) {
      this.lastRenderMs = nowMs;
      return true;
    }
    const elapsed = nowMs - this.lastRenderMs;
    // 10% tolerance absorbs vsync jitter so a 60 cap on a 60 Hz panel never skips frames.
    if (elapsed < this.intervalMs * 0.9) return false;
    if (elapsed > this.intervalMs * 3) {
      this.lastRenderMs = nowMs;
    } else {
      // Advance on the ideal grid so the average rate matches the cap exactly. The +0.1 keeps a
      // slightly early frame on the grid; the result is never more than 10% of an interval ahead.
      const intervals = Math.max(1, Math.floor(elapsed / this.intervalMs + 0.1));
      this.lastRenderMs += this.intervalMs * intervals;
    }
    return true;
  }

  reset(): void {
    this.lastRenderMs = Number.NEGATIVE_INFINITY;
  }
}
