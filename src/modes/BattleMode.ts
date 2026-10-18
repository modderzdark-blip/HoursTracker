import { Vector3, type Camera, type Object3D, type Scene } from 'three';
import type { Actor } from '../actors/Actor';
import { Boss } from '../actors/Boss';
import type { Enemy } from '../actors/Enemy';
import { Player } from '../actors/Player';
import { TrainingDummy } from '../actors/TrainingDummy';
import { buildActionClip, buildCustomActionClip } from '../anim/clipSets';
import { POSE_LIBRARY } from '../anim/poses';
import { AttackTokenManager } from '../ai/AttackTokens';
import type { BrainContext } from '../ai/EnemyBrain';
import type { AudioManager } from '../audio/AudioManager';
import { Sfx } from '../audio/Sfx';
import { CameraDirector } from '../camera/CameraDirector';
import type { FollowCamera } from '../camera/FollowCamera';
import { CombatSystem } from '../combat/CombatSystem';
import type { EventBus } from '../core/EventBus';
import type { GameEvents, HitEvent } from '../core/events';
import type { GameClock } from '../core/GameClock';
import { mulberry32 } from '../core/random';
import type { ArenaDef } from '../data/arenas';
import { BOSSES } from '../data/bosses';
import { DIFFICULTIES } from '../data/difficulty';
import { ECONOMY } from '../data/economy';
import type { EnemyId } from '../data/enemies';
import type { HeroDef } from '../data/heroes';
import type { QualityLevel, QualityPreset } from '../data/quality';
import { RIGS } from '../data/rigs';
import type { StageDef } from '../data/stages';
import type { StatusId } from '../data/statusEffects';
import type { InputState } from '../input/InputState';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { rateRun } from '../progression/stars';
import { Wallet } from '../progression/wallet';
import { Atmosphere } from '../render/Atmosphere';
import type { QualityTarget } from '../render/QualityManager';
import type { RenderContext } from '../render/RenderContext';
import type { SaveData } from '../save/SaveStore';
import { BattleHud } from '../ui/BattleHud';
import { DamageNumbers } from '../ui/DamageNumbers';
import { ResultScreen } from '../ui/ResultScreen';
import { BlobShadows } from '../vfx/BlobShadows';
import { EmberField } from '../vfx/EmberField';
import { ShadowClones } from '../vfx/ShadowClones';
import { SoulOrbs } from '../vfx/SoulOrbs';
import { Sparks } from '../vfx/Sparks';
import { TelegraphDecals } from '../vfx/TelegraphDecals';
import { WeaponTrails } from '../vfx/WeaponTrails';
import { ArenaBuilder } from './ArenaBuilder';
import { separateCrowd } from './crowd';
import { EnemyRoster } from './EnemyRoster';
import { WaveDirector, type WaveWorld } from './WaveDirector';

export interface BattleDeps {
  readonly ctx: RenderContext;
  readonly physics: PhysicsWorld;
  readonly camera: FollowCamera;
  readonly input: InputState;
  readonly bus: EventBus<GameEvents>;
  readonly clock: GameClock;
  readonly audio: AudioManager;
  readonly uiRoot: HTMLElement;
  readonly save: SaveData;
  readonly persist: () => void;
  readonly arena: ArenaDef;
  readonly hero: HeroDef;
  readonly stage: StageDef;
  readonly preset: QualityPreset;
  /** Enables/disables player input (cinematics, result screens). */
  readonly setInputEnabled: (enabled: boolean) => void;
  readonly vibrate: (ms: number) => void;
}

const MAX_PARTICLES = 320;
const DEFEAT_SCREEN_DELAY_MS = 1600;
const VICTORY_SCREEN_DELAY_MS = 2600;
const ULT_CLONE_INTERVAL_MS = 220;

const TRAIL_COLORS = { hero: 0xa07cff, enemy: 0xff5a2a, boss: 0xff7a2a } as const;
const SPARK = {
  hit: 0xffc890,
  crit: 0xffe070,
  player: 0xff3020,
  ash: 0x806860,
  soul: 0x90b0ff,
  perfect: 0xb080ff,
} as const;

/**
 * One battle: arena, hero, training dummy, enemy waves, the boss, all combat feedback (hit-stop,
 * shake, numbers, sparks, trails, SFX), HUD and the victory/defeat flow. Owns everything it
 * creates and disposes it.
 */
export class BattleMode implements QualityTarget, WaveWorld {
  readonly player: Player;
  readonly boss: Boss;
  readonly dummy: TrainingDummy;
  readonly roster: EnemyRoster;
  readonly combat: CombatSystem;
  readonly tokens: AttackTokenManager;
  readonly wallet: Wallet;
  director: WaveDirector;
  private readonly builder: ArenaBuilder;
  private readonly atmosphere: Atmosphere;
  private readonly embers: EmberField;
  private readonly telegraphs: TelegraphDecals;
  private readonly sparks: Sparks;
  private readonly trails: WeaponTrails;
  private readonly souls: SoulOrbs;
  private readonly blobs: BlobShadows;
  private readonly clones: ShadowClones;
  private readonly hud: BattleHud;
  private readonly numbers: DamageNumbers;
  private readonly results: ResultScreen;
  private readonly sfx: Sfx;
  private readonly cam: CameraDirector;
  private readonly rng = mulberry32(20261018);
  private readonly actors: Actor[] = [];
  private actorCount = 0;
  private readonly disposers: (() => void)[] = [];
  private readonly scene: Scene;
  private bossActive = false;
  private bossIntroFinished = false;
  private bossDown = false;
  private runStartMs = 0;
  private resultTimerMs = -1;
  private resultKind: 'victory' | 'defeat' | null = null;
  private soulsThisRun = 0;
  private ultCloneTimer = 0;
  private dotTarget: Actor | null = null;
  private readonly tmp = new Vector3();
  private readonly bossFrame = new Vector3();
  private readonly statusStacks: Record<StatusId, number> = { bleed: 0, burn: 0, slow: 0 };
  private readonly difficulty;
  /** Debug/test counters. */
  enemiesKilled = 0;

  constructor(private readonly d: BattleDeps) {
    this.scene = d.ctx.scene;
    this.difficulty = DIFFICULTIES[d.stage.difficulty];
    this.wallet = new Wallet(d.save.wallet);
    this.builder = new ArenaBuilder(d.arena, d.physics, d.preset);
    this.builder.addTo(this.scene);
    this.atmosphere = new Atmosphere(d.ctx, d.arena);
    this.embers = new EmberField(MAX_PARTICLES, d.arena.palette.ember);
    this.scene.add(this.embers.points);
    this.telegraphs = new TelegraphDecals(this.scene);
    this.sparks = new Sparks(this.scene);
    this.trails = new WeaponTrails(this.scene, 16);
    this.souls = new SoulOrbs(this.scene);
    this.blobs = new BlobShadows(this.scene);
    this.sfx = new Sfx(d.audio);
    this.cam = new CameraDirector();
    this.combat = new CombatSystem(d.physics, d.bus, this.rng);
    this.tokens = new AttackTokenManager(this.difficulty.attackTokens);

    this.player = new Player({
      hero: d.hero,
      physics: d.physics,
      scene: this.scene,
      combat: this.combat,
      input: d.input,
      bus: d.bus,
      clock: () => d.clock.nowMs,
      basis: d.camera,
      targets: () => this.targetList(),
    });
    this.combat.register(this.player);
    this.trails.attach(this.player.rig, 'right', TRAIL_COLORS.hero, () => {
      const s = this.player.trailSide();
      return s === 'right' || s === 'both';
    });
    this.trails.attach(this.player.rig, 'left', TRAIL_COLORS.hero, () => {
      const s = this.player.trailSide();
      return s === 'left' || s === 'both';
    });

    const ctx: BrainContext = {
      player: this.player,
      tokens: this.tokens,
      physics: d.physics,
      combat: this.combat,
      bus: d.bus,
      telegraphs: this.telegraphs,
      rng: this.rng,
      difficultyMod: this.difficulty.enemyDamage,
    };
    this.roster = new EnemyRoster({ physics: d.physics, scene: this.scene, ctx }, this.combat);
    this.prewarmPools();
    this.boss = new Boss(BOSSES.hollow_warden, { physics: d.physics, scene: this.scene, ctx });
    this.combat.register(this.boss);
    this.boss.bossBrain.onShockwave = (x, z) => {
      this.telegraphs.ring(x, z, BOSSES.hollow_warden.transitionPushRadius, 0xff7a2a, 700);
      this.sparks.burst(x, 0.4, z, 40, 0xff7a2a, 9, 0, 0, 0.6, 1.4, 0.4);
    };
    this.trails.attach(this.boss.rig, 'right', TRAIL_COLORS.boss, () =>
      this.enemyTrailOn(this.boss),
    );
    this.dummy = new TrainingDummy(d.physics, this.scene);
    this.combat.register(this.dummy);

    // Ultimate clones use the hero's own slash clips.
    const idle = POSE_LIBRARY[d.hero.idlePose];
    const cloneClips = d.hero.combo
      .slice(0, 3)
      .map((a) =>
        a.clip !== undefined ? buildCustomActionClip(a.clip, a, idle) : buildActionClip(a, idle),
      );
    this.clones = new ShadowClones(
      this.scene,
      RIGS.kael,
      cloneClips.map((c) => c.name),
      cloneClips,
      d.hero.ultimate.clones,
    );

    this.hud = new BattleHud(d.uiRoot, () => this.director.skipCountdown());
    this.numbers = new DamageNumbers(d.uiRoot);
    this.results = new ResultScreen(d.uiRoot);
    this.director = new WaveDirector(d.stage, this);

    this.combat.onDamage = (attacker, target, amount) => this.onDamage(attacker, target, amount);
    this.wireEvents();
    this.startRun();
  }

  // ------------------------------------------------------------------ setup

  private prewarmPools(): void {
    const max = new Map<EnemyId, number>();
    for (const w of this.d.stage.waves) {
      const perWave = new Map<EnemyId, number>();
      for (const s of w.spawns) perWave.set(s.enemy, (perWave.get(s.enemy) ?? 0) + s.count);
      for (const [id, n] of perWave) max.set(id, Math.max(max.get(id) ?? 0, n));
    }
    for (const [id, n] of max) this.roster.prewarm(id, n);
  }

  private enemyTrailOn(e: Enemy): boolean {
    const s = e.brain.state;
    if (s === 'attack') return true;
    return (
      s === 'telegraph' &&
      e.brain.runner.startupProgress > 0.75 &&
      e.brain.attack?.special !== 'leap'
    );
  }

  private targetList(): readonly Actor[] {
    // Auto-aim/Umbral Step targets: living enemies + boss + dummy.
    this.targets.length = 0;
    for (const e of this.roster.active) if (e.alive) this.targets.push(e);
    if (this.boss.alive) this.targets.push(this.boss);
    if (this.dummy.alive) this.targets.push(this.dummy);
    return this.targets;
  }

  private readonly targets: Actor[] = [];

  private wireEvents(): void {
    const b = this.d.bus;
    this.disposers.push(
      b.on('combat:hit', (e) => this.onHitEvent(e)),
      b.on('combat:death', (e) => this.onDeath(e.actorId, e.team, e.x, e.z)),
      b.on('player:perfectDodge', (e) => {
        this.hud.showBanner('PERFECT DODGE', 'perfect', 1000);
        this.sfx.play('perfect');
        this.sparks.burst(e.x, 1, e.z, 26, SPARK.perfect, 4, 0, 0, 0.5, 1.2, 0.2);
      }),
      b.on('combat:evaded', (e) => {
        if (!e.perfect)
          this.numbers.spawn(
            'MISS',
            this.player.currFeet.x,
            this.player.currFeet.y + 2,
            this.player.currFeet.z,
            'info',
          );
      }),
      b.on('player:action', (e) => this.onPlayerAction(e.kind, e.index)),
      b.on('player:died', () => {
        this.resultKind = 'defeat';
        this.resultTimerMs = DEFEAT_SCREEN_DELAY_MS;
        this.sfx.play('defeat');
      }),
      b.on('enemy:telegraph', (e) => {
        const atk = e.attackId;
        if (atk.startsWith('brute') || atk.startsWith('warden')) this.sfx.play('telegraph');
      }),
      b.on('boss:phase', (e) => {
        this.hud.showBanner(`PHASE ${e.label}`, 'phase', 1600);
        this.sfx.play('roar');
      }),
      b.on('boss:break', (e) => {
        if (e.broken) {
          this.hud.showBanner('BREAK!', 'break', 1200);
          this.sfx.play('break');
          this.sparks.burst(
            this.boss.currFeet.x,
            3,
            this.boss.currFeet.z,
            50,
            0xffe070,
            8,
            0,
            0,
            0.7,
            1.4,
            0.6,
          );
        }
      }),
      b.on('boss:enrage', () => {
        this.hud.showBanner('ENRAGED', 'warn', 1800);
        this.sfx.play('roar');
      }),
    );
    this.souls.onCollect = () => this.sfx.play('soul', 0.6);
  }

  // ------------------------------------------------------------------ run flow

  startRun(): void {
    this.roster.clear();
    this.boss.brain.reset();
    this.boss.removeFromWorld();
    this.telegraphs.hideAll();
    this.souls.clear();
    this.clones.clear();
    this.numbers.clear();
    this.results.hide();
    this.hud.reset();
    this.hud.setVisible(true);
    this.tokens.clear();
    this.cam.cancel();
    this.d.camera.setFraming(null);
    this.bossActive = false;
    this.bossIntroFinished = false;
    this.bossDown = false;
    this.resultKind = null;
    this.resultTimerMs = -1;
    this.soulsThisRun = 0;
    this.enemiesKilled = 0;
    const [sx, , sz] = this.d.arena.spawn;
    this.player.resetForRun(sx, sz, Math.PI);
    if (this.d.stage.trainingDummy) {
      const [dx, dz] = this.d.arena.dummySpawn;
      this.dummy.health.reset(1);
      this.dummy.spawnAt(dx, dz, 0);
    } else {
      this.dummy.removeFromWorld();
    }
    this.director = new WaveDirector(this.d.stage, this);
    this.runStartMs = this.d.clock.nowMs;
    this.d.camera.snap(this.player.currFeet);
    this.d.setInputEnabled(true);
    this.hud.showBanner(this.d.stage.name.toUpperCase(), 'wave', 1800);
  }

  // WaveWorld ---------------------------------------------------------

  spawnEnemy(id: EnemyId): boolean {
    if (this.roster.aliveCount() >= this.d.preset.maxActiveEnemies) return false;
    const pts = this.d.arena.spawnPoints;
    // Prefer spawn points away from the player (never pop in on top of them).
    let best = pts[0];
    let bestScore = -Infinity;
    for (const p of pts) {
      const dist = Math.hypot(p[0] - this.player.currFeet.x, p[1] - this.player.currFeet.z);
      const score = dist + this.rng() * 6;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (best === undefined) return false;
    const x = best[0] + (this.rng() - 0.5) * 2;
    const z = best[1] + (this.rng() - 0.5) * 2;
    const yaw = Math.atan2(this.player.currFeet.x - x, this.player.currFeet.z - z);
    const e = this.roster.spawn(id, x, z, yaw, this.difficulty.enemyHp, this.difficulty.enemyPoise);
    if (!this.hasTrail.has(e)) {
      if (this.trails.attach(e.rig, 'right', TRAIL_COLORS.enemy, () => this.enemyTrailOn(e)))
        this.hasTrail.add(e);
    }
    this.sparks.burst(x, 0.3, z, 18, SPARK.ash, 3, 0, 0, 0.8, 1.6, -0.15);
    return true;
  }

  private readonly hasTrail = new Set<Enemy>();

  aliveEnemies(): number {
    return this.roster.aliveCount();
  }

  startBossIntro(): void {
    this.removeDummy();
    const [bx, bz] = this.d.arena.bossSpawn;
    const yaw = Math.atan2(this.player.currFeet.x - bx, this.player.currFeet.z - bz);
    this.boss.activate(bx, bz, yaw, this.difficulty.enemyHp, this.difficulty.enemyPoise);
    this.bossActive = true;
    this.bossIntroFinished = false;
    this.d.setInputEnabled(false);
    this.hud.showBanner(
      `${this.boss.bossDef.name.toUpperCase()}`,
      'phase',
      this.boss.bossDef.introMs,
    );
    this.sfx.play('roar');
    const def = this.boss.bossDef;
    this.cam.play(
      {
        center: this.tmp.set(bx, 0, bz),
        radius: 10,
        height: 3,
        fromDeg: (yaw * 180) / Math.PI + 35,
        toDeg: (yaw * 180) / Math.PI - 15,
        durationMs: def.introMs,
        lookHeight: 3.2,
        endRadiusMult: 0.75,
      },
      () => this.finishBossIntro(),
    );
    this.d.bus.emit('stage:bossIntro', {});
  }

  private finishBossIntro(): void {
    if (this.bossIntroFinished) return;
    this.bossIntroFinished = true;
    this.d.camera.blendFromCurrent();
    this.d.setInputEnabled(true);
    this.boss.bossBrain.beginFight();
    const def = this.boss.bossDef;
    this.hud.showBoss({
      name: def.name,
      title: def.title,
      hpFrac: 1,
      breakFrac: 1,
      broken: false,
      phaseMarks: def.phases.slice(1).map((p) => p.fromHpFrac),
      enrageInSec: def.enrageAfterMs / 1000,
      enraged: false,
    });
  }

  /** Tap during the boss intro skips it. */
  skipCinematic(): void {
    this.cam.skip();
  }

  bossIntroDone(): boolean {
    return this.bossIntroFinished;
  }

  bossDefeated(): boolean {
    return this.bossDown;
  }

  onWaveStart(wave: number, total: number): void {
    if (wave === 0) this.removeDummy();
    this.hud.showBanner(`WAVE ${wave + 1} / ${total}`, 'wave', 1500);
    this.d.bus.emit('wave:start', { wave, total });
  }

  private removeDummy(): void {
    if (!this.dummy.inWorld) return;
    this.sparks.burst(
      this.dummy.currFeet.x,
      1,
      this.dummy.currFeet.z,
      24,
      SPARK.ash,
      3,
      0,
      0,
      0.7,
      1.5,
      0,
    );
    this.dummy.removeFromWorld();
  }

  onWaveCleared(wave: number): void {
    this.d.bus.emit('wave:cleared', { wave });
  }

  onVictory(): void {
    this.resultKind = 'victory';
    this.resultTimerMs = VICTORY_SCREEN_DELAY_MS;
    this.d.bus.emit('stage:victory', {});
  }

  // ------------------------------------------------------------------ events

  private onDamage(attacker: Actor | null, target: Actor, amount: number): void {
    const p = this.player;
    const hero = this.d.hero;
    if (attacker === p && target !== this.dummy) {
      p.ultimate.add(amount * hero.ultGainPerDamage);
      this.d.bus.emit('ultimate:charge', { value: p.ultimate.value });
    } else if (attacker === p) {
      // The dummy charges the ultimate at half rate so practice is useful but not abusable.
      p.ultimate.add(amount * hero.ultGainPerDamage * 0.5);
      this.d.bus.emit('ultimate:charge', { value: p.ultimate.value });
    }
    if (target === p) {
      p.ultimate.add((amount / p.stats.maxHp) * hero.ultGainPerHpLost);
      this.d.bus.emit('ultimate:charge', { value: p.ultimate.value });
    }
  }

  private onHitEvent(e: HitEvent): void {
    const isPlayerTarget = e.targetTeam === 'player';
    const kind = e.dot
      ? 'dot'
      : isPlayerTarget
        ? 'player'
        : e.counter
          ? 'counter'
          : e.crit
            ? 'crit'
            : 'normal';
    this.numbers.spawn(
      e.crit && !isPlayerTarget ? `${e.amount}!` : String(e.amount),
      e.x,
      e.y,
      e.z,
      kind,
    );
    if (e.dot) return;
    if (isPlayerTarget) {
      this.sparks.burst(
        e.x,
        e.y - 0.6,
        e.z,
        14,
        SPARK.player,
        4,
        e.dirX * 0.5,
        e.dirZ * 0.5,
        0.4,
        1.1,
        1,
      );
      this.sfx.play('hurt');
      this.d.vibrate(e.shake > 0.4 ? 60 : 30);
      return;
    }
    this.sparks.burst(
      e.x,
      e.y - 0.6,
      e.z,
      e.crit ? 22 : 12,
      e.crit ? SPARK.crit : SPARK.hit,
      e.crit ? 7 : 5,
      e.dirX,
      e.dirZ,
      0.35,
      1,
      1,
    );
    this.sfx.play(e.crit ? 'crit' : 'hit');
    this.hud.registerHit();
    if (e.counter) this.numbers.spawn('COUNTER', e.x, e.y + 0.5, e.z, 'info');
    if (e.poiseBroken && e.targetId !== this.boss.id)
      this.numbers.spawn('STAGGER', e.x, e.y + 0.4, e.z, 'info');
  }

  private onDeath(actorId: number, team: string, x: number, z: number): void {
    if (team !== 'enemy') return;
    if (actorId === this.boss.id) {
      this.bossDown = true;
      const souls = Math.round(this.boss.bossDef.souls * this.difficulty.rewards);
      this.soulsThisRun += souls;
      this.souls.burst(x, 2.5, z, Math.min(30, souls));
      this.d.bus.emit('time:slowMotion', { scale: 0.25, ms: 1400 });
      this.d.bus.emit('camera:shake', { trauma: 0.9 });
      this.sfx.play('roar');
      this.hud.showBanner(`${this.boss.bossDef.name.toUpperCase()} FALLS`, 'phase', 2400);
      this.hud.hideBoss();
      this.d.camera.setFraming(null);
      this.telegraphs.hideAll();
      this.d.bus.emit('boss:defeated', { souls, x, z });
      return;
    }
    this.enemiesKilled++;
    this.sfx.play('enemyDeath');
    const e = this.roster.active.find((a) => a.id === actorId);
    const souls = e === undefined ? 0 : Math.round(e.def.souls * this.difficulty.rewards);
    if (souls > 0) {
      this.soulsThisRun += souls;
      this.souls.burst(x, 1.2, z, souls * 3);
    }
  }

  private onPlayerAction(kind: 'attack' | 'dodge' | 'skill' | 'ultimate', index: number): void {
    switch (kind) {
      case 'attack':
        this.sfx.play(index >= 3 ? 'swingHeavy' : 'swing');
        break;
      case 'dodge':
        this.sfx.play('dodge');
        break;
      case 'skill':
        this.sfx.play('skill');
        this.sparks.burst(
          this.player.currFeet.x,
          0.4,
          this.player.currFeet.z,
          16,
          SPARK.perfect,
          3,
          0,
          0,
          0.6,
          1.3,
          -0.2,
        );
        break;
      case 'ultimate': {
        this.sfx.play('ult');
        this.ultCloneTimer = 0;
        const p = this.player;
        const yawDeg = (p.yaw * 180) / Math.PI;
        this.cam.play(
          {
            center: this.tmp.copy(p.currFeet),
            radius: 4.5,
            height: 1.6,
            fromDeg: yawDeg + 140,
            toDeg: yawDeg + 200,
            durationMs: 950,
            lookHeight: 1.2,
            endRadiusMult: 1.5,
          },
          () => this.d.camera.blendFromCurrent(),
          p.renderFeet,
        );
        break;
      }
    }
  }

  // ------------------------------------------------------------------ frame

  private collectActors(): void {
    let n = 0;
    const a = this.actors;
    const put = (x: Actor): void => {
      if (n < a.length) a[n] = x;
      else a.push(x);
      n++;
    };
    put(this.player);
    if (this.dummy.inWorld) put(this.dummy);
    if (this.boss.inWorld) put(this.boss);
    for (const e of this.roster.active) put(e);
    this.actorCount = n;
  }

  private readonly onDot = (id: StatusId, units: number, mult: number): void => {
    if (this.dotTarget !== null) this.combat.applyDot(this.dotTarget, id, units, mult);
  };

  fixedUpdate(dtSec: number): void {
    const dtMs = dtSec * 1000;
    this.director.update(dtMs);

    this.player.think(dtSec);
    if (this.dummy.inWorld) this.dummy.think(dtSec);
    if (this.boss.inWorld) this.boss.think(dtSec);
    for (const e of this.roster.active) e.think(dtSec);

    this.collectActors();
    for (let i = 0; i < this.actorCount; i++) {
      const a = this.actors[i];
      if (a === undefined || !a.alive) continue;
      this.dotTarget = a;
      a.status.tick(dtMs, this.onDot);
    }
    this.dotTarget = null;
    separateCrowd(this.actors, this.actorCount);
    for (let i = 0; i < this.actorCount; i++) this.actors[i]?.integrate(dtSec);
    this.d.physics.step(dtSec);
    this.roster.collectDead();
    if (this.boss.inWorld && this.boss.readyForRelease) this.boss.removeFromWorld();

    // Ultimate shadow clones strike around targets during the active window.
    const p = this.player;
    if (p.state === 'ultimate' && p.runner.phase === 'active') {
      this.ultCloneTimer -= dtMs;
      if (this.ultCloneTimer <= 0) {
        this.ultCloneTimer = ULT_CLONE_INTERVAL_MS;
        this.spawnClone();
      }
    }

    if (this.resultTimerMs > 0) {
      this.resultTimerMs -= dtMs;
      if (this.resultTimerMs <= 0) this.showResult();
    }
  }

  private spawnClone(): void {
    const targets = this.targetList();
    const p = this.player;
    let tx = p.currFeet.x;
    let tz = p.currFeet.z;
    if (targets.length > 0) {
      const t = targets[Math.floor(this.rng() * targets.length)];
      if (t !== undefined && t.distanceTo(p) < 8) {
        tx = t.currFeet.x;
        tz = t.currFeet.z;
      }
    }
    const a = this.rng() * Math.PI * 2;
    const x = tx + Math.cos(a) * 1.4;
    const z = tz + Math.sin(a) * 1.4;
    this.clones.spawn(x, z, Math.atan2(tx - x, tz - z));
    this.sparks.burst(x, 1, z, 10, SPARK.perfect, 3, 0, 0, 0.4, 1.2, 0);
  }

  private showResult(): void {
    if (this.resultKind === 'victory') {
      const timeSec = (this.d.clock.nowMs - this.runStartMs) / 1000;
      const stage = this.d.stage;
      const stars = rateRun(
        {
          cleared: true,
          timeSec,
          damageTakenFrac: this.player.damageTaken / this.player.stats.maxHp,
          revives: this.player.revivesUsed,
        },
        stage.stars,
      );
      const gold = Math.round(stage.rewards.gold * this.difficulty.rewards);
      const gems = Math.round(stage.rewards.gems * this.difficulty.rewards);
      this.wallet.add('gold', gold);
      this.wallet.add('gems', gems);
      if (this.soulsThisRun > 0) this.wallet.add('souls', this.soulsThisRun);
      const prev = this.d.save.records[stage.id];
      const newBest =
        prev === undefined ||
        stars > prev.bestStars ||
        (stars === prev.bestStars && timeSec < prev.bestTimeSec);
      this.d.save.records[stage.id] = {
        bestStars: Math.max(stars, prev?.bestStars ?? 0),
        bestTimeSec:
          prev === undefined || prev.bestTimeSec <= 0
            ? timeSec
            : Math.min(prev.bestTimeSec, timeSec),
        clears: (prev?.clears ?? 0) + 1,
      };
      this.syncWallet();
      this.sfx.play('victory');
      this.d.setInputEnabled(false);
      this.hud.setVisible(false);
      this.results.showVictory(
        {
          stars,
          timeSec,
          damageTaken: this.player.damageTaken,
          perfectDodges: this.player.perfectDodges,
          souls: this.soulsThisRun,
          gold,
          gems,
          newBest,
        },
        () => this.startRun(),
      );
    } else if (this.resultKind === 'defeat') {
      const cost = ECONOMY.reviveCostGems;
      const revivesLeft = ECONOMY.maxRevivesPerRun - this.player.revivesUsed;
      const canRevive = revivesLeft > 0 && this.wallet.canAfford('gems', cost);
      this.d.setInputEnabled(false);
      this.results.showDefeat(
        { canRevive, reviveCost: cost, gems: this.wallet.get('gems'), revivesLeft },
        () => this.revive(),
        () => this.startRun(),
      );
    }
  }

  private revive(): void {
    if (!this.wallet.spend('gems', ECONOMY.reviveCostGems)) return;
    this.syncWallet();
    this.results.hide();
    this.resultKind = null;
    this.player.revive();
    this.d.setInputEnabled(true);
    this.sparks.burst(
      this.player.currFeet.x,
      1,
      this.player.currFeet.z,
      40,
      SPARK.soul,
      5,
      0,
      0,
      0.8,
      1.4,
      -0.3,
    );
  }

  private syncWallet(): void {
    this.d.save.wallet = this.wallet.snapshot();
    this.d.persist();
  }

  render(alpha: number, realDtSec: number, timeScale: number): void {
    const animDt = realDtSec * timeScale;
    for (let i = 0; i < this.actorCount; i++) this.actors[i]?.render(alpha, animDt, realDtSec);
    const feet = this.player.renderFeet;
    if (this.bossActive && this.bossIntroFinished && this.boss.alive) {
      this.bossFrame.copy(this.boss.renderFeet);
      this.d.camera.setFraming(this.bossFrame);
    }
    if (!this.cam.update(realDtSec, this.d.camera.camera)) {
      this.d.camera.update(
        feet,
        this.player.renderVelocity,
        realDtSec,
        this.player.stats.moveSpeed,
      );
    }
    this.atmosphere.update(feet, realDtSec);
    this.embers.update(realDtSec, feet);
    this.telegraphs.tick(realDtSec * 1000);
    this.sparks.update(realDtSec);
    this.trails.update(realDtSec);
    this.souls.update(realDtSec, feet.x, feet.y + 1.2, feet.z);
    this.clones.update(animDt);
    this.blobs.update(this.actors, this.actorCount);
    const size = this.d.ctx.renderer.domElement;
    this.numbers.update(realDtSec, this.d.camera.camera, size.clientWidth, size.clientHeight);
    this.updateHud(realDtSec);
  }

  private updateHud(dtSec: number): void {
    const p = this.player;
    this.statusStacks.bleed = p.status.stacksOf('bleed');
    this.statusStacks.burn = p.status.stacksOf('burn');
    this.statusStacks.slow = p.status.stacksOf('slow');
    this.hud.updatePlayer(
      {
        hp: p.health.current,
        maxHp: p.health.max,
        statusStacks: this.statusStacks,
        counterReady: p.counterReady,
      },
      dtSec,
    );
    const dir = this.director;
    let line = '';
    let showStart = false;
    if (dir.phase === 'countdown') {
      line = `Practice on the dummy — enemies in ${Math.ceil(dir.countdownRemainingMs / 1000)}s`;
      showStart = true;
    } else if (dir.phase === 'wave' || dir.phase === 'interwave') {
      line = `Wave ${dir.wave + 1} / ${dir.totalWaves} · ${this.roster.aliveCount() + dir.pendingSpawns} left`;
    }
    this.hud.setWaveLine(line, showStart);
    if (this.bossActive && this.bossIntroFinished && this.boss.inWorld) {
      const def = this.boss.bossDef;
      this.hud.updateBoss(
        {
          name: def.name,
          title: def.title,
          hpFrac: this.boss.health.frac,
          breakFrac: this.boss.poise.frac,
          broken: this.boss.isBroken,
          phaseMarks: [],
          enrageInSec: Math.max(0, (def.enrageAfterMs - this.boss.bossBrain.fightMs) / 1000),
          enraged: this.boss.bossBrain.enraged,
        },
        dtSec,
      );
    }
    this.hud.tick(dtSec);
  }

  applyQuality(preset: QualityPreset, _level: QualityLevel): void {
    this.atmosphere.applyQuality(preset);
    this.embers.setCount(preset.particleCount);
    const pr = this.d.ctx.currentPixelRatio;
    this.embers.setPixelRatio(pr);
    this.sparks.setPixelRatio(pr);
    this.sparks.density = preset.particleCount / MAX_PARTICLES + 0.25;
    this.blobs.setStrength(preset.shadows ? 0.4 : 0.6);
  }

  /**
   * Compiles every shader the battle can need — including pooled objects that start hidden
   * (trails, telegraphs, clones, inactive enemies) — so nothing compiles mid-fight on a phone.
   * three's compile() skips invisible objects, so they are made visible for the call.
   */
  warmShaders(camera: Camera): void {
    const hidden: Object3D[] = [];
    this.scene.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });
    this.d.ctx.renderer.compile(this.scene, camera);
    for (const o of hidden) o.visible = false;
  }

  // ------------------------------------------------------------------ debug / tests

  killAllEnemies(): void {
    for (const e of this.roster.active) {
      if (!e.health.dead)
        this.combat.applyHit(this.player, e, KILL_SPEC, 0, 1, { difficultyMod: 1e6 });
    }
  }

  skipToBoss(): void {
    this.director.skipCountdown();
    this.killAllEnemies();
    this.director.skipToBoss();
  }

  damageBoss(frac: number): void {
    if (!this.boss.alive) return;
    const amount = Math.ceil(this.boss.health.max * frac);
    this.boss.health.damage(Math.min(amount, this.boss.health.current - 1));
    this.boss.bossBrain.checkPhase();
  }

  killBoss(): void {
    if (this.boss.alive)
      this.combat.applyHit(this.player, this.boss, KILL_SPEC, 0, 1, { difficultyMod: 1e6 });
  }

  damagePlayer(frac: number): void {
    const p = this.player;
    if (!p.alive) return;
    const amount = Math.ceil(p.health.max * frac);
    p.health.damage(amount);
    if (p.health.dead)
      p.onHit({
        attacker: p,
        spec: KILL_SPEC,
        dirX: 0,
        dirZ: 1,
        amount,
        crit: false,
        poiseBroken: false,
        killed: true,
      });
  }

  get stageTimeSec(): number {
    return (this.d.clock.nowMs - this.runStartMs) / 1000;
  }

  get resultShowing(): 'victory' | 'defeat' | null {
    return this.results.visible ? (this.resultKind ?? null) : null;
  }

  get cinematicActive(): boolean {
    return this.cam.active;
  }

  get telegraphCount(): number {
    return this.telegraphs.activeCount;
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.player.dispose();
    this.boss.dispose();
    this.dummy.dispose();
    this.roster.dispose();
    this.clones.dispose();
    this.trails.dispose();
    this.sparks.dispose();
    this.souls.dispose();
    this.blobs.dispose();
    this.telegraphs.dispose();
    this.embers.dispose();
    this.atmosphere.dispose();
    this.builder.dispose();
    this.hud.dispose();
    this.numbers.dispose();
    this.results.dispose();
  }
}

const KILL_SPEC = {
  damage: 1,
  poise: 0,
  reaction: 'flinch' as const,
  knockback: 0,
  hitStopMs: 0,
  shake: 0,
  shape: { kind: 'circle' as const, radius: 0, forward: 0 },
};
