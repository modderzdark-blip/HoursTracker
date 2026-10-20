import { el, onTap } from './dom';

/** In-game HUD shell: pause button, optional stage label, transient toasts, FPS counter. */
export class Hud {
  readonly root: HTMLElement;
  private readonly toast: HTMLElement;
  private toastTimer = 0;
  private readonly disposePause: () => void;
  private readonly pause: HTMLElement;
  private readonly fps: HTMLElement;
  private fpsText = '';

  constructor(container: HTMLElement, stageLabel: string, onPause: () => void) {
    this.root = el('div', 'hud');
    const pause = el('div', 'hud-pause');
    pause.setAttribute('role', 'button');
    pause.setAttribute('aria-label', 'Pause');
    pause.dataset['testid'] = 'hud-pause';
    pause.append(el('span', 'hud-pause-bar'), el('span', 'hud-pause-bar'));
    this.disposePause = onTap(pause, onPause);
    this.pause = pause;
    this.toast = el('div', 'hud-toast is-hidden');
    this.fps = el('div', 'hud-fps is-hidden');
    this.fps.dataset['testid'] = 'fps-counter';
    this.root.append(pause, this.toast, this.fps);
    if (stageLabel.length > 0) this.root.append(el('div', 'hud-stage', stageLabel));
    container.append(this.root);
  }

  showToast(text: string, ms = 1600): void {
    this.toast.textContent = text;
    this.toast.classList.remove('is-hidden');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.add('is-hidden'), ms);
  }

  /** Settings → Graphics → Show FPS. */
  setFpsVisible(visible: boolean): void {
    this.fps.classList.toggle('is-hidden', !visible);
  }

  get fpsVisible(): boolean {
    return !this.fps.classList.contains('is-hidden');
  }

  /** Writes the DOM only when the shown value changes. */
  setFps(fps: number): void {
    const text = `${Math.round(fps)} FPS`;
    if (text === this.fpsText) return;
    this.fpsText = text;
    this.fps.textContent = text;
  }

  /** The pause button only exists in battle; toasts show everywhere. */
  setPauseVisible(visible: boolean): void {
    this.pause.classList.toggle('is-hidden', !visible);
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
