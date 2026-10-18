import { INPUT_CONFIG } from '../data/config';
import { listen } from '../ui/dom';
import { INPUT_SOURCE, type InputAction } from './actions';
import type { InputState } from './InputState';
import { shapeStick, type StickVector } from './joystickMath';

const MAPPED = Object.entries(INPUT_CONFIG.gamepad.buttons) as [InputAction, number][];

/** Gamepad API polling (standard mapping). Polled once per rendered frame. */
export class GamepadInput {
  private readonly prev = new Uint8Array(32);
  private readonly stick: StickVector = { x: 0, y: 0, magnitude: 0 };
  private activeIndex = -1;
  private readonly disposers: (() => void)[] = [];
  enabled = true;
  connectedName = '';

  constructor(private readonly input: InputState) {
    this.disposers.push(
      listen(window, 'gamepadconnected', (e) => {
        if (this.activeIndex === -1) {
          this.activeIndex = e.gamepad.index;
          this.connectedName = e.gamepad.id;
          console.info(`[input] gamepad connected: ${e.gamepad.id}`);
        }
      }),
      listen(window, 'gamepaddisconnected', (e) => {
        if (e.gamepad.index === this.activeIndex) {
          this.activeIndex = -1;
          this.connectedName = '';
          this.prev.fill(0);
          this.input.releaseSource(INPUT_SOURCE.gamepad);
          console.info('[input] gamepad disconnected');
        }
      }),
    );
  }

  poll(): void {
    if (this.activeIndex === -1 || typeof navigator.getGamepads !== 'function') return;
    const pad = navigator.getGamepads()[this.activeIndex];
    if (pad === null || pad === undefined || !pad.connected) return;

    const cfg = INPUT_CONFIG.gamepad;
    if (this.enabled) {
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      shapeStick(ax, ay, 1, cfg.deadZone, cfg.responseExponent, this.stick);
      this.input.setMove(INPUT_SOURCE.gamepad, this.stick.x, -this.stick.y);
    } else {
      this.input.setMove(INPUT_SOURCE.gamepad, 0, 0);
    }

    for (const [action, index] of MAPPED) {
      const pressed = pad.buttons[index]?.pressed === true ? 1 : 0;
      const was = this.prev[index] ?? 0;
      if (pressed === was) continue;
      this.prev[index] = pressed;
      if (pressed === 1 && (this.enabled || action === 'pause')) {
        this.input.press(action, INPUT_SOURCE.gamepad);
      } else if (pressed === 0) {
        this.input.release(action, INPUT_SOURCE.gamepad);
      }
    }
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.input.releaseSource(INPUT_SOURCE.gamepad);
  }
}
