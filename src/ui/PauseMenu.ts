import type { QualitySetting } from '../data/quality';
import type { FpsCap } from '../save/settings';
import { el, onTap } from './dom';
import { Segmented } from './Segmented';

export interface PauseMenuState {
  quality: QualitySetting;
  activeQualityLabel: string;
  fpsCap: FpsCap;
  debugOverlay: boolean;
}

export interface PauseMenuHandlers {
  readonly onResume: () => void;
  readonly onQuality: (q: QualitySetting) => void;
  readonly onFpsCap: (cap: FpsCap) => void;
  readonly onDebugOverlay: (on: boolean) => void;
  readonly onFullscreen: () => void;
  readonly onRespawn: () => void;
  readonly onCopyLog: () => Promise<boolean>;
  readonly onUiTap: () => void;
}

/** Pause menu with the M1 settings subset and the "Copy debug log" button. */
export class PauseMenu {
  readonly root: HTMLElement;
  private readonly quality: Segmented<QualitySetting>;
  private readonly fps: Segmented<FpsCap>;
  private readonly debug: Segmented<'off' | 'on'>;
  private readonly activeQuality: HTMLElement;
  private readonly copyResult: HTMLElement;
  private readonly disposers: (() => void)[] = [];
  private open = false;

  constructor(container: HTMLElement, state: PauseMenuState, h: PauseMenuHandlers) {
    this.root = el('div', 'screen pause-menu is-hidden');
    this.root.dataset['testid'] = 'pause-menu';
    const panel = el('div', 'panel panel-scroll panel-wide');
    panel.dataset['allowScroll'] = '';
    panel.append(el('h2', 'panel-title', 'Paused'));
    // Two columns in landscape so everything fits on a ~400 px tall phone without scrolling.
    const grid = el('div', 'pause-grid');
    const actions = el('div', 'pause-col');
    const options = el('div', 'pause-col');
    grid.append(actions, options);
    panel.append(grid);

    const resume = this.button('Resume', 'btn btn-primary', () => h.onResume());
    resume.dataset['testid'] = 'pause-resume';
    actions.append(resume);

    this.quality = new Segmented<QualitySetting>(
      'Graphics',
      [
        { value: 'auto', label: 'Auto' },
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Med' },
        { value: 'high', label: 'High' },
      ],
      state.quality,
      (v) => {
        h.onUiTap();
        h.onQuality(v);
      },
    );
    this.activeQuality = el('p', 'panel-note', '');
    this.fps = new Segmented<FpsCap>(
      'FPS cap',
      [
        { value: 30, label: '30' },
        { value: 60, label: '60' },
      ],
      state.fpsCap,
      (v) => {
        h.onUiTap();
        h.onFpsCap(v);
      },
    );
    this.debug = new Segmented<'off' | 'on'>(
      'Debug overlay',
      [
        { value: 'off', label: 'Off' },
        { value: 'on', label: 'On' },
      ],
      state.debugOverlay ? 'on' : 'off',
      (v) => {
        h.onUiTap();
        h.onDebugOverlay(v === 'on');
      },
    );
    options.append(this.quality.root, this.activeQuality, this.fps.root, this.debug.root);

    const row = el('div', 'button-row');
    row.append(
      this.button('Fullscreen', 'btn', () => {
        h.onUiTap();
        h.onFullscreen();
      }),
      this.button('Respawn', 'btn', () => {
        h.onUiTap();
        h.onRespawn();
      }),
    );
    actions.append(row);

    const copy = this.button('Copy debug log', 'btn btn-accent', () => {
      h.onUiTap();
      this.copyResult.textContent = 'Copying…';
      h.onCopyLog()
        .then((ok) => {
          this.copyResult.textContent = ok
            ? 'Debug log copied — paste it into your bug report.'
            : 'Copy failed — the browser blocked clipboard access.';
        })
        .catch(() => {
          this.copyResult.textContent = 'Copy failed.';
        });
    });
    copy.dataset['testid'] = 'copy-log';
    this.copyResult = el('p', 'panel-note', '');
    this.copyResult.dataset['testid'] = 'copy-result';
    actions.append(copy);
    options.append(this.copyResult);

    this.root.append(panel);
    container.append(this.root);
    this.setActiveQualityLabel(state.activeQualityLabel);
  }

  get isOpen(): boolean {
    return this.open;
  }

  show(): void {
    this.open = true;
    this.copyResult.textContent = '';
    this.root.classList.remove('is-hidden');
  }

  hide(): void {
    this.open = false;
    this.root.classList.add('is-hidden');
  }

  setActiveQualityLabel(text: string): void {
    this.activeQuality.textContent = text;
  }

  setDebugOverlay(on: boolean): void {
    this.debug.set(on ? 'on' : 'off');
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.quality.dispose();
    this.fps.dispose();
    this.debug.dispose();
    this.root.remove();
  }

  private button(label: string, cls: string, fn: () => void): HTMLElement {
    const b = el('div', cls, label);
    b.setAttribute('role', 'button');
    this.disposers.push(onTap(b, fn));
    return b;
  }
}
