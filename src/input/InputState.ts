import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import {
  ACTION_COUNT,
  INPUT_ACTIONS,
  INPUT_SOURCE_COUNT,
  actionIndex,
  type InputAction,
  type InputSource,
} from './actions';
import { InputBuffer } from './InputBuffer';

/**
 * Merges all input sources. Each action keeps a per-source bitmask so the keyboard releasing
 * "attack" never releases a finger still holding the ATTACK button. Press edges go into the
 * input buffer, timestamped with game time.
 */
export class InputState {
  readonly buffer: InputBuffer;
  private readonly held = new Uint8Array(ACTION_COUNT);
  private readonly moveX = new Float32Array(INPUT_SOURCE_COUNT);
  private readonly moveY = new Float32Array(INPUT_SOURCE_COUNT);
  /** Lifetime press counts per action (debug overlay + tests). */
  readonly pressCounts = new Uint32Array(ACTION_COUNT);

  constructor(
    bufferMs: number,
    private readonly clock: () => number,
    private readonly bus: EventBus<GameEvents>,
  ) {
    this.buffer = new InputBuffer(ACTION_COUNT, bufferMs);
  }

  press(action: InputAction, source: InputSource): void {
    const i = actionIndex(action);
    const before = this.held[i] ?? 0;
    this.held[i] = before | (1 << source);
    if (before === 0) {
      const timeMs = this.clock();
      this.buffer.push(i, timeMs);
      this.pressCounts[i] = (this.pressCounts[i] ?? 0) + 1;
      this.bus.emit('input:pressed', { action, timeMs });
    }
  }

  release(action: InputAction, source: InputSource): void {
    const i = actionIndex(action);
    const before = this.held[i] ?? 0;
    const after = before & ~(1 << source);
    this.held[i] = after;
    if (before !== 0 && after === 0)
      this.bus.emit('input:released', { action, timeMs: this.clock() });
  }

  isHeld(action: InputAction): boolean {
    return (this.held[actionIndex(action)] ?? 0) !== 0;
  }

  /** Consume a buffered press if it is still inside the buffer window. */
  consume(action: InputAction): boolean {
    return this.buffer.consume(actionIndex(action), this.clock());
  }

  setMove(source: InputSource, x: number, y: number): void {
    this.moveX[source] = x;
    this.moveY[source] = y;
  }

  /**
   * Combined move vector: the source with the largest magnitude wins (so an idle gamepad can't
   * cancel the touch stick). x = right, y = forward. Magnitude ≤ 1.
   */
  readMove(out: { x: number; y: number }): { x: number; y: number } {
    let bestX = 0;
    let bestY = 0;
    let best = 0;
    for (let s = 0; s < INPUT_SOURCE_COUNT; s++) {
      const x = this.moveX[s] ?? 0;
      const y = this.moveY[s] ?? 0;
      const m = x * x + y * y;
      if (m > best) {
        best = m;
        bestX = x;
        bestY = y;
      }
    }
    if (best > 1) {
      const len = Math.sqrt(best);
      bestX /= len;
      bestY /= len;
    }
    out.x = bestX;
    out.y = bestY;
    return out;
  }

  /** Releases everything a source holds (finger lost, tab hidden, gamepad unplugged). */
  releaseSource(source: InputSource): void {
    for (let i = 0; i < ACTION_COUNT; i++) {
      if (((this.held[i] ?? 0) & (1 << source)) !== 0) {
        const action = INPUT_ACTIONS[i];
        if (action !== undefined) this.release(action, source);
      }
    }
    this.setMove(source, 0, 0);
  }

  releaseAll(): void {
    for (let s = 0 as InputSource; s < INPUT_SOURCE_COUNT; s = (s + 1) as InputSource) {
      this.releaseSource(s);
    }
    this.buffer.clear();
  }

  pressCount(action: InputAction): number {
    return this.pressCounts[actionIndex(action)] ?? 0;
  }
}
