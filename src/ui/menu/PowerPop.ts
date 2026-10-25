import { el } from '../dom';
import { fmtInt } from './View';

const ROLL_MS = 650;
const SHOW_MS = 2000;

/**
 * Power-change feedback: a badge under the top bar whose number rolls from the old power to
 * the new one, with a green ▲ (or red ▼) and the difference. Click-through.
 */
export class PowerPop {
  readonly root: HTMLElement;
  private readonly value: HTMLElement;
  private readonly delta: HTMLElement;
  private raf = 0;
  private timer = 0;

  constructor(container: HTMLElement) {
    this.root = el('div', 'power-pop is-off');
    this.root.dataset['testid'] = 'power-pop';
    this.value = el('span', 'power-pop-value');
    this.delta = el('span', 'power-pop-delta');
    this.root.append(el('span', 'power-pop-label', 'Power'), this.value, this.delta);
    container.append(this.root);
  }

  /** Returns false (and shows nothing) when the power did not change. */
  show(before: number, after: number): boolean {
    if (after === before) return false;
    const up = after > before;
    this.root.classList.toggle('is-down', !up);
    this.delta.textContent = `${up ? '▲' : '▼'} ${up ? '+' : '−'}${fmtInt(Math.abs(after - before))}`;
    this.root.classList.remove('is-off', 'is-in');
    void this.root.offsetWidth;
    this.root.classList.add('is-in');
    cancelAnimationFrame(this.raf);
    const t0 = performance.now();
    const step = (now: number): void => {
      const k = Math.min(1, (now - t0) / ROLL_MS);
      const e = 1 - Math.pow(1 - k, 3);
      this.value.textContent = fmtInt(Math.round(before + (after - before) * e));
      if (k < 1) this.raf = requestAnimationFrame(step);
    };
    this.value.textContent = fmtInt(before);
    this.raf = requestAnimationFrame(step);
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.root.classList.add('is-off'), SHOW_MS);
    return true;
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.timer);
    this.root.remove();
  }
}
