import type { AudioManager } from '../audio/AudioManager';
import { FollowCamera } from '../camera/FollowCamera';
import { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import { GameClock } from '../core/GameClock';
import { GameLoop } from '../core/GameLoop';
import { ServiceRegistry } from '../core/ServiceRegistry';
import { TimeControl } from '../core/TimeControl';
import { TEST_ARENA } from '../data/arenas';
import { DEBUG_CONFIG, INPUT_CONFIG, LOOP_CONFIG } from '../data/config';
import { DEFAULT_HERO, HEROES } from '../data/heroes';
import { QUALITY_PRESETS, type QualityLevel, type QualityPreset } from '../data/quality';
import { DebugOverlay } from '../debug/DebugOverlay';
import { collectDeviceInfo, detectMobile, readHeapMB, type DeviceInfo } from '../debug/deviceInfo';
import { FrameStats } from '../debug/FrameStats';
import type { LogRing } from '../debug/LogCapture';
import { buildDebugReport } from '../debug/report';
import { copyText } from '../debug/clipboard';
import { INPUT_ACTIONS } from '../input/actions';
import { enterFullscreenLandscape } from '../input/gestureGuards';
import { GamepadInput } from '../input/GamepadInput';
import { InputState } from '../input/InputState';
import { KeyboardInput } from '../input/KeyboardInput';
import { TouchControls } from '../input/TouchControls';
import { TestArenaMode } from '../modes/TestArenaMode';
import { loadRapier, PhysicsWorld } from '../physics/PhysicsWorld';
import { QualityManager, type QualityTarget } from '../render/QualityManager';
import { guessInitialQuality } from '../render/qualityLogic';
import { RenderContext } from '../render/RenderContext';
import type { SaveData, SaveStore } from '../save/SaveStore';
import type { FpsCap } from '../save/settings';
import { el } from '../ui/dom';
import { Hud } from '../ui/Hud';
import { PauseMenu } from '../ui/PauseMenu';

export interface AppOptions {
  readonly canvas: HTMLCanvasElement;
  readonly uiRoot: HTMLElement;
  readonly audio: AudioManager;
  readonly store: SaveStore;
  readonly save: SaveData;
  readonly log: LogRing;
}

/** Late-bound services available through the registry (debug tools, test hooks). */
export interface AppServices {
  bus: EventBus<GameEvents>;
  time: TimeControl;
  clock: GameClock;
  input: InputState;
  quality: QualityManager;
  render: RenderContext;
}

export interface TestHookState {
  ready: boolean;
  running: boolean;
  paused: boolean;
  player: { x: number; y: number; z: number; grounded: boolean; speed: number; yaw: number };
  attacks: number;
  dodges: number;
  presses: Record<string, number>;
  ultimate: number;
  skillReady: boolean[];
  quality: QualityLevel;
  qualitySetting: string;
  benchmarkRunning: boolean;
  fps: number;
  frames: number;
  drawCalls: number;
  triangles: number;
  heapMB: number | null;
  errors: number;
  activeTouches: number;
  joystickActive: boolean;
  debugOverlay: boolean;
}

declare global {
  interface Window {
    __ashbound?: {
      version: string;
      state: () => TestHookState;
      setPaused: (paused: boolean) => void;
    };
  }
}

const BUILD = { version: __APP_VERSION__, sha: __BUILD_SHA__, time: __BUILD_TIME__ };

function probeDevice(): DeviceInfo {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  const info = collectDeviceInfo(gl);
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  return info;
}

export class App {
  readonly bus = new EventBus<GameEvents>();
  readonly services = new ServiceRegistry<AppServices>();
  readonly time = new TimeControl();
  readonly clock = new GameClock();
  private readonly ctx: RenderContext;
  private readonly camera: FollowCamera;
  private readonly physics: PhysicsWorld;
  private readonly input: InputState;
  private readonly touch: TouchControls;
  private readonly keyboard: KeyboardInput;
  private readonly gamepad: GamepadInput;
  private readonly mode: TestArenaMode;
  private readonly quality: QualityManager;
  private readonly loop: GameLoop;
  private readonly hud: Hud;
  private readonly pause: PauseMenu;
  private readonly overlay: DebugOverlay;
  private readonly stats = new FrameStats(DEBUG_CONFIG.statsWindowFrames);
  private readonly vignette: HTMLElement;
  private readonly device: DeviceInfo;
  private readonly disposers: (() => void)[] = [];
  private saveTimer = 0;
  private resizePending = false;
  private running = false;

  static async create(opts: AppOptions): Promise<App> {
    const rapier = await loadRapier();
    return new App(opts, new PhysicsWorld(rapier));
  }

  private constructor(
    private readonly opts: AppOptions,
    physics: PhysicsWorld,
  ) {
    this.physics = physics;
    const settings = opts.save.settings;

    // --- Rendering & quality -------------------------------------------------------------
    // Probe the GPU on a throwaway canvas: calling getContext on the game canvas would lock its
    // context attributes (antialias) before three.js gets to choose them.
    this.device = probeDevice();
    const guessed = guessInitialQuality({
      isMobile: detectMobile(),
      deviceMemoryGB: this.device.deviceMemoryGB,
      cores: this.device.cores,
      gpu: this.device.gpuRenderer,
    });
    const startLevel: QualityLevel =
      settings.quality === 'auto' ? (settings.detectedQuality ?? guessed) : settings.quality;
    this.ctx = new RenderContext(opts.canvas, QUALITY_PRESETS[startLevel].antialias);
    this.camera = new FollowCamera(window.innerWidth / Math.max(window.innerHeight, 1));
    this.ctx.setSize(
      window.innerWidth,
      window.innerHeight,
      QUALITY_PRESETS[startLevel].maxPixelRatio,
    );

    // --- Input -------------------------------------------------------------------------
    this.input = new InputState(INPUT_CONFIG.bufferMs, () => this.clock.nowMs, this.bus);
    this.touch = new TouchControls(opts.uiRoot, this.input);
    this.keyboard = new KeyboardInput(this.input);
    this.gamepad = new GamepadInput(this.input);

    // --- World -------------------------------------------------------------------------
    this.mode = new TestArenaMode({
      ctx: this.ctx,
      physics: this.physics,
      camera: this.camera,
      input: this.input,
      bus: this.bus,
      arena: TEST_ARENA,
      hero: HEROES[DEFAULT_HERO],
      preset: QUALITY_PRESETS[startLevel],
    });

    // --- UI ----------------------------------------------------------------------------
    this.vignette = el('div', 'vignette');
    opts.uiRoot.prepend(this.vignette);
    this.hud = new Hud(opts.uiRoot, TEST_ARENA.name, () => this.setPaused(true));
    this.pause = new PauseMenu(
      opts.uiRoot,
      {
        quality: settings.quality,
        activeQualityLabel: '',
        fpsCap: settings.fpsCap,
        debugOverlay: settings.showDebugOverlay,
      },
      {
        onResume: () => this.setPaused(false),
        onQuality: (q) => {
          settings.quality = q;
          if (q === 'auto') settings.detectedQuality = null;
          this.quality.setSetting(q, this.quality.level, settings.detectedQuality);
          this.updateQualityLabel();
          this.persistSoon();
        },
        onFpsCap: (cap: FpsCap) => {
          settings.fpsCap = cap;
          if (!this.quality.benchmarkRunning) this.loop.limiter.setCap(cap);
          this.persistSoon();
        },
        onDebugOverlay: (on) => this.overlay.setVisible(on),
        onFullscreen: () => {
          void enterFullscreenLandscape();
        },
        onRespawn: () => {
          this.mode.respawn();
          this.setPaused(false);
        },
        onCopyLog: () => this.copyDebugLog(),
        onUiTap: () => opts.audio.playUiClick(),
      },
    );
    this.overlay = new DebugOverlay(opts.uiRoot, () => this.debugText(), [
      {
        label: 'Shake',
        run: () => this.bus.emit('camera:shake', { trauma: DEBUG_CONFIG.cheats.shakeTrauma }),
      },
      {
        label: 'Hitstop',
        run: () => this.bus.emit('time:hitStop', { ms: DEBUG_CONFIG.cheats.hitStopMs }),
      },
      {
        label: 'Slowmo',
        run: () =>
          this.bus.emit('time:slowMotion', {
            scale: DEBUG_CONFIG.cheats.slowMoScale,
            ms: DEBUG_CONFIG.cheats.slowMoMs,
          }),
      },
      {
        label: 'Fill ULT',
        run: () => {
          this.mode.ultimate.add(1);
          this.bus.emit('ultimate:charge', { value: this.mode.ultimate.value });
        },
      },
      { label: 'CD', run: () => this.mode.cooldowns.resetAll() },
      { label: 'Flash', run: () => this.mode.player.visual.triggerFlash() },
    ]);
    this.overlay.onToggle = (visible) => {
      settings.showDebugOverlay = visible;
      this.pause.setDebugOverlay(visible);
      this.persistSoon();
    };
    if (settings.showDebugOverlay) this.overlay.setVisible(true);

    // --- Loop & quality ----------------------------------------------------------------
    this.loop = new GameLoop(
      {
        stepHz: LOOP_CONFIG.logicHz,
        maxSubSteps: LOOP_CONFIG.maxSubSteps,
        maxFrameMs: LOOP_CONFIG.maxFrameMs,
      },
      this.time,
      {
        preUpdate: () => this.gamepad.poll(),
        fixedUpdate: (dt) => {
          this.clock.tick(dt);
          this.mode.fixedUpdate(dt);
        },
        render: (alpha, dt) => this.renderFrame(alpha, dt),
        frameEnd: (interval, steps) => {
          this.stats.push(interval, steps);
          this.quality.onFrame(interval);
          this.overlay.refresh();
        },
      },
      settings.fpsCap,
    );

    this.quality = new QualityManager(settings.quality, startLevel, this.bus);
    const rendererTarget: QualityTarget = {
      applyQuality: (preset: QualityPreset) => this.applyRendererQuality(preset),
    };
    this.quality.addTarget(rendererTarget);
    this.quality.addTarget(this.mode);
    this.quality.onDetected = (level) => {
      settings.detectedQuality = level;
      this.updateQualityLabel();
      this.persistSoon();
      this.hud.showToast(`Graphics: ${QUALITY_PRESETS[level].label} (auto)`);
    };
    this.quality.onBenchmarkStateChange = (running) => {
      // Benchmark measures uncapped frame times; the user's cap returns afterwards.
      this.loop.limiter.setCap(running ? 0 : settings.fpsCap);
      this.updateQualityLabel();
    };
    this.updateQualityLabel();

    this.services.register('bus', this.bus);
    this.services.register('time', this.time);
    this.services.register('clock', this.clock);
    this.services.register('input', this.input);
    this.services.register('quality', this.quality);
    this.services.register('render', this.ctx);

    this.wireEvents();
    this.installTestHook();
    // Render once behind the title screen so shaders compile before the first real frame.
    this.ctx.render(this.camera.camera);
  }

  /** Called from the title screen tap. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.touch.setVisible(true);
    this.hud.setVisible(true);
    this.loop.start();
    const s = this.opts.save.settings;
    if (s.quality === 'auto' && s.detectedQuality === null) this.quality.startBenchmark();
    this.updateQualityLabel();
    console.info(`[app] started; quality ${this.quality.level} (${this.quality.setting})`);
  }

  setPaused(paused: boolean): void {
    if (paused === this.loop.isPaused) return;
    this.loop.setPaused(paused);
    this.touch.setEnabled(!paused);
    this.keyboard.enabled = !paused;
    this.gamepad.enabled = !paused;
    if (paused) {
      this.input.releaseAll();
      this.pause.show();
    } else {
      this.pause.hide();
    }
    this.bus.emit('game:paused', { paused });
  }

  private wireEvents(): void {
    const b = this.bus;
    this.disposers.push(
      b.on('camera:shake', (e) => this.camera.shake.addTrauma(e.trauma)),
      b.on('time:hitStop', (e) => this.time.hitStop(e.ms)),
      b.on('time:slowMotion', (e) => this.time.slowMotion(e.scale, e.ms)),
      b.on('ultimate:charge', (e) => this.touch.setUltimateCharge(e.value)),
      b.on('input:pressed', (e) => {
        if (e.action === 'pause' && this.running) this.setPaused(!this.loop.isPaused);
      }),
    );
    const onResize = (): void => {
      if (this.resizePending) return;
      this.resizePending = true;
      requestAnimationFrame(() => {
        this.resizePending = false;
        this.resize();
      });
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    const onVisibility = (): void => {
      const hidden = document.hidden;
      this.opts.audio.setHidden(hidden);
      b.emit('app:visibility', { hidden });
      if (hidden && this.running) {
        this.setPaused(true);
        this.flushSave();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    const onPageHide = (): void => this.flushSave();
    window.addEventListener('pagehide', onPageHide);
    this.disposers.push(() => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    });
    this.touch.setVisible(false);
    this.hud.setVisible(false);
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.ctx.setSize(w, h, this.quality.preset.maxPixelRatio);
    this.camera.setAspect(w / Math.max(h, 1));
    this.mode.applyQuality(this.quality.preset, this.quality.level);
    this.loop.requestRender();
  }

  private applyRendererQuality(preset: QualityPreset): void {
    this.ctx.setSize(window.innerWidth, window.innerHeight, preset.maxPixelRatio);
    this.ctx.setBloom(preset.bloom, this.camera.camera);
    this.vignette.classList.toggle('is-hidden', !preset.vignette);
    this.loop.requestRender();
  }

  private renderFrame(alpha: number, dtSec: number): void {
    this.mode.render(alpha, dtSec);
    const cd = this.mode.cooldowns;
    for (let i = 0; i < cd.count; i++) {
      this.touch.setSkillCooldown(i, cd.fraction(i), cd.remainingMs(i) / 1000);
    }
    this.ctx.render(this.camera.camera);
  }

  private updateQualityLabel(): void {
    const q = this.quality;
    const running = q.benchmarkRunning ? ' — measuring…' : '';
    const auto = q.setting === 'auto' ? 'auto-detected ' : '';
    this.pause.setActiveQualityLabel(`Active: ${auto}${q.preset.label}${running}`);
  }

  private persistSoon(): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flushSave(), 400);
  }

  private flushSave(): void {
    window.clearTimeout(this.saveTimer);
    this.opts.store
      .save(this.opts.save)
      .catch((err: unknown) => console.warn('[save] write failed', err));
  }

  private debugText(): string {
    const s = this.stats;
    const r = this.ctx.info;
    const mem = this.ctx.renderer.info.memory;
    const progs = this.ctx.renderer.info.programs?.length ?? 0;
    const p = this.mode.player;
    const heap = readHeapMB();
    const [bw, bh] = this.ctx.drawingBufferSize;
    const mv = this.input.readMove({ x: 0, y: 0 });
    const q = this.quality;
    const lines = [
      `FPS ${s.fps.toFixed(1)}  frame ${s.meanMs.toFixed(1)}ms  p95 ${s.percentileMs(95).toFixed(1)}  max ${s.maxMs.toFixed(1)}`,
      `logic ${LOOP_CONFIG.logicHz}Hz steps ${s.lastSteps}  dropped ${this.loop.timestep.droppedMs.toFixed(0)}ms  cap ${this.loop.limiter.capFps || 'off'}`,
      `draws ${r.calls}  tris ${(r.triangles / 1000).toFixed(1)}k  pts ${r.points}`,
      `geo ${mem.geometries}  tex ${mem.textures}  progs ${progs}`,
      `entities 1  particles ${this.mode.particleCount}  colliders ${this.physics.colliderCount}`,
      `heap ${heap ? `${heap.used.toFixed(1)} / ${heap.limit.toFixed(0)} MB` : 'n/a (Chrome only)'}`,
      `quality ${q.preset.label} (${q.setting})${q.benchmarkRunning ? ' benchmarking' : ''}  bench ${q.lastBenchmarkMedianMs > 0 ? `${q.lastBenchmarkMedianMs.toFixed(1)}ms` : '—'}`,
      `DPR ${window.devicePixelRatio.toFixed(2)}→${this.ctx.currentPixelRatio.toFixed(2)}  view ${window.innerWidth}x${window.innerHeight}  buffer ${bw}x${bh}`,
      `pos ${p.currFeet.x.toFixed(2)}, ${p.currFeet.y.toFixed(2)}, ${p.currFeet.z.toFixed(2)}  ${p.body.grounded ? 'grounded' : 'AIR'}  v ${p.motor.planarSpeed.toFixed(2)}`,
      `move ${mv.x.toFixed(2)}, ${mv.y.toFixed(2)}  touches ${this.touch.activeButtonCount}${this.touch.joystickActive ? '+stick' : ''}  atk ${this.mode.attacksPerformed}  dodge ${this.mode.dodgesPressed}`,
      `time ${this.time.isFrozen ? 'HITSTOP' : this.time.isSlowed ? 'SLOW' : 'normal'}  trauma ${this.camera.shake.currentTrauma.toFixed(2)}  log ${this.opts.log.errorCount}E/${this.opts.log.warnCount}W`,
    ];
    return lines.join('\n');
  }

  private copyDebugLog(): Promise<boolean> {
    const report = buildDebugReport({
      build: BUILD,
      device: {
        ...this.device,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        fullscreen: document.fullscreenElement !== null,
      },
      stats: this.debugText(),
      settings: this.opts.save.settings,
      log: this.opts.log,
      maxEntries: 80,
    });
    return copyText(report);
  }

  private installTestHook(): void {
    window.__ashbound = {
      version: `${BUILD.version}+${BUILD.sha}`,
      setPaused: (paused) => this.setPaused(paused),
      state: () => {
        const p = this.mode.player;
        const heap = readHeapMB();
        const presses: Record<string, number> = {};
        for (const a of INPUT_ACTIONS) presses[a] = this.input.pressCount(a);
        return {
          ready: true,
          running: this.running,
          paused: this.loop.isPaused,
          player: {
            x: p.currFeet.x,
            y: p.currFeet.y,
            z: p.currFeet.z,
            grounded: p.body.grounded,
            speed: p.motor.planarSpeed,
            yaw: p.motor.yaw,
          },
          attacks: this.mode.attacksPerformed,
          dodges: this.mode.dodgesPressed,
          presses,
          ultimate: this.mode.ultimate.value,
          skillReady: [0, 1, 2].map((i) => this.mode.cooldowns.isReady(i)),
          quality: this.quality.level,
          qualitySetting: this.quality.setting,
          benchmarkRunning: this.quality.benchmarkRunning,
          fps: this.stats.fps,
          frames: this.stats.totalFrames,
          drawCalls: this.ctx.info.calls,
          triangles: this.ctx.info.triangles,
          heapMB: heap ? heap.used : null,
          errors: this.opts.log.errorCount,
          activeTouches: this.touch.activeButtonCount,
          joystickActive: this.touch.joystickActive,
          debugOverlay: this.overlay.isVisible,
        };
      },
    };
  }

  dispose(): void {
    this.loop.stop();
    for (const d of this.disposers) d();
    this.mode.dispose();
    this.touch.dispose();
    this.keyboard.dispose();
    this.gamepad.dispose();
    this.hud.dispose();
    this.pause.dispose();
    this.overlay.dispose();
    this.vignette.remove();
    this.physics.dispose();
    this.ctx.dispose();
    this.bus.clear();
    delete window.__ashbound;
  }
}
