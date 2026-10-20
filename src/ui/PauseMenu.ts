import { CAMERA_DISTANCE_PRESETS } from '../camera/cameraOptions';
import type { QualitySetting } from '../data/quality';
import type { FpsCap } from '../save/settings';
import { el, onTap } from './dom';
import { Segmented } from './Segmented';

export interface PauseMenuState {
  quality: QualitySetting;
  activeQualityLabel: string;
  fpsCap: FpsCap;
  debugOverlay: boolean;
  /** Camera distance multiplier (a preset value, or a custom one set in Settings). */
  cameraDistance: number;
  screenShake: number;
}

/** Screen shake steps offered in the pause menu (the full settings screen has a slider). */
export const PAUSE_SHAKE_STEPS = [0, 0.5, 1, 1.5] as const;

/** Nearest offered step, so a custom slider value still highlights the closest option. */
export function nearestStep(value: number, steps: readonly number[]): number {
  let best = steps[0] ?? value;
  for (const s of steps) if (Math.abs(s - value) < Math.abs(best - value)) best = s;
  return best;
}

export interface PauseMenuHandlers {
  readonly onResume: () => void;
  readonly onQuality: (q: QualitySetting) => void;
  readonly onFpsCap: (cap: FpsCap) => void;
  readonly onDebugOverlay: (on: boolean) => void;
  readonly onCameraDistance: (value: number) => void;
  readonly onScreenShake: (value: number) => void;
  readonly onFullscreen: () => void;
  readonly onRespawn: () => void;
  readonly onLeave: () => void;
  readonly onCopyLog: () => Promise<boolean>;
  readonly onUiTap: () => void;
}

/**
 * Pause menu: resume / restart / leave, quick settings (graphics, FPS, camera distance, screen
 * shake — the camera change is visible behind the menu right away) and "Copy debug log". The
 * full set of options lives in the Settings screen of the hub.
 */
export class PauseMenu {
  readonly root: HTMLElement;
  private readonly quality: Segmented<QualitySetting>;
  private readonly fps: Segmented<FpsCap>;
  private readonly debug: Segmented<'off' | 'on'>;
  private readonly camDistance: Segmented<number>;
  private readonly shake: Segmented<number>;
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
    this.camDistance = new Segmented<number>(
      'Camera',
      CAMERA_DISTANCE_PRESETS.map((p) => ({ value: p.value, label: p.label })),
      nearestStep(
        state.cameraDistance,
        CAMERA_DISTANCE_PRESETS.map((p) => p.value),
      ),
      (v) => {
        h.onUiTap();
        h.onCameraDistance(v);
      },
    );
    this.camDistance.root.dataset['testid'] = 'pause-camera';
    this.shake = new Segmented<number>(
      'Screen shake',
      PAUSE_SHAKE_STEPS.map((v) => ({ value: v, label: v === 0 ? 'Off' : `${v * 100}%` })),
      nearestStep(state.screenShake, PAUSE_SHAKE_STEPS),
      (v) => {
        h.onUiTap();
        h.onScreenShake(v);
      },
    );
    this.shake.root.dataset['testid'] = 'pause-shake';
    options.append(
      this.quality.root,
      this.activeQuality,
      this.fps.root,
      this.camDistance.root,
      this.shake.root,
      this.debug.root,
    );

    const row = el('div', 'button-row');
    row.append(
      this.button('Fullscreen', 'btn', () => {
        h.onUiTap();
        h.onFullscreen();
      }),
      this.button('Restart battle', 'btn', () => {
        h.onUiTap();
        h.onRespawn();
      }),
    );
    const leave = this.button('Leave battle', 'btn', () => {
      h.onUiTap();
      h.onLeave();
    });
    leave.dataset['testid'] = 'pause-leave';
    actions.append(leave);
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

  /** Re-reads values that may have changed elsewhere (the Settings screen) before showing. */
  sync(state: PauseMenuState): void {
    this.quality.set(state.quality);
    this.fps.set(state.fpsCap);
    this.debug.set(state.debugOverlay ? 'on' : 'off');
    this.camDistance.set(
      nearestStep(
        state.cameraDistance,
        CAMERA_DISTANCE_PRESETS.map((p) => p.value),
      ),
    );
    this.shake.set(nearestStep(state.screenShake, PAUSE_SHAKE_STEPS));
    this.setActiveQualityLabel(state.activeQualityLabel);
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
    this.camDistance.dispose();
    this.shake.dispose();
    this.root.remove();
  }

  private button(label: string, cls: string, fn: () => void): HTMLElement {
    const b = el('div', cls, label);
    b.setAttribute('role', 'button');
    this.disposers.push(onTap(b, fn));
    return b;
  }
}
