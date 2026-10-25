import { el, onTap } from './dom';

/**
 * Title screen. Shown instantly (before the 3D engine chunk finishes loading) with a progress
 * line; becomes tappable once the game is ready. The tap is the user gesture that unlocks
 * audio, enters fullscreen and locks landscape.
 */
export class TitleScreen {
  readonly root: HTMLElement;
  private readonly status: HTMLElement;
  private readonly tip: HTMLElement;
  private readonly startBtn: HTMLElement;
  private tipTimer = 0;
  private ready = false;
  private handler: (() => void) | null = null;
  private readonly disposeTap: () => void;

  constructor(container: HTMLElement, buildLabel: string) {
    this.root = el('div', 'screen title-screen');
    this.root.dataset['testid'] = 'title-screen';
    const embers = el('div', 'title-embers');
    const logo = el('div', 'title-logo');
    logo.append(
      el('h1', 'title-name', 'ASHBOUND'),
      el('p', 'title-tagline', 'The shadow remembers your name'),
    );
    this.startBtn = el('div', 'btn btn-primary title-start is-disabled', 'Loading…');
    this.startBtn.setAttribute('role', 'button');
    this.startBtn.dataset['testid'] = 'title-start';
    this.status = el('p', 'title-status', '');
    this.tip = el('p', 'title-tip', '');
    const build = el('p', 'title-build', buildLabel);
    this.root.append(embers, logo, this.startBtn, this.status, this.tip, build);
    container.append(this.root);

    // The whole screen is the tap target once ready (easier on phones than a small button).
    this.disposeTap = onTap(this.root, () => {
      if (this.ready && this.handler !== null) this.handler();
    });
  }

  setStatus(text: string): void {
    this.status.textContent = text;
  }

  /** Rotates lore lines under the status while the game loads. */
  showTips(next: () => string, everyMs = 4200): void {
    const swap = (): void => {
      this.tip.classList.remove('is-in');
      void this.tip.offsetWidth;
      this.tip.textContent = next();
      this.tip.classList.add('is-in');
    };
    swap();
    window.clearInterval(this.tipTimer);
    this.tipTimer = window.setInterval(swap, everyMs);
  }

  setReady(onStart: () => void): void {
    this.ready = true;
    this.handler = onStart;
    this.startBtn.textContent = 'Tap to begin';
    this.startBtn.classList.remove('is-disabled');
    this.startBtn.classList.add('is-pulsing');
    this.status.textContent = '';
  }

  setBusy(text: string): void {
    this.ready = false;
    this.startBtn.textContent = text;
    this.startBtn.classList.add('is-disabled');
    this.startBtn.classList.remove('is-pulsing');
  }

  hide(): void {
    window.clearInterval(this.tipTimer);
    this.disposeTap();
    this.root.classList.add('is-leaving');
    window.setTimeout(() => this.root.remove(), 450);
  }
}
