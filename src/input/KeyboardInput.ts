import { listen } from '../ui/dom';
import { INPUT_SOURCE, type InputAction } from './actions';
import type { InputState } from './InputState';

const KEY_ACTIONS: Readonly<Record<string, InputAction>> = {
  KeyJ: 'attack',
  Enter: 'attack',
  Space: 'dodge',
  ShiftLeft: 'dodge',
  Digit1: 'skill1',
  KeyU: 'skill1',
  Digit2: 'skill2',
  KeyI: 'skill2',
  Digit3: 'skill3',
  KeyO: 'skill3',
  KeyR: 'ultimate',
  Escape: 'pause',
  KeyP: 'pause',
};

const MOVE_KEYS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
} as const;

/** Desktop/dev keyboard support (WASD/arrows + J/Space/1-3/R/Esc). Also used by Bluetooth keyboards. */
export class KeyboardInput {
  private readonly down = new Set<string>();
  private readonly disposers: (() => void)[] = [];
  enabled = true;

  constructor(private readonly input: InputState) {
    this.disposers.push(
      listen(window, 'keydown', this.onKeyDown),
      listen(window, 'keyup', this.onKeyUp),
      listen(window, 'blur', this.releaseAll),
    );
  }

  dispose(): void {
    this.releaseAll();
    for (const d of this.disposers) d();
    this.disposers.length = 0;
  }

  readonly releaseAll = (): void => {
    this.down.clear();
    this.input.releaseSource(INPUT_SOURCE.keyboard);
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    const action = KEY_ACTIONS[e.code];
    const isMove = this.isMoveKey(e.code);
    if (action === undefined && !isMove) return;
    // Pause must work even while gameplay input is disabled (it toggles the menu).
    if (!this.enabled && action !== 'pause') return;
    e.preventDefault();
    this.down.add(e.code);
    if (action !== undefined) this.input.press(action, INPUT_SOURCE.keyboard);
    if (isMove) this.updateMove();
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (!this.down.delete(e.code)) return;
    const action = KEY_ACTIONS[e.code];
    if (action !== undefined) this.input.release(action, INPUT_SOURCE.keyboard);
    if (this.isMoveKey(e.code)) this.updateMove();
  };

  private isMoveKey(code: string): boolean {
    for (const list of Object.values(MOVE_KEYS)) {
      if ((list as readonly string[]).includes(code)) return true;
    }
    return false;
  }

  private any(codes: readonly string[]): boolean {
    for (const c of codes) if (this.down.has(c)) return true;
    return false;
  }

  private updateMove(): void {
    let x = 0;
    let y = 0;
    if (this.any(MOVE_KEYS.left)) x -= 1;
    if (this.any(MOVE_KEYS.right)) x += 1;
    if (this.any(MOVE_KEYS.up)) y += 1;
    if (this.any(MOVE_KEYS.down)) y -= 1;
    const len = Math.hypot(x, y);
    if (len > 0) {
      x /= len;
      y /= len;
    }
    this.input.setMove(INPUT_SOURCE.keyboard, x, y);
  }
}
