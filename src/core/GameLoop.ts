import { FixedTimestep, type FixedTimestepConfig } from './FixedTimestep';
import { FrameLimiter } from './FrameLimiter';
import type { TimeControl } from './TimeControl';

export interface GameLoopCallbacks {
  /** Called once per rendered frame before logic, with real elapsed seconds (input polling). */
  readonly preUpdate: (realDtSec: number, nowMs: number) => void;
  /** Fixed-rate logic step. */
  readonly fixedUpdate: (dtSec: number) => void;
  /** Interpolated render. `alpha` blends previous→current logic state. */
  readonly render: (alpha: number, realDtSec: number) => void;
  /** Called after render with the real frame interval in ms (debug stats, benchmark). */
  readonly frameEnd: (frameIntervalMs: number, logicSteps: number) => void;
}

/**
 * requestAnimationFrame driver: real time → TimeControl (hit-stop/slow-mo) → fixed steps →
 * interpolated render. Logic is skipped while paused, and while paused we only render when asked
 * (resize, settings change) to save battery.
 */
export class GameLoop {
  readonly timestep: FixedTimestep;
  readonly limiter: FrameLimiter;
  private rafId = 0;
  private running = false;
  private paused = false;
  private lastFrameMs = -1;
  private renderRequested = false;

  constructor(
    config: FixedTimestepConfig,
    private readonly time: TimeControl,
    private readonly callbacks: GameLoopCallbacks,
    fpsCap: number,
  ) {
    this.timestep = new FixedTimestep(config);
    this.limiter = new FrameLimiter(fpsCap);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameMs = -1;
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    // Avoid a huge delta (and a burst of logic steps) when resuming.
    this.lastFrameMs = -1;
    this.timestep.reset();
    this.renderRequested = true;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  requestRender(): void {
    this.renderRequested = true;
  }

  private readonly frame = (nowMs: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.frame);

    if (!this.limiter.shouldRender(nowMs)) return;

    const intervalMs = this.lastFrameMs < 0 ? this.timestep.stepMs : nowMs - this.lastFrameMs;
    this.lastFrameMs = nowMs;
    const realDtSec = Math.min(intervalMs, 250) / 1000;

    if (this.paused) {
      if (this.renderRequested) {
        this.renderRequested = false;
        this.callbacks.render(this.timestep.alpha, 0);
      }
      return;
    }

    this.callbacks.preUpdate(realDtSec, nowMs);
    const logicMs = this.time.advance(Math.min(intervalMs, 250));
    const steps = this.timestep.advance(logicMs, this.callbacks.fixedUpdate);
    this.callbacks.render(this.timestep.alpha, realDtSec);
    this.renderRequested = false;
    this.callbacks.frameEnd(intervalMs, steps);
  };
}
