/**
 * One-slot-per-action input buffer. A press is remembered for `windowMs` of game time; the action
 * fires at the first valid window inside that span (e.g. during an attack's cancel window).
 * The newest press of an action replaces the older one. No allocation after construction.
 */
export class InputBuffer {
  private readonly pressedAt: Float64Array;

  constructor(
    actionCount: number,
    public windowMs: number,
  ) {
    this.pressedAt = new Float64Array(actionCount).fill(Number.NaN);
  }

  push(action: number, timeMs: number): void {
    this.pressedAt[action] = timeMs;
  }

  /** True if the action was pressed within the window ending at `nowMs`. Does not consume. */
  has(action: number, nowMs: number): boolean {
    const t = this.pressedAt[action];
    if (t === undefined || Number.isNaN(t)) return false;
    if (nowMs - t > this.windowMs) {
      this.pressedAt[action] = Number.NaN;
      return false;
    }
    return true;
  }

  /** Returns true and clears the entry if the action is buffered and still fresh. */
  consume(action: number, nowMs: number): boolean {
    if (!this.has(action, nowMs)) return false;
    this.pressedAt[action] = Number.NaN;
    return true;
  }

  clear(action?: number): void {
    if (action === undefined) this.pressedAt.fill(Number.NaN);
    else this.pressedAt[action] = Number.NaN;
  }
}
