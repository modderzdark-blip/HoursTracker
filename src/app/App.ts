import { Scene } from 'three';
import type { AudioManager } from '../audio/AudioManager';
import { Music } from '../audio/Music';
import { Stingers } from '../audio/Stingers';
import { resolveCameraOptions } from '../camera/cameraOptions';
import { FollowCamera } from '../camera/FollowCamera';
import { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import { GameClock } from '../core/GameClock';
import { GameLoop } from '../core/GameLoop';
import { mulberry32 } from '../core/random';
import { ServiceRegistry } from '../core/ServiceRegistry';
import { TimeControl } from '../core/TimeControl';
import { DEBUG_CONFIG, INPUT_CONFIG, LOOP_CONFIG } from '../data/config';
import type { Currency } from '../data/economy';
import type { DifficultyId } from '../data/difficulty';
import { HEROES, type HeroId } from '../data/heroes';
import { CHAPTERS } from '../data/stages';
import { ACHIEVEMENTS } from '../data/goals';
import { loreTip, PROLOGUE } from '../data/story';
import { goalsReached, type GoalSnapshot } from '../progression/feel';
import { questDef } from '../progression/goals';
import {
  BLOOM_CONFIG,
  postSettingsFor,
  QUALITY_PRESETS,
  type QualityLevel,
  type QualityPreset,
  type QualitySetting,
} from '../data/quality';
import { DebugOverlay } from '../debug/DebugOverlay';
import { collectDeviceInfo, detectMobile, readHeapMB, type DeviceInfo } from '../debug/deviceInfo';
import { FrameStats } from '../debug/FrameStats';
import type { LogRing } from '../debug/LogCapture';
import { buildDebugReport } from '../debug/report';
import { copyText } from '../debug/clipboard';
import { INPUT_ACTIONS } from '../input/actions';
import { resolveAimAssist, setAimAssist } from '../input/aimAssist';
import { enterFullscreenLandscape } from '../input/gestureGuards';
import { GamepadInput } from '../input/GamepadInput';
import { InputState } from '../input/InputState';
import { KeyboardInput } from '../input/KeyboardInput';
import { TouchControls } from '../input/TouchControls';
import { BattleMode, type BattleOutcome, type BattleSetup } from '../modes/BattleMode';
import { HubScene } from '../modes/HubScene';
import { loadRapier, PhysicsWorld, type Rapier } from '../physics/PhysicsWorld';
import { PlayerProfile } from '../progression/PlayerProfile';
import { QualityManager, type QualityTarget } from '../render/QualityManager';
import { autoQualityCeiling, guessInitialQuality } from '../render/qualityLogic';
import { setCharacterLight } from '../render/rimLight';
import { createCharacterEnvironment, setCharacterEnvironment } from '../render/characterEnv';
import { RenderContext } from '../render/RenderContext';
import type { SaveData, SaveStore } from '../save/SaveStore';
import {
  cameraDefaults,
  qualityOverridesFrom,
  resetSettings,
  sanitizeSettings,
  vibrationMs,
  type FpsCap,
} from '../save/settings';
import { el } from '../ui/dom';
import { Hud } from '../ui/Hud';
import type { SettingsPort } from '../ui/menu/context';
import { PauseMenu } from '../ui/PauseMenu';
import { GoalToasts } from '../ui/GoalToasts';
import { LoadingVeil } from '../ui/LoadingVeil';
import { StoryCards } from '../ui/StoryCards';
import { Menus } from './Menus';
import { Runs } from './Runs';
import { arenaAssetRequest } from '../data/arenaAssets';
import { AssetLibrary } from '../render/env/AssetLibrary';
import { modeScreens } from '../ui/menu/modeScreens';
import { setColorblindTelegraphs } from '../vfx/TelegraphDecals';

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
  /** 'battle' during a fight, otherwise the menu screen id ('hub', 'map', 'victory', ...). */
  screen: string;
  player: {
    x: number;
    y: number;
    z: number;
    grounded: boolean;
    speed: number;
    yaw: number;
    hp: number;
    maxHp: number;
    state: string;
    comboIndex: number;
    action: string | null;
  };
  presses: Record<string, number>;
  ultimate: number;
  skillReady: boolean[];
  stage: {
    id: string;
    phase: string;
    wave: number;
    enemiesAlive: number;
    killed: number;
    result: string | null;
    timeSec: number;
  };
  boss: {
    active: boolean;
    hp: number;
    maxHp: number;
    phase: number;
    state: string;
    breakFrac: number;
  };
  hero: { id: string; level: number; xp: number; power: number };
  items: number;
  wallet: Record<string, number>;
  tokensInUse: number;
  telegraphs: number;
  effects: { projectiles: number; zones: number };
  cinematic: boolean;
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
  move: { x: number; y: number };
  debugOverlay: boolean;
  /** Live values the settings drive (e2e checks that options really apply). */
  camera: { distance: number; height: number; fov: number; shake: number };
  pixelRatio: number;
  preset: { shadows: boolean; bloom: boolean; particleCount: number };
}

export interface TestHookCommands {
  setPaused: (paused: boolean) => void;
  skipCountdown: () => void;
  killAll: () => void;
  skipToBoss: () => void;
  damageBoss: (frac: number) => void;
  killBoss: () => void;
  damagePlayer: (frac: number) => void;
  setGod: (on: boolean) => void;
  fillUltimate: () => void;
  restart: () => void;
  startStage: (stageId: string, difficulty?: DifficultyId) => void;
  setQuality: (q: QualitySetting) => void;
  grant: (currency: Currency, amount: number) => void;
  goHub: () => void;
  /** Test/debug: unlock and select a hero. */
  setHero: (id: HeroId) => void;
  /** Test/debug: mark the first `count` Adventure stages cleared (3 stars, Normal). */
  clearStages: (count: number) => void;
  /** Test/debug: kill the arena duelist. */
  killDuelist: () => void;
}

declare global {
  interface Window {
    __ashbound?: { version: string; state: () => TestHookState } & TestHookCommands;
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

/**
 * Composition root. Owns the renderer, loop, input, quality, HUD shell, debug tools and the
 * player profile; switches between the hub (menus over a 3D hero preview) and battles (a fresh
 * BattleMode with its own scene and physics world per fight).
 */
export class App {
  readonly bus = new EventBus<GameEvents>();
  readonly services = new ServiceRegistry<AppServices>();
  readonly time = new TimeControl();
  readonly clock = new GameClock();
  private readonly ctx: RenderContext;
  private readonly camera: FollowCamera;
  private readonly input: InputState;
  private readonly touch: TouchControls;
  private readonly keyboard: KeyboardInput;
  private readonly gamepad: GamepadInput;
  private readonly quality: QualityManager;
  private readonly loop: GameLoop;
  private readonly hud: Hud;
  private readonly pause: PauseMenu;
  private readonly overlay: DebugOverlay;
  private readonly stats = new FrameStats(DEBUG_CONFIG.statsWindowFrames);
  private readonly vignette: HTMLElement;
  private readonly device: DeviceInfo;
  private readonly disposers: (() => void)[] = [];
  private readonly profile: PlayerProfile;
  private readonly menus: Menus;
  private readonly hubScene: HubScene;
  private readonly rng = mulberry32((Date.now() & 0x7fffffff) | 1);
  private battle: BattleMode | null = null;
  private battlePhysics: PhysicsWorld | null = null;
  private readonly runs: Runs;
  private readonly music: Music;
  private readonly stingers: Stingers;
  private story: StoryCards | null = null;
  private readonly goalToasts: GoalToasts;
  private goalBase: GoalSnapshot;
  private readonly veil: LoadingVeil;
  /** Scanned arena assets, loaded per arena while the loading veil shows. */
  private readonly assets = new AssetLibrary();
  /** Bumped per battle start (a newer start cancels a pending one). */
  private battleToken = 0;
  private lastCoinMs = 0;
  private pendingOutcome: BattleOutcome | null = null;
  private saveTimer = 0;
  private resizePending = false;
  private appliedRenderScale = 1;
  private fpsRefreshMs = 0;
  private running = false;
  private inputEnabled = true;

  static async create(opts: AppOptions): Promise<App> {
    const rapier = await loadRapier();
    return new App(opts, rapier);
  }

  private constructor(
    private readonly opts: AppOptions,
    private readonly rapier: Rapier,
  ) {
    const settings = opts.save.settings;

    // --- Rendering & quality -------------------------------------------------------------
    // Probe the GPU on a throwaway canvas: calling getContext on the game canvas would lock its
    // context attributes (antialias) before three.js gets to choose them.
    this.device = probeDevice();
    const hints = {
      isMobile: detectMobile(),
      deviceMemoryGB: this.device.deviceMemoryGB,
      cores: this.device.cores,
      gpu: this.device.gpuRenderer,
    };
    const guessed = guessInitialQuality(hints);
    const startLevel: QualityLevel =
      settings.quality === 'auto' ? (settings.detectedQuality ?? guessed) : settings.quality;
    this.ctx = new RenderContext(opts.canvas, QUALITY_PRESETS[startLevel].antialias);
    // Reflections for character metal/leather (rigs created after this pick it up).
    setCharacterEnvironment(createCharacterEnvironment(this.ctx.renderer));
    const aspect = window.innerWidth / Math.max(window.innerHeight, 1);
    this.camera = new FollowCamera(aspect, resolveCameraOptions(settings));
    this.appliedRenderScale = settings.renderScale;
    this.ctx.setSize(
      window.innerWidth,
      window.innerHeight,
      QUALITY_PRESETS[startLevel].maxPixelRatio,
      this.renderScale(),
    );

    // --- Profile -----------------------------------------------------------------------
    this.profile = new PlayerProfile(opts.save, () => this.persistSoon(), this.rng);

    // --- Input -------------------------------------------------------------------------
    this.input = new InputState(INPUT_CONFIG.bufferMs, () => this.clock.nowMs, this.bus);
    this.touch = new TouchControls(opts.uiRoot, this.input);
    this.music = new Music(opts.audio);
    this.stingers = new Stingers(opts.audio);
    this.keyboard = new KeyboardInput(this.input);
    this.gamepad = new GamepadInput(this.input);

    // --- UI shell (vignette under everything, HUD with pause + toasts) -------------------
    this.vignette = el('div', 'vignette');
    opts.uiRoot.prepend(this.vignette);
    this.hud = new Hud(opts.uiRoot, '', () => this.setPaused(true));

    // --- Hub ---------------------------------------------------------------------------
    this.hubScene = new HubScene(this.ctx.renderer);
    this.hubScene.setAspect(aspect);
    this.hubScene.setHero(HEROES[this.profile.selectedHero]);
    this.menus = new Menus({
      uiRoot: opts.uiRoot,
      profile: this.profile,
      actions: {
        startAdventure: (stageId, difficulty) => this.runs.startAdventure(stageId, difficulty),
        startDungeon: (difficulty) => this.runs.startDungeon(difficulty),
        startTower: (floor) => this.runs.startTower(floor),
        startChallenge: (entry, tier) => this.runs.startChallenge(entry, tier),
        startHunt: (hunt) => this.runs.startHunt(hunt),
        startArena: (opponent) => this.runs.startArena(opponent),
      },
      settings: this.settingsPort(),
      uiTap: () => opts.audio.playUiClick(),
      toast: (t) => this.hud.showToast(t, 2200),
      stingers: this.stingers,
      onHeroChanged: (id: HeroId) => this.hubScene.setHero(HEROES[id]),
      modeScreens,
    });
    this.goalToasts = new GoalToasts(opts.uiRoot, () => this.stingers.play('goal'));
    this.goalBase = this.profile.goalSnapshot();
    this.veil = new LoadingVeil(opts.uiRoot);
    this.menus.shell.onScreen = (id) => {
      // Goals reached in battle are announced once the result screens are behind us.
      if (id !== 'victory' && id !== 'defeat' && id !== 'interlude') this.announceGoals();
    };
    this.menus.shell.onGain = () => {
      const now = performance.now();
      if (now - this.lastCoinMs < 150) return;
      this.lastCoinMs = now;
      this.stingers.play('coin', 4, 0.8);
    };
    this.runs = new Runs({
      profile: this.profile,
      menus: this.menus,
      rng: this.rng,
      startBattle: (setup) => this.startBattle(setup),
      refreshHub: () => this.hubScene.setHero(HEROES[this.profile.selectedHero]),
    });

    this.pause = new PauseMenu(
      opts.uiRoot,
      {
        quality: settings.quality,
        activeQualityLabel: '',
        fpsCap: settings.fpsCap,
        debugOverlay: settings.showDebugOverlay,
        cameraDistance: settings.cameraDistance,
        screenShake: settings.screenShake,
      },
      {
        onResume: () => this.setPaused(false),
        onQuality: (q) => this.settingsPort().setQuality(q),
        onFpsCap: (cap: FpsCap) => this.settingsPort().setFpsCap(cap),
        onDebugOverlay: (on) => this.overlay.setVisible(on),
        onCameraDistance: (value) => this.settingsPort().update({ cameraDistance: value }),
        onScreenShake: (value) => this.settingsPort().update({ screenShake: value }),
        onFullscreen: () => {
          void enterFullscreenLandscape();
        },
        onRespawn: () => {
          this.battle?.startRun();
          this.setPaused(false);
        },
        onLeave: () => {
          this.setPaused(false);
          this.battle?.abandon();
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
        label: 'Slowmo',
        run: () =>
          this.bus.emit('time:slowMotion', {
            scale: DEBUG_CONFIG.cheats.slowMoScale,
            ms: DEBUG_CONFIG.cheats.slowMoMs,
          }),
      },
      { label: 'ULT', run: () => this.fillUltimate() },
      { label: 'CD', run: () => this.battle?.player.cooldowns.resetAll() },
      {
        label: 'God',
        run: () => {
          const b = this.battle;
          if (b === null) return;
          b.player.god = !b.player.god;
          this.hud.showToast(b.player.god ? 'God mode ON' : 'God mode OFF');
        },
      },
      { label: 'Kill', run: () => this.battle?.killAllEnemies() },
      { label: 'Boss', run: () => this.battle?.skipToBoss() },
      { label: '-50%', run: () => this.battle?.damageBoss(0.35) },
      {
        label: '+Gold',
        run: () => {
          this.grant('gold', 5000);
          this.grant('materials', 200);
          this.grant('souls', 200);
        },
      },
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
          const b = this.battle;
          if (b === null || this.pendingOutcome !== null) return;
          this.clock.tick(dt);
          b.fixedUpdate(dt);
        },
        render: (alpha, dt) => this.renderFrame(alpha, dt),
        frameEnd: (interval, steps) => {
          this.stats.push(interval, steps);
          this.refreshFpsCounter(interval);
          if (this.battle !== null) this.quality.onFrame(interval);
          this.overlay.refresh();
          if (this.pendingOutcome !== null) this.handleOutcome();
        },
      },
      settings.fpsCap,
    );

    this.quality = new QualityManager(settings.quality, startLevel, this.bus);
    // Auto only climbs to Ultra on clearly strong devices.
    this.quality.autoCeiling = autoQualityCeiling(hints);
    this.quality.setOverrides(qualityOverridesFrom(settings));
    const rendererTarget: QualityTarget = {
      applyQuality: (preset: QualityPreset) => this.applyRendererQuality(preset),
    };
    this.quality.addTarget(rendererTarget);
    this.quality.onDetected = (level) => {
      settings.detectedQuality = level;
      this.updateQualityLabel();
      this.persistSoon();
      // No toast: it would pop up mid-fight. The detected level shows in Settings and Pause.
    };
    this.quality.onBenchmarkStateChange = (running) => {
      this.loop.limiter.setCap(running ? 0 : settings.fpsCap);
      this.updateQualityLabel();
    };
    this.updateQualityLabel();
    this.applySettings();

    this.services.register('bus', this.bus);
    this.services.register('time', this.time);
    this.services.register('clock', this.clock);
    this.services.register('input', this.input);
    this.services.register('quality', this.quality);
    this.services.register('render', this.ctx);

    this.wireEvents();
    this.installTestHook();
    this.ctx.setScene(this.hubScene.scene);
    this.ctx.setGrade(this.hubScene.grade);
    this.hubScene.update(0);
    this.ctx.renderer.compile(this.hubScene.scene, this.hubScene.camera);
    this.ctx.render(this.hubScene.camera);
  }

  /** Called from the title screen tap. */
  start(): void {
    if (this.running) return;
    this.running = true;
    if (this.profile.data.story.prologueSeen) this.showHub();
    else this.showPrologue();
    this.loop.start();
    console.info(`[app] started; quality ${this.quality.level} (${this.quality.setting})`);
  }

  // ------------------------------------------------------------------ hub / battle switching

  /** First launch: the story so far, then the hub. Skippable at any point. */
  private showPrologue(): void {
    this.music.play('hub');
    this.touch.setVisible(false);
    this.hud.setPauseVisible(false);
    this.applyInputEnabled(false);
    this.menus.setVisible(false);
    this.story = new StoryCards(this.opts.uiRoot, PROLOGUE, {
      onPage: () => this.stingers.play('page'),
      onDone: () => {
        this.story = null;
        this.profile.data.story.prologueSeen = true;
        this.profile.commit();
        this.stingers.play('whoosh');
        this.showHub();
      },
    });
  }

  private showHub(): void {
    this.music.play('hub');
    this.ctx.setScene(this.hubScene.scene);
    this.ctx.setGrade(this.hubScene.grade);
    this.touch.setVisible(false);
    this.hud.setPauseVisible(false);
    this.applyInputEnabled(false);
    this.menus.setVisible(true);
    this.menus.hub();
  }

  /** Toasts for daily quests finished and achievement tiers reached since the last check. */
  private announceGoals(): void {
    const now = this.profile.goalSnapshot();
    for (const g of goalsReached(this.goalBase, now)) {
      if (g.kind === 'quest') {
        const def = questDef(g.id);
        if (def !== undefined)
          this.goalToasts.push({
            kicker: 'Quest complete',
            text: `${def.text} — claim it in the Journal`,
          });
      } else {
        const a = ACHIEVEMENTS.find((x) => x.id === g.id);
        if (a !== undefined)
          this.goalToasts.push({ kicker: 'Achievement', text: `${a.name} · tier ${g.tier}` });
      }
    }
    this.goalBase = now;
  }

  /**
   * Shows the loading veil (stage name + a lore line), lets it paint, then builds the battle.
   * A newer start cancels a pending one.
   */
  private startBattle(setup: BattleSetup): void {
    const token = ++this.battleToken;
    this.veil.show(setup.label, loreTip(token + this.profile.data.lifetime.battles));
    const req = arenaAssetRequest(setup.stage.arena);
    this.assets.anisotropy = this.quality.preset.anisotropy;
    this.assets.maxTextureSize = this.quality.preset.textureMaxSize;
    // Load the arena's scanned assets behind the veil; on failure the arena falls back to its
    // procedural look rather than blocking the fight.
    // `?scanned=0` keeps the procedural arenas (comparisons, low-end debugging).
    const off = new URLSearchParams(window.location.search).get('scanned') === '0';
    const loaded = (off ? Promise.resolve() : this.assets.preload(req)).catch((e: unknown) => {
      console.warn('[assets] arena assets failed to load', e);
    });
    void loaded.then(() =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (token !== this.battleToken) return;
          this.assets.retain(req);
          this.buildBattle(setup);
          this.veil.hide();
        }),
      ),
    );
  }

  private buildBattle(setup: BattleSetup): void {
    this.endBattle();
    this.menus.setVisible(false);
    const scene = new Scene();
    this.ctx.setScene(scene);
    const physics = new PhysicsWorld(this.rapier);
    this.battlePhysics = physics;
    this.time.reset();
    this.camera.setFraming(null);
    const battle = new BattleMode(
      {
        ctx: this.ctx,
        physics,
        camera: this.camera,
        input: this.input,
        bus: this.bus,
        clock: this.clock,
        audio: this.opts.audio,
        uiRoot: this.opts.uiRoot,
        preset: this.quality.preset,
        assets: this.assets,
        wallet: this.profile.wallet,
        commitWallet: () => this.profile.commit(),
        setInputEnabled: (on) => this.setGameplayInput(on),
        vibrate: (ms) => {
          const s = this.opts.save.settings;
          if (s.vibration && typeof navigator.vibrate === 'function')
            navigator.vibrate(vibrationMs(ms, s.vibrationStrength));
        },
        stingers: this.stingers,
        reduceFlashes: () => this.opts.save.settings.reduceFlashes,
        onFinish: (outcome) => {
          this.pendingOutcome = outcome;
        },
      },
      setup,
    );
    this.battle = battle;
    this.music.play(setup.duel !== undefined || setup.stage.waves.length === 0 ? 'boss' : 'battle');
    this.quality.addTarget(battle);
    battle.render(1, 0, 1);
    // Compile all shaders (incl. hidden pooled effects) before the first frame of the fight.
    battle.warmShaders(this.camera.camera);
    this.touch.setVisible(true);
    this.hud.setPauseVisible(true);
    this.setGameplayInput(true);
    this.input.releaseAll();
    this.loop.requestRender();
    const s = this.opts.save.settings;
    if (s.quality === 'auto' && s.detectedQuality === null && !this.quality.benchmarkRunning)
      this.quality.startBenchmark();
  }

  private endBattle(): void {
    const b = this.battle;
    if (b === null) return;
    this.quality.removeTarget(b);
    b.dispose();
    this.battle = null;
    this.battlePhysics?.dispose();
    this.battlePhysics = null;
    this.touch.setVisible(false);
    this.hud.setPauseVisible(false);
    this.applyInputEnabled(false);
    this.input.releaseAll();
    this.time.reset();
    this.ctx.setScene(this.hubScene.scene);
    this.ctx.setGrade(this.hubScene.grade);
  }

  /** Runs outside the fixed step: the battle that produced the outcome is disposed here. */
  private handleOutcome(): void {
    const outcome = this.pendingOutcome;
    this.pendingOutcome = null;
    if (outcome === null) return;
    this.endBattle();
    this.menus.setVisible(true);
    this.music.play('hub');
    this.runs.finish(outcome);
  }

  // ------------------------------------------------------------------ pause / input

  setPaused(paused: boolean): void {
    if (this.battle === null && paused) return;
    if (paused === this.loop.isPaused) return;
    this.loop.setPaused(paused);
    this.applyInputEnabled(!paused && this.inputEnabled && this.battle !== null);
    if (paused) {
      this.input.releaseAll();
      const s = this.opts.save.settings;
      this.pause.sync({
        quality: s.quality,
        activeQualityLabel: this.qualityLabel(),
        fpsCap: s.fpsCap,
        debugOverlay: this.overlay.isVisible,
        cameraDistance: s.cameraDistance,
        screenShake: s.screenShake,
      });
      this.pause.show();
    } else {
      this.pause.hide();
    }
    this.bus.emit('game:paused', { paused });
  }

  /** Gameplay input on/off (cinematics, result screens) — independent from pausing. */
  private setGameplayInput(on: boolean): void {
    this.inputEnabled = on;
    this.applyInputEnabled(on && !this.loop?.isPaused && this.battle !== null);
    if (!on) this.input.releaseAll();
  }

  private applyInputEnabled(on: boolean): void {
    this.touch.setEnabled(on);
    this.keyboard.enabled = on;
    this.gamepad.enabled = on;
  }

  private fillUltimate(): void {
    const b = this.battle;
    if (b === null) return;
    b.player.ultimate.add(1);
    this.bus.emit('ultimate:charge', { value: b.player.ultimate.value });
  }

  private grant(c: Currency, n: number): void {
    this.profile.wallet.add(c, n);
    this.profile.commit();
    this.menus.shell.refreshCurrencies();
  }

  private settingsPort(): SettingsPort {
    const s = this.opts.save.settings;
    return {
      settings: s,
      activeQualityLabel: () => this.qualityLabel(),
      setQuality: (q) => {
        s.quality = q;
        if (q === 'auto') s.detectedQuality = null;
        this.quality.setSetting(q, this.quality.level, s.detectedQuality);
        this.updateQualityLabel();
        this.persistSoon();
      },
      setFpsCap: (cap) => {
        s.fpsCap = cap;
        if (!this.quality.benchmarkRunning) this.loop.limiter.setCap(cap);
        this.persistSoon();
      },
      setDebugOverlay: (on) => this.overlay.setVisible(on),
      update: (patch) => {
        // Sanitise through the save format so a bad value can never reach the game or the save.
        Object.assign(s, sanitizeSettings({ ...s, ...patch }));
        this.applySettings();
        this.persistSoon();
      },
      resetCamera: () => {
        Object.assign(s, cameraDefaults());
        this.applySettings();
        this.persistSoon();
      },
      resetAll: () => {
        const fresh = resetSettings(s);
        const qualityChanged = fresh.quality !== s.quality;
        const fpsChanged = fresh.fpsCap !== s.fpsCap;
        Object.assign(s, fresh);
        if (qualityChanged)
          this.quality.setSetting(s.quality, this.quality.level, s.detectedQuality);
        if (fpsChanged && !this.quality.benchmarkRunning) this.loop.limiter.setCap(s.fpsCap);
        this.overlay.setVisible(s.showDebugOverlay);
        this.updateQualityLabel();
        this.applySettings();
        this.persistSoon();
      },
      fullscreen: () => {
        void enterFullscreenLandscape();
      },
      copyLog: () => this.copyDebugLog(),
    };
  }

  private wireEvents(): void {
    const b = this.bus;
    this.disposers.push(
      // The visible strength is scaled by the screen-shake setting inside FollowCamera.
      b.on('camera:shake', (e) => this.camera.shake.addTrauma(e.trauma)),
      b.on('stage:bossIntro', () => this.music.play('boss')),
      b.on('stage:victory', () => this.music.stop()),
      b.on('player:died', () => this.music.stop()),
      b.on('player:revived', () =>
        this.music.play(this.battle?.boss?.inWorld === true ? 'boss' : 'battle'),
      ),
      b.on('time:hitStop', (e) => this.time.hitStop(e.ms)),
      b.on('time:slowMotion', (e) => this.time.slowMotion(e.scale, e.ms)),
      b.on('ultimate:charge', (e) => this.touch.setUltimateCharge(e.value)),
      b.on('input:pressed', (e) => {
        if (e.action === 'pause' && this.running && this.battle !== null)
          this.setPaused(!this.loop.isPaused);
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
    // In portrait the rotate hint covers the game: pause so it doesn't simulate/render unseen.
    const portrait = window.matchMedia('(orientation: portrait) and (pointer: coarse)');
    const onOrientation = (): void => {
      if (portrait.matches && this.running) this.setPaused(true);
    };
    portrait.addEventListener('change', onOrientation);
    // Tap anywhere during a cinematic (boss intro) to skip it.
    const onCanvasTap = (): void => {
      if (this.battle?.cinematicActive === true) this.battle.skipCinematic();
    };
    this.opts.canvas.addEventListener('pointerdown', onCanvasTap);
    this.disposers.push(() => {
      portrait.removeEventListener('change', onOrientation);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      this.opts.canvas.removeEventListener('pointerdown', onCanvasTap);
    });
    this.touch.setVisible(false);
    this.hud.setPauseVisible(false);
  }

  /**
   * The resolution scale setting, or `?renderScale=0.25..1` from the URL (not saved): software-
   * rendered automated tests run the game at a lower internal resolution to keep real time.
   */
  private renderScale(): number {
    const v = Number(new URLSearchParams(window.location.search).get('renderScale'));
    return v >= 0.25 && v <= 1 ? v : this.opts.save.settings.renderScale;
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.ctx.setSize(w, h, this.quality.preset.maxPixelRatio, this.renderScale());
    this.camera.setAspect(w / Math.max(h, 1));
    this.hubScene.setAspect(w / Math.max(h, 1));
    this.battle?.applyQuality(this.quality.preset, this.quality.level);
    this.loop.requestRender();
  }

  private applyRendererQuality(preset: QualityPreset): void {
    this.ctx.setSize(
      window.innerWidth,
      window.innerHeight,
      preset.maxPixelRatio,
      this.renderScale(),
    );
    this.ctx.setPost(postSettingsFor(preset), this.camera.camera);
    setCharacterLight(preset.characterLight);
    this.vignette.classList.toggle('is-hidden', !preset.vignette || preset.grade);
    this.loop.requestRender();
  }

  /**
   * Pushes every setting to the systems that use it. Idempotent and cheap: the quality overrides
   * and resolution only re-apply when they actually changed.
   */
  private applySettings(): void {
    const s = this.opts.save.settings;
    const root = this.opts.uiRoot;
    const audio = this.opts.audio;
    this.touch.applyLayout(s.buttonScale, s.buttonOpacity, s.leftHanded);
    this.touch.applyJoystick({
      scale: s.joystickScale,
      deadZone: s.joystickDeadZone,
      mode: s.joystickMode,
    });
    root.classList.toggle('no-damage-numbers', !s.showDamageNumbers);
    root.classList.toggle('no-combo', !s.showComboCounter);
    root.classList.toggle('reduce-flashes', s.reduceFlashes);
    root.classList.toggle('large-text', s.largeMenuText);
    root.classList.toggle('hud-scaled', s.hudScale !== 1);
    root.style.setProperty('--hud-scale', s.hudScale.toFixed(2));
    this.hud.setFpsVisible(s.showFps);
    this.camera.setOptions(resolveCameraOptions(s));
    setAimAssist(resolveAimAssist(s));
    setColorblindTelegraphs(s.colorblindTelegraphs);
    audio.uiSounds = s.uiSounds;
    audio.setMuteInBackground(s.muteInBackground);
    audio.setVolumes(s.masterVolume, s.sfxVolume, s.musicVolume);
    this.ctx.setBloomStrength(
      s.reduceFlashes ? BLOOM_CONFIG.reducedStrength : BLOOM_CONFIG.strength,
    );
    this.quality.setOverrides(qualityOverridesFrom(s));
    if (s.renderScale !== this.appliedRenderScale) {
      this.appliedRenderScale = s.renderScale;
      this.resize();
    }
    this.loop.requestRender();
  }

  private refreshFpsCounter(intervalMs: number): void {
    if (!this.hud.fpsVisible) return;
    this.fpsRefreshMs += intervalMs;
    if (this.fpsRefreshMs < 250) return;
    this.fpsRefreshMs = 0;
    this.hud.setFps(this.stats.fps);
  }

  private renderFrame(alpha: number, dtSec: number): void {
    const b = this.battle;
    if (b === null) {
      // The prologue covers the screen: no need to draw the hub behind it.
      if (this.story !== null) return;
      this.hubScene.update(dtSec);
      this.ctx.render(this.hubScene.camera);
      return;
    }
    b.render(alpha, dtSec, this.time.currentScale);
    const cd = b.player.cooldowns;
    for (let i = 0; i < cd.count; i++) {
      this.touch.setSkillCooldown(i, cd.fraction(i), cd.remainingMs(i) / 1000);
    }
    this.ctx.render(this.camera.camera);
  }

  private qualityLabel(): string {
    const q = this.quality;
    const running = q.benchmarkRunning ? ' — measuring…' : '';
    const auto = q.setting === 'auto' ? 'auto-detected ' : '';
    return `Active: ${auto}${q.preset.label}${running}`;
  }

  private updateQualityLabel(): void {
    this.pause.setActiveQualityLabel(this.qualityLabel());
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
    const heap = readHeapMB();
    const [bw, bh] = this.ctx.drawingBufferSize;
    const q = this.quality;
    const lines = [
      `FPS ${s.fps.toFixed(1)}  frame ${s.meanMs.toFixed(1)}ms  p95 ${s.percentileMs(95).toFixed(1)}  max ${s.maxMs.toFixed(1)}`,
      `logic ${LOOP_CONFIG.logicHz}Hz steps ${s.lastSteps}  dropped ${this.loop.timestep.droppedMs.toFixed(0)}ms  cap ${this.loop.limiter.capFps || 'off'}`,
      `draws ${r.calls}  tris ${(r.triangles / 1000).toFixed(1)}k  pts ${r.points}`,
      `geo ${mem.geometries}  tex ${mem.textures}  progs ${progs}`,
      `heap ${heap ? `${heap.used.toFixed(1)} / ${heap.limit.toFixed(0)} MB` : 'n/a (Chrome only)'}`,
      `quality ${q.preset.label} (${q.setting})${q.benchmarkRunning ? ' benchmarking' : ''}  bench ${q.lastBenchmarkMedianMs > 0 ? `${q.lastBenchmarkMedianMs.toFixed(1)}ms` : '—'}`,
      `DPR ${window.devicePixelRatio.toFixed(2)}→${this.ctx.currentPixelRatio.toFixed(2)}  view ${window.innerWidth}x${window.innerHeight}  buffer ${bw}x${bh}`,
    ];
    const m = this.battle;
    if (m !== null) {
      const p = m.player;
      const boss = m.boss;
      lines.push(
        `entities ${1 + m.roster.active.length + (boss?.inWorld === true ? 1 : 0)}  enemies ${m.roster.aliveCount()}  pool ${m.roster.pooledCount}  tokens ${m.tokens.count}/${m.tokens.max}  telegraphs ${m.telegraphCount}`,
        `hero ${p.state} ${p.actionId ?? ''} hp ${Math.ceil(p.health.current)}/${p.health.max} ult ${(p.ultimate.value * 100).toFixed(0)}%`,
        `stage ${m.setup.stage.id} ${m.director.phase} wave ${m.director.wave + 1}/${m.director.totalWaves} t ${m.stageTimeSec.toFixed(0)}s  boss ${boss?.inWorld === true ? `${boss.brain.state} p${boss.bossBrain.phase + 1} ${Math.ceil(boss.health.current)}` : '—'}`,
      );
    } else {
      lines.push(`menu ${this.menus.shell.screen}  items ${this.profile.data.items.length}`);
    }
    lines.push(
      `time ${this.time.isFrozen ? 'HITSTOP' : this.time.isSlowed ? 'SLOW' : 'normal'}  trauma ${this.camera.shake.currentTrauma.toFixed(2)}  log ${this.opts.log.errorCount}E/${this.opts.log.warnCount}W`,
    );
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
      skipCountdown: () => this.battle?.director.skipCountdown(),
      killAll: () => this.battle?.killAllEnemies(),
      skipToBoss: () => this.battle?.skipToBoss(),
      damageBoss: (frac) => this.battle?.damageBoss(frac),
      killBoss: () => this.battle?.killBoss(),
      damagePlayer: (frac) => this.battle?.damagePlayer(frac),
      setGod: (on) => {
        if (this.battle !== null) this.battle.player.god = on;
      },
      fillUltimate: () => this.fillUltimate(),
      restart: () => this.battle?.startRun(),
      startStage: (stageId, difficulty = 'normal') => this.runs.startAdventure(stageId, difficulty),
      setQuality: (q) => this.settingsPort().setQuality(q),
      grant: (c, n) => this.grant(c, n),
      goHub: () => {
        this.battleToken++;
        this.veil.hide();
        this.endBattle();
        this.showHub();
      },
      clearStages: (count) => {
        let n = 0;
        for (const c of CHAPTERS)
          for (const st of c.stages)
            if (n++ < count) this.profile.submitStageResult(st.id, 'normal', 3, 100);
        if (this.battle === null) this.menus.hub();
      },
      killDuelist: () => this.battle?.killDuelist(),
      setHero: (id) => {
        this.profile.hero(id).unlocked = true;
        this.profile.selectHero(id);
        this.hubScene.setHero(HEROES[id]);
        if (this.battle === null) this.menus.hub();
      },
      state: () => {
        const m = this.battle;
        const p = m?.player;
        const heap = readHeapMB();
        const presses: Record<string, number> = {};
        for (const a of INPUT_ACTIONS) presses[a] = this.input.pressCount(a);
        const heroId = this.profile.selectedHero;
        const boss = m?.boss ?? null;
        return {
          ready: true,
          running: this.running,
          paused: this.loop.isPaused,
          screen:
            m !== null ? 'battle' : this.story !== null ? 'prologue' : this.menus.shell.screen,
          player: {
            x: p?.currFeet.x ?? 0,
            y: p?.currFeet.y ?? 0,
            z: p?.currFeet.z ?? 0,
            grounded: p?.body.grounded ?? false,
            speed: p === undefined ? 0 : Math.hypot(p.vel.x, p.vel.z),
            yaw: p?.yaw ?? 0,
            hp: p?.health.current ?? 0,
            maxHp: p?.health.max ?? 0,
            state: p?.state ?? 'none',
            comboIndex: p?.comboIndex ?? 0,
            action: p?.actionId ?? null,
          },
          presses,
          ultimate: p?.ultimate.value ?? 0,
          skillReady: [0, 1, 2].map((i) => p?.cooldowns.isReady(i) ?? false),
          stage: {
            id: m?.setup.stage.id ?? '',
            phase: m?.director.phase ?? 'none',
            wave: m?.director.wave ?? -1,
            enemiesAlive: m?.roster.aliveCount() ?? 0,
            killed: m?.enemiesKilled ?? 0,
            result: m?.resultShowing ?? null,
            timeSec: m?.stageTimeSec ?? 0,
          },
          boss: {
            active: boss?.inWorld ?? false,
            hp: boss?.health.current ?? 0,
            maxHp: boss?.health.max ?? 0,
            phase: boss?.bossBrain.phase ?? 0,
            state: boss?.brain.state ?? 'none',
            breakFrac: boss?.poise.frac ?? 0,
          },
          hero: {
            id: heroId,
            level: this.profile.hero(heroId).level,
            xp: this.profile.hero(heroId).xp,
            power: this.profile.power(heroId),
          },
          items: this.profile.data.items.length,
          wallet: { ...this.profile.wallet.snapshot() },
          tokensInUse: m?.tokens.count ?? 0,
          telegraphs: m?.telegraphCount ?? 0,
          effects: {
            projectiles: m?.effects.activeProjectiles ?? 0,
            zones: m?.effects.activeZones ?? 0,
          },
          cinematic: m?.cinematicActive ?? false,
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
          move: this.input.readMove({ x: 0, y: 0 }),
          debugOverlay: this.overlay.isVisible,
          camera: {
            distance: this.camera.options.distance,
            height: this.camera.options.height,
            fov: this.camera.camera.fov,
            shake: this.camera.options.shake,
          },
          pixelRatio: this.ctx.currentPixelRatio,
          preset: {
            shadows: this.quality.preset.shadows,
            bloom: this.quality.preset.bloom,
            particleCount: this.quality.preset.particleCount,
          },
        };
      },
    };
  }

  dispose(): void {
    this.loop.stop();
    this.music.stop();
    for (const d of this.disposers) d();
    this.endBattle();
    this.story?.dispose();
    this.goalToasts.dispose();
    this.veil.dispose();
    this.assets.dispose();
    this.hubScene.dispose();
    this.menus.dispose();
    this.touch.dispose();
    this.keyboard.dispose();
    this.gamepad.dispose();
    this.hud.dispose();
    this.pause.dispose();
    this.overlay.dispose();
    this.vignette.remove();
    this.ctx.dispose();
    this.bus.clear();
    delete window.__ashbound;
  }
}
