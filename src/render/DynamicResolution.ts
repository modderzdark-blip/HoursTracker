/**
 * Dynamic resolution for battles: watches real frame times and scales the render resolution
 * between `min` and 1 so the frame rate holds its target. It drops quickly when frames run long
 * and climbs back slowly when there is headroom, so the image is only ever as soft as the device
 * needs and never flickers between sizes.
 */
export const DYNAMIC_RES_CONFIG = {
  /** Frames are averaged over windows this long (ms of real time). */
  windowMs: 700,
  /** Lowest scale (of the quality preset's resolution). */
  min: 0.62,
  stepDown: 0.08,
  stepUp: 0.04,
  /** Average frame time above target × this → step down. */
  downAbove: 1.15,
  /** Below target × this for `upWindows` windows in a row → step up. */
  upBelow: 0.8,
  upWindows: 3,
  /** Frames longer than this (loading hitches, tab switches) are ignored. */
  outlierMs: 120,
} as const;

export class DynamicResolution {
  scale = 1;
  private sum = 0;
  private count = 0;
  private elapsed = 0;
  private good = 0;

  constructor(private readonly cfg: typeof DYNAMIC_RES_CONFIG = DYNAMIC_RES_CONFIG) {}

  /** Feeds one real frame interval; returns the new scale when it changed, else null. */
  frame(intervalMs: number, targetMs: number): number | null {
    if (!(intervalMs > 0) || intervalMs > this.cfg.outlierMs) return null;
    this.sum += intervalMs;
    this.count++;
    this.elapsed += intervalMs;
    if (this.elapsed < this.cfg.windowMs) return null;
    const avg = this.sum / this.count;
    this.sum = this.count = this.elapsed = 0;
    const before = this.scale;
    if (avg > targetMs * this.cfg.downAbove) {
      this.good = 0;
      this.scale = Math.max(this.cfg.min, this.scale - this.cfg.stepDown);
    } else if (avg < targetMs * this.cfg.upBelow) {
      this.good++;
      if (this.good >= this.cfg.upWindows) {
        this.good = 0;
        this.scale = Math.min(1, this.scale + this.cfg.stepUp);
      }
    } else {
      this.good = 0;
    }
    this.scale = Math.round(this.scale * 100) / 100;
    return this.scale !== before ? this.scale : null;
  }

  reset(): void {
    this.scale = 1;
    this.sum = this.count = this.elapsed = this.good = 0;
  }
}

/** Frame time to aim for: 60 FPS unless the player capped lower (aiming for 120 would only blur). */
export function dynamicResTargetMs(fpsCap: number): number {
  return 1000 / (fpsCap > 0 && fpsCap < 60 ? fpsCap : 60);
}
