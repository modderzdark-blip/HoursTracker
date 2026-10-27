import './ui/styles.css';
import './ui/feel.css';
import './ui/feel-battle.css';
import './ui/feel-menus.css';
import './ui/feel-hub.css';
import './ui/hub.css';
import './ui/screens.css';
import { AudioManager } from './audio/AudioManager';
import { DEBUG_CONFIG } from './data/config';
import { loreTip } from './data/story';
import { copyText } from './debug/clipboard';
import { collectDeviceInfo } from './debug/deviceInfo';
import { installLogCapture } from './debug/LogCapture';
import { buildDebugReport } from './debug/report';
import { enterFullscreenLandscape, installGestureGuards } from './input/gestureGuards';
import { createBestBackend } from './save/backends';
import { SaveStore } from './save/SaveStore';
import { el } from './ui/dom';
import { showErrorScreen } from './ui/ErrorScreen';
import { TitleScreen } from './ui/TitleScreen';

// Capture logs before anything else can fail.
const log = installLogCapture(DEBUG_CONFIG.logCapacity);
console.info(`[app] Ashbound v${__APP_VERSION__} (${__BUILD_SHA__}) built ${__BUILD_TIME__}`);
installGestureGuards();

function requireElement<T extends HTMLElement>(id: string, type: { new (): T }): T {
  const node = document.getElementById(id);
  if (!(node instanceof type)) throw new Error(`#${id} missing`);
  return node;
}

const canvas = requireElement('game-canvas', HTMLCanvasElement);
const uiRoot = requireElement('ui-root', HTMLDivElement);

const rotate = el('div', 'rotate-hint');
rotate.append(el('div', 'rotate-hint-icon'), el('p', '', 'Rotate your phone to landscape'));
uiRoot.append(rotate);

const audio = new AudioManager();
// Every touch re-attempts the unlock (cheap no-op once running; resumes after interruptions).
window.addEventListener('pointerdown', () => audio.unlock(), { capture: true, passive: true });

const title = new TitleScreen(uiRoot, `v${__APP_VERSION__} · ${__BUILD_SHA__}`);
let tipSeed = Math.floor(Math.random() * 1000);
title.showTips(() => loreTip(tipSeed++));

function fatal(titleText: string, err: unknown): void {
  console.error('[app] fatal', err);
  const detail = err instanceof Error ? err.message : String(err);
  showErrorScreen(uiRoot, titleText, detail, () =>
    copyText(
      buildDebugReport({
        build: { version: __APP_VERSION__, sha: __BUILD_SHA__, time: __BUILD_TIME__ },
        device: collectDeviceInfo(null),
        stats: 'n/a (app did not start)',
        settings: null,
        log,
        maxEntries: 80,
      }),
    ),
  );
}

function hasWebGL2(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return gl !== null;
  } catch {
    return false;
  }
}

async function boot(): Promise<void> {
  if (!hasWebGL2()) {
    fatal('WebGL 2 unavailable', new Error('This browser or device does not support WebGL 2.'));
    return;
  }
  title.setStatus('Loading engine…');
  // The engine chunk (three.js + Rapier) loads lazily so the title appears immediately.
  const [appModule, store] = await Promise.all([
    import('./app/App'),
    createBestBackend().then((b) => new SaveStore(b)),
  ]);
  const loaded = await store.load();
  console.info(`[save] backend ${store.backend.name}, status ${loaded.status}`);
  title.setStatus('Preparing arena…');
  const app = await appModule.App.create({
    canvas,
    uiRoot,
    audio,
    store,
    save: loaded.data,
    log,
  });
  title.setReady(() => {
    audio.unlock();
    // Must run inside the tap: fullscreen + landscape lock need a user gesture.
    void enterFullscreenLandscape();
    title.hide();
    app.start();
  });
}

boot().catch((err: unknown) => fatal('Failed to start', err));
