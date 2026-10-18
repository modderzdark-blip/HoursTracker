import { el, onTap } from './dom';

/** In-game HUD shell: pause button, optional stage label, transient toasts. */
export class Hud {
  readonly root: HTMLElement;
  private readonly toast: HTMLElement;
  private toastTimer = 0;
  private readonly disposePause: () => void;

  constructor(container: HTMLElement, stageLabel: string, onPause: () => void) {
    this.root = el('div', 'hud');
    const pause = el('div', 'hud-pause');
    pause.setAttribute('role', 'button');
    pause.setAttribute('aria-label', 'Pause');
    pause.dataset['testid'] = 'hud-pause';
    pause.append(el('span', 'hud-pause-bar'), el('span', 'hud-pause-bar'));
    this.disposePause = onTap(pause, onPause);
    this.toast = el('div', 'hud-toast is-hidden');
    this.root.append(pause, this.toast);
    if (stageLabel.length > 0) this.root.append(el('div', 'hud-stage', stageLabel));
    container.append(this.root);
  }

  showToast(text: string, ms = 1600): void {
    this.toast.textContent = text;
    this.toast.classList.remove('is-hidden');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.add('is-hidden'), ms);
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('is-hidden', !visible);
  }

  dispose(): void {
    window.clearTimeout(this.toastTimer);
    this.disposePause();
    this.root.remove();
  }
}
