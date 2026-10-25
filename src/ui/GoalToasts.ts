import { el } from './dom';

export interface GoalToast {
  readonly kicker: string;
  readonly text: string;
}

const SHOW_MS = 2600;

/**
 * "Quest complete" / "Achievement reached" toasts: slide in at the top right under the
 * currency bar, one at a time from a queue, each with a chime. Click-through.
 */
export class GoalToasts {
  readonly root: HTMLElement;
  private readonly kicker: HTMLElement;
  private readonly text: HTMLElement;
  private readonly queue: GoalToast[] = [];
  private timer = 0;
  private showing = false;

  constructor(
    container: HTMLElement,
    private readonly onShow: () => void,
  ) {
    this.root = el('div', 'goal-toast is-off');
    this.root.dataset['testid'] = 'goal-toast';
    this.kicker = el('div', 'goal-toast-kicker');
    this.text = el('div', 'goal-toast-text');
    this.root.append(el('div', 'goal-toast-icon', '✦'), this.kicker, this.text);
    container.append(this.root);
  }

  push(t: GoalToast): void {
    this.queue.push(t);
    if (!this.showing) this.next();
  }

  private next(): void {
    const t = this.queue.shift();
    if (t === undefined) {
      this.showing = false;
      this.root.classList.add('is-off');
      return;
    }
    this.showing = true;
    this.kicker.textContent = t.kicker;
    this.text.textContent = t.text;
    this.root.classList.remove('is-off', 'is-in');
    void this.root.offsetWidth;
    this.root.classList.add('is-in');
    this.onShow();
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.next(), SHOW_MS);
  }

  dispose(): void {
    window.clearTimeout(this.timer);
    this.root.remove();
  }
}
