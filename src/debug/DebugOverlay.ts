import { DEBUG_CONFIG } from '../data/config';
import { el, listen, onTap } from '../ui/dom';

export interface DebugCheat {
  readonly label: string;
  readonly run: () => void;
}

/**
 * FPS / frame time / draw calls / triangles / entities / memory overlay.
 * Toggle: tap the top-left corner 3 times quickly (hidden gesture), the ` key, or the pause menu.
 * Text refreshes at 4 Hz so the overlay itself costs almost nothing.
 */
export class DebugOverlay {
  readonly root: HTMLElement;
  private readonly text: HTMLPreElement;
  private visible = false;
  private lastRefresh = 0;
  private readonly tapTimes: number[] = [];
  private readonly disposers: (() => void)[] = [];
  onToggle: ((visible: boolean) => void) | null = null;

  constructor(
    container: HTMLElement,
    private readonly snapshot: () => string,
    cheats: readonly DebugCheat[],
  ) {
    this.root = el('div', 'debug-overlay is-hidden');
    this.root.dataset['testid'] = 'debug-overlay';
    this.text = el('pre', 'debug-text');
    const cheatRow = el('div', 'debug-cheats');
    for (const c of cheats) {
      const b = el('div', 'debug-cheat', c.label);
      b.setAttribute('role', 'button');
      this.disposers.push(onTap(b, c.run));
      cheatRow.append(b);
    }
    this.root.append(this.text, cheatRow);
    container.append(this.root);

    this.disposers.push(
      listen(window, 'pointerdown', this.onCornerTap, { capture: true, passive: true }),
      listen(window, 'keydown', (e) => {
        if (e.code === 'Backquote') this.setVisible(!this.visible);
      }),
    );
  }

  get isVisible(): boolean {
    return this.visible;
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    this.root.classList.toggle('is-hidden', !visible);
    if (visible) this.refresh(true);
    this.onToggle?.(visible);
  }

  /** Call every frame; only rebuilds the text every DEBUG_CONFIG.overlayRefreshMs. */
  refresh(force = false): void {
    if (!this.visible) return;
    const now = performance.now();
    if (!force && now - this.lastRefresh < DEBUG_CONFIG.overlayRefreshMs) return;
    this.lastRefresh = now;
    this.text.textContent = this.snapshot();
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.root.remove();
  }

  private readonly onCornerTap = (e: PointerEvent): void => {
    const c = DEBUG_CONFIG.gestureCornerPx;
    if (e.clientX > c || e.clientY > c) return;
    const now = performance.now();
    this.tapTimes.push(now);
    while (
      this.tapTimes.length > 0 &&
      now - (this.tapTimes[0] ?? 0) > DEBUG_CONFIG.gestureWindowMs
    ) {
      this.tapTimes.shift();
    }
    if (this.tapTimes.length >= DEBUG_CONFIG.gestureTaps) {
      this.tapTimes.length = 0;
      this.setVisible(!this.visible);
    }
  };
}
