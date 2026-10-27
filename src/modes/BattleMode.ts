import { Vector3, type Camera, type Object3D, type Scene } from 'three';
import type { Actor } from '../actors/Actor';
import { Boss } from '../actors/Boss';
import type { Enemy, EnemyScale } from '../actors/Enemy';
import { Player } from '../actors/Player';
import { TrainingDummy } from '../actors/TrainingDummy';
import { buildActionClip, buildCustomActionClip } from '../anim/clipSets';
import { POSE_LIBRARY } from '../anim/poses';
import { AttackTokenManager } from '../ai/AttackTokens';
import { DuelistBrain } from '../ai/DuelistBrain';
import type { BrainContext } from '../ai/EnemyBrain';
import type { AudioManager } from '../audio/AudioManager';
import { Sfx } from '../audio/Sfx';
import type { Stingers } from '../audio/Stingers';
import { CameraDirector } from '../camera/CameraDirector';
import {
  bossDeathShot,
  CINEMATIC_CONFIG,
  isElite,
  KillCamLimiter,
  killCamShot,
  stageIntroShots,
  ultimateShot,
} from '../camera/cinematics';
import type { FollowCamera } from '../camera/FollowCamera';
import { CombatSystem } from '../combat/CombatSystem';
import { Effects, type EffectVisuals } from '../combat/Effects';
import type { EventBus } from '../core/EventBus';
import type { GameEvents, HitEvent, TeamName } from '../core/events';
import type { GameClock } from '../core/GameClock';
import { mulberry32 } from '../core/random';
import { ARENAS, type ArenaDef } from '../data/arenas';
import { BOSSES, type BossId } from '../data/bosses';
import type { StatBlock } from '../data/combatTypes';
import { DIFFICULTIES, type DifficultyDef, type DifficultyId } from '../data/difficulty';
import { CAMERA_CONFIG } from '../data/config';
import { ECONOMY } from '../data/economy';
import type { EnemyId } from '../data/enemies';
import type { HeroDef } from '../data/heroes';
import {
  emberCountFor,
  PARTICLE_CAPACITY,
  PARTICLE_REFERENCE,
  type QualityLevel,
  type QualityPreset,
} from '../data/quality';
import type { AssetLibrary } from '../render/env/AssetLibrary';
import { RIGS } from '../data/rigs';
import type { StageDef } from '../data/stages';
import type { StatusId } from '../data/statusEffects';
import { BOSS_LINES, HERO_LINES } from '../data/story';
import type { InputState } from '../input/InputState';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { enemyScaleFor, stageEnemyMult } from '../progression/enemyScale';
import { affixLabel } from '../data/affixes';
import type { HeroMods } from '../progression/skillTree';
import { rateRun } from '../progression/stars';
import type { Wallet } from '../progression/wallet';
import { Atmosphere } from '../render/Atmosphere';
import type { QualityTarget } from '../render/QualityManager';
import type { RenderContext } from '../render/RenderContext';
import { BattleCallouts, type ChapterCard } from '../ui/BattleCallouts';
import { BattleHud } from '../ui/BattleHud';
import { DamageNumbers } from '../ui/DamageNumbers';
import { ResultScreen } from '../ui/ResultScreen';
import { BlobShadows } from '../vfx/BlobShadows';
import { EmberField } from '../vfx/EmberField';
import { ShadowClones } from '../vfx/ShadowClones';
import { SoulOrbs } from '../vfx/SoulOrbs';
import { Sparks } from '../vfx/Sparks';
import { Fx } from '../vfx/Fx';
import { FxLights } from '../vfx/FxLights';
import { FxDirector } from './FxDirector';
import { TelegraphDecals } from '../vfx/TelegraphDecals';
import { PetCompanion } from '../vfx/PetCompanion';
import type { PetLook } from '../data/pets';
import { WeaponTrails } from '../vfx/WeaponTrails';
import { ArenaBuilder } from './ArenaBuilder';
import { BattleFeel } from './BattleFeel';
import { separateCrowd } from './crowd';
import { EnemyRoster } from './EnemyRoster';
import { WaveDirector, type WaveWorld } from './WaveDirector';

/** Engine services a battle runs on. The physics world and scene belong to this battle only. */
export interface BattleDeps {
  readonly ctx: RenderContext;
  readonly physics: PhysicsWorld;
  readonly camera: FollowCamera;
  readonly input: InputState;
  readonly bus: EventBus<GameEvents>;
  readonly clock: GameClock;
  readonly audio: AudioManager;
  readonly uiRoot: HTMLElement;
  readonly preset: QualityPreset;
  /** Scanned arena assets (preloaded for this stage's arena); null builds procedural arenas. */
  readonly assets?: AssetLibrary | null;
  /** The player's wallet (revives cost gems). */
  readonly wallet: Wallet;
  /** Persists wallet changes made during the battle. */
  readonly commitWallet: () => void;
  /** Enables/disables player input (cinematics, result screens). */
  readonly setInputEnabled: (enabled: boolean) => void;
  readonly vibrate: (ms: number) => void;
  /** Musical cues (boss sting, combo ranks, fanfare, heartbeat…). */
  readonly stingers: Stingers;
  /** Settings → Reduce flashes (read live). */
  readonly reduceFlashes: () => boolean;
  /** Called once when the battle ends (victory, or the player gives up after a defeat). */
  readonly onFinish: (outcome: BattleOutcome) => void;
}

/** What to fight and with whom — chosen by the mode that starts the battle. */
export interface BattleSetup {
  readonly stage: StageDef;
  readonly difficulty: DifficultyId;
  readonly hero: HeroDef;
  readonly heroStats: StatBlock;
  readonly mods: HeroMods;
  /** Banner / HUD label, e.g. "1-3 · Gate of Soot". */
  readonly label: string;
  /** HP fraction to start with (dungeon rooms carry damage over). */
  readonly startHpFrac: number;
  /** Extra enemy multipliers on top of level + difficulty (tower floors, challenge tiers, hunts). */
  readonly enemyMult: { readonly hp: number; readonly atk: number; readonly speed?: number };
  readonly allowRevive: boolean;
  /** Arena: an AI-controlled hero to defeat (the stage should be a `duel` stage). */
  readonly duel?: DuelSetup;
  /** Adventure: a chapter's first stage opens with the chapter card instead of the label banner. */
  readonly chapterIntro?: ChapterCard;
  /** The active pet: follows the hero and strikes the nearest foe every `everySec`. */
  readonly pet?: PetSetup | null;
}

export interface PetSetup {
  readonly name: string;
  readonly look: PetLook;
  readonly everySec: number;
  /** Damage as a multiple of the hero's ATK. */
  readonly mult: number;
  readonly rangeM: number;
}

export interface DuelSetup {
  readonly name: string;
  readonly title: string;
  readonly hero: HeroDef;
  readonly stats: StatBlock;
  readonly mods: HeroMods;
  /** 0..1 — reaction speed, dodge chance and aggression. */
  readonly skill: number;
}

export interface BattleOutcome {
  readonly victory: boolean;
  /** True when the player left from the pause menu. */
  readonly abandoned: boolean;
  readonly timeSec: number;
  readonly stars: number;
  readonly damageTaken: number;
  readonly perfectDodges: number;
  readonly revives: number;
  readonly kills: number;
  readonly bossKilled: boolean;
  /** The boss fight began (its intro played). */
  readonly bossReached: boolean;
  readonly souls: number;
  readonly hpFrac: number;
}

const DEFEAT_SCREEN_DELAY_MS = 1600;
const VICTORY_DELAY_MS = 2600;
/** Real-time delay before the VICTORY title (after a boss falls its last words come first). */
const VICTORY_TITLE_MS = { boss: 1700, waves: 450 } as const;
const ULT_CLONE_INTERVAL_MS = 220;

const TRAIL_COLORS = { enemy: 0xff5a2a, boss: 0xff7a2a } as const;
const ZONE_COLOR = { enemy: 0xff3a1a, player: 0xb080ff } as const;
/** World-space movement basis for AI-driven heroes (move.y = +Z, move.x = +X). */
const WORLD_BASIS = { forwardXZ: { x: 0, z: 1 }, rightXZ: { x: 1, z: 0 } } as const;
const SPARK = {
  hit: 0xffc890,
  crit: 0xffe070,
  player: 0xff3020,
  ash: 0x806860,
  soul: 0x90b0ff,
  perfect: 0xb080ff,
} as const;

/**
 * One battle: arena, hero, optional training dummy, enemy waves, an optional boss, all combat
 * feedback (hit-stop, shake, numbers, sparks, trails, SFX), HUD and the defeat/revive flow.
 * Created when a battle starts and disposed when it ends; owns everything it creates.
 */
export class BattleMode implements QualityTarget, WaveWorld {
  readonly player: Player;
  readonly boss: Boss | null;
  /** Arena opponent (AI-controlled hero), if this is a duel. */
  readonly duelist: Player | null;
  private readonly duelBrain: DuelistBrain | null;
  readonly dummy: TrainingDummy;
  readonly roster: EnemyRoster;
  readonly combat: CombatSystem;
  readonly tokens: AttackTokenManager;
  readonly effects: Effects;
  readonly arena: ArenaDef;
  director: WaveDirector;
  private readonly builder: ArenaBuilder;
  private readonly atmosphere: Atmosphere;
  private readonly embers: EmberField;
  private readonly telegraphs: TelegraphDecals;
  private readonly sparks: Sparks;
  private readonly fx: Fx;
  private readonly fxd: FxDirector;
  private readonly fxLights: FxLights;
  private readonly trails: WeaponTrails;
  private readonly souls: SoulOrbs;
  private readonly blobs: BlobShadows;
  private readonly clones: ShadowClones;
  private readonly hud: BattleHud;
  private readonly callouts: BattleCallouts;
  private readonly feel: BattleFeel;
  private readonly numbers: DamageNumbers;
  private readonly results: ResultScreen;
  private readonly sfx: Sfx;
  private readonly cam: CameraDirector;
  private readonly rng = mulberry32(20261018);
  private readonly actors: Actor[] = [];
  private actorCount = 0;
  private readonly disposers: (() => void)[] = [];
  private readonly scene: Scene;
  private readonly difficulty: DifficultyDef;
  private readonly enemyScale: EnemyScale;
  private readonly bossScale: EnemyScale;
  /** Boss title with its elite affixes ("Keeper of the Cinder Gate · Warded"). */
  private readonly bossTitle: string;
  private bossActive = false;
  private bossIntroFinished = false;
  private bossDown = false;
  private runStartMs = 0;
  private resultTimerMs = -1;
  private resultKind: 'victory' | 'defeat' | null = null;
  private finished = false;
  private soulsThisRun = 0;
  private ultCloneTimer = 0;
  private chargeSparkSec = 0;
  private duelHudShown = false;
  private introPending = false;
  private dotTarget: Actor | null = null;
  /** Cinematic state: the opening fly-over plays once per battle (not again on retry). */
  private introPlayed = false;
  private stageIntroActive = false;
  private entranceDone = false;
  private pendingVictoryShot = false;
  private readonly killCams = new KillCamLimiter();
  private readonly tmp = new Vector3();
  private readonly bossFrame = new Vector3();
  private readonly statusStacks: Record<StatusId, number> = { bleed: 0, burn: 0, slow: 0 };
  /** Debug/test counters. */
  enemiesKilled = 0;
  petStrikes = 0;
  private readonly pet: PetCompanion | null;
  private petTimer = 0;

  constructor(
    private readonly d: BattleDeps,
    readonly setup: BattleSetup,
  ) {
    this.scene = d.ctx.scene;
    this.pet =
      setup.pet !== undefined && setup.pet !== null
        ? new PetCompanion(this.scene, setup.pet.look)
        : null;
    this.arena = ARENAS[setup.stage.arena];
    this.difficulty = DIFFICULTIES[setup.difficulty];
    const st = setup.stage;
    const mult = stageEnemyMult(st, setup.enemyMult);
    this.enemyScale = enemyScaleFor(st.level, setup.difficulty, mult, st.affixes);
    this.bossScale = enemyScaleFor(st.level, setup.difficulty, mult, st.bossAffixes);
    this.builder = new ArenaBuilder(
      this.arena,
      d.physics,
      d.preset,
      d.ctx.renderer,
      d.assets ?? null,
    );
    this.builder.addTo(this.scene);
    this.atmosphere = new Atmosphere(d.ctx, this.arena);
    this.embers = new EmberField(PARTICLE_CAPACITY, this.arena.palette.ember);
    this.scene.add(this.embers.points);
    this.telegraphs = new TelegraphDecals(this.scene, 32);
    this.sparks = new Sparks(this.scene);
    this.fx = new Fx(this.scene);
    this.fxLights = new FxLights(this.scene);
    this.fxd = new FxDirector(this.fx, this.sparks, d.ctx, d.bus, Math.random, this.fxLights);
    this.trails = new WeaponTrails(this.scene, 16);
    this.souls = new SoulOrbs(this.scene);
    this.blobs = new BlobShadows(this.scene);
    this.sfx = new Sfx(d.audio);
    this.cam = new CameraDirector();
    this.combat = new CombatSystem(d.physics, d.bus, this.rng);
    this.tokens = new AttackTokenManager(this.difficulty.attackTokens);
    this.effects = new Effects(
      this.scene,
      this.combat,
      d.physics,
      d.bus,
      this.effectVisuals,
      (team) => this.opponentsOf(team),
      this.rng,
    );

    const hero = setup.hero;
    this.player = new Player({
      hero,
      physics: d.physics,
      scene: this.scene,
      combat: this.combat,
      input: d.input,
      bus: d.bus,
      clock: () => d.clock.nowMs,
      basis: d.camera,
      targets: () => this.targetList(),
      stats: setup.heroStats,
      mods: setup.mods,
      effects: this.effects,
    });
    this.playerList.push(this.player);
    this.combat.register(this.player);
    this.trails.attach(this.player.rig, 'right', hero.color, () => {
      const s = this.player.trailSide();
      return s === 'right' || s === 'both';
    });
    this.trails.attach(this.player.rig, 'left', hero.color, () => {
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
      effects: this.effects,
      summon: (id, count) => {
        for (let i = 0; i < count; i++) this.spawnEnemy(id);
      },
    };
    this.roster = new EnemyRoster({ physics: d.physics, scene: this.scene, ctx }, this.combat);
    this.prewarmPools();
    const bossId = setup.stage.boss;
    if (bossId !== null) {
      const def = BOSSES[bossId];
      const boss = new Boss(def, { physics: d.physics, scene: this.scene, ctx });
      this.combat.register(boss);
      boss.bossBrain.onShockwave = (x, z) => {
        this.telegraphs.ring(x, z, def.transitionPushRadius, 0xff7a2a, 700);
        this.sparks.burst(x, 0.4, z, 40, 0xff7a2a, 9, 0, 0, 0.6, 1.4, 0.4);
      };
      this.trails.attach(boss.rig, 'right', TRAIL_COLORS.boss, () => this.enemyTrailOn(boss));
      this.boss = boss;
      const affixes = affixLabel(setup.stage.bossAffixes);
      this.bossTitle = affixes.length > 0 ? `${def.title} · ${affixes}` : def.title;
    } else {
      this.boss = null;
      this.bossTitle = '';
    }
    this.dummy = new TrainingDummy(d.physics, this.scene);
    this.combat.register(this.dummy);

    const duel = setup.duel;
    if (duel !== undefined) {
      const brainRef: { brain: DuelistBrain | null } = { brain: null };
      const opp = new Player({
        hero: duel.hero,
        physics: d.physics,
        scene: this.scene,
        combat: this.combat,
        // Replaced right below by the brain's own input (the constructor only stores it).
        input: d.input,
        bus: d.bus,
        clock: () => d.clock.nowMs,
        basis: WORLD_BASIS,
        targets: () => this.playerList,
        stats: duel.stats,
        mods: duel.mods,
        effects: this.effects,
        team: 'enemy',
        human: false,
        inputSource: () => brainRef.brain?.input ?? d.input,
      });
      this.combat.register(opp);
      this.trails.attach(opp.rig, 'right', duel.hero.color, () => {
        const sd = opp.trailSide();
        return sd === 'right' || sd === 'both';
      });
      this.trails.attach(opp.rig, 'left', duel.hero.color, () => {
        const sd = opp.trailSide();
        return sd === 'left' || sd === 'both';
      });
      const brain = new DuelistBrain(opp, this.player, this.rng, duel.skill);
      brainRef.brain = brain;
      this.duelist = opp;
      this.duelBrain = brain;
    } else {
      this.duelist = null;
      this.duelBrain = null;
    }

    // Ultimate clones use the hero's own rig and slash clips.
    const idle = POSE_LIBRARY[hero.idlePose];
    const cloneClips = hero.combo
      .slice(0, 3)
      .map((a) =>
        a.clip !== undefined ? buildCustomActionClip(a.clip, a, idle) : buildActionClip(a, idle),
      );
    const rigId = hero.visual.kind === 'rig' ? hero.visual.rig : 'kael';
    this.clones = new ShadowClones(
      this.scene,
      RIGS[rigId],
      cloneClips.map((c) => c.name),
      cloneClips,
      hero.ultimate.clones,
    );

    this.hud = new BattleHud(d.uiRoot, () => this.skipCountdown());
    this.hud.setHeroName(hero.name);
    this.numbers = new DamageNumbers(d.uiRoot);
    this.callouts = new BattleCallouts(d.uiRoot);
    this.feel = new BattleFeel({
      bus: d.bus,
      hud: this.hud,
      callouts: this.callouts,
      stingers: d.stingers,
      reduceFlashes: d.reduceFlashes,
      vibrate: d.vibrate,
    });
    this.fxd.screenEffects = !d.reduceFlashes();
    this.results = new ResultScreen(d.uiRoot);
    this.director = new WaveDirector(setup.stage, this);

    this.combat.onDamage = (attacker, target, amount) => this.onDamage(attacker, target, amount);
    this.wireEvents();
    this.startRun();
  }

  // ------------------------------------------------------------------ setup

  private prewarmPools(): void {
    const max = new Map<EnemyId, number>();
    for (const w of this.setup.stage.waves) {
      const perWave = new Map<EnemyId, number>();
      for (const s of w.spawns) perWave.set(s.enemy, (perWave.get(s.enemy) ?? 0) + s.count);
      for (const [id, n] of perWave) max.set(id, Math.max(max.get(id) ?? 0, n));
    }
    for (const [id, n] of max) this.roster.prewarm(id, Math.min(n, this.d.preset.maxActiveEnemies));
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

  private readonly targets: Actor[] = [];
  private readonly playerList: Actor[] = [];

  private opponentsOf(team: TeamName): readonly Actor[] {
    return team === 'enemy' ? this.playerList : this.targetList();
  }

  private readonly effectVisuals: EffectVisuals = {
    showZone: (x, z, radius, enemy) =>
      this.telegraphs.show(
        { kind: 'circle', radius, forward: 0 },
        x,
        z,
        0,
        enemy ? ZONE_COLOR.enemy : ZONE_COLOR.player,
        // The hero's own zones are a faint hint; enemy zones must read clearly.
        enemy ? 1 : 0.28,
      ),
    updateZone: (h, progress, x, z) => this.telegraphs.update(h, progress, x, z, 0),
    hideZone: (h) => this.telegraphs.hide(h),
    blast: (kind, x, z, radius, enemy) => {
      const color = enemy ? 0xff6a2a : 0xb080ff;
      switch (kind) {
        case 'rain':
          this.sparks.burst(x, 4, z, 16, enemy ? 0xff8a3a : 0xd8c8ff, 1.5, 0, 0, 0.45, 1.1, 7);
          break;
        case 'trap':
          this.telegraphs.ring(x, z, radius * 1.2, color, 450);
          this.sparks.burst(x, 0.4, z, 30, color, 6, 0, 0, 0.6, 1.3, 0.5);
          this.sfx.play('slam', 0.6);
          break;
        case 'shockwave':
          this.telegraphs.ring(x, z, radius, color, 520);
          this.sparks.burst(x, 0.3, z, 30, color, 8, 0, 0, 0.5, 1.2, 0.5);
          break;
        case 'meteor':
          this.telegraphs.ring(x, z, radius * 1.15, 0xff7a2a, 700);
          this.sparks.burst(x, 0.6, z, 70, 0xff7a2a, 11, 0, 0, 0.8, 1.6, 0.6);
          this.d.bus.emit('camera:shake', { trauma: 0.6 });
          this.sfx.play('slam');
          break;
        case 'fire':
        case 'eruption':
          this.sparks.burst(x, 0.3, z, 26, 0xff6a1a, 5, 0, 0, 0.7, 1.4, -0.6);
          if (kind === 'eruption') this.sfx.play('slam', 0.5);
          break;
        case 'explosion':
          this.telegraphs.ring(x, z, radius, color, 420);
          this.sparks.burst(x, 0.8, z, 36, enemy ? 0xff7a2a : 0xc0a0ff, 8, 0, 0, 0.55, 1.3, 0.4);
          this.sfx.play('slam', 0.5);
          break;
        case 'impact':
          this.sparks.burst(x, 1.1, z, 6, enemy ? 0xffa060 : 0xe0d0ff, 3, 0, 0, 0.3, 0.9, 0.5);
          break;
      }
    },
  };

  private targetList(): readonly Actor[] {
    // Auto-aim/Umbral Step targets: living enemies + boss + dummy.
    this.targets.length = 0;
    for (const e of this.roster.active) if (e.alive) this.targets.push(e);
    if (this.boss !== null && this.boss.alive) this.targets.push(this.boss);
    if (this.duelist !== null && this.duelist.alive) this.targets.push(this.duelist);
    if (this.dummy.alive) this.targets.push(this.dummy);
    return this.targets;
  }

  private wireEvents(): void {
    const b = this.d.bus;
    this.disposers.push(
      b.on('combat:hit', (e) => this.onHitEvent(e)),
      b.on('combat:death', (e) => this.onDeath(e.actorId, e.team, e.x, e.z)),
      b.on('enemy:dissolve', (e) =>
        this.fxd.ashes(e.x, e.y, e.z, e.height, e.progress, e.color, e.big),
      ),
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
      // Any gameplay input during the opening fly-over hands control back at once.
      b.on('input:pressed', () => {
        if (this.stageIntroActive) this.cam.skip();
      }),
      b.on('player:died', () => {
        this.cutStageIntro();
        this.resultKind = 'defeat';
        this.resultTimerMs = DEFEAT_SCREEN_DELAY_MS;
        this.director.markDefeat();
        this.sfx.play('defeat');
      }),
      b.on('enemy:telegraph', (e) => {
        const who =
          this.boss !== null && this.boss.id === e.actorId
            ? this.boss
            : this.roster.active.find((x) => x.id === e.actorId);
        const atk = who?.attackById(e.attackId);
        if (who !== undefined && atk !== undefined)
          this.fxd.playAction(
            who,
            atk,
            who.actionSpeed,
            who === this.boss ? TRAIL_COLORS.boss : TRAIL_COLORS.enemy,
            this.player.currFeet,
          );
        const actor = this.boss !== null && e.actorId === this.boss.id;
        if (actor || e.attackId.startsWith('brute') || e.attackId.endsWith('_blast'))
          this.sfx.play('telegraph');
      }),
      b.on('boss:phase', (e) => {
        this.sfx.play('roar');
        const name = this.boss?.bossDef.name ?? '';
        this.feel.bossPhase(name, e.label, () => this.fxd.screen(0.42, 0xff6a2a, 0.01));
        // Push in on the enraged boss for a beat.
        this.d.camera.punch(-0.16, 1300);
      }),
      b.on('ultimate:charge', (e) => this.feel.ultimateCharge(e.value)),
      b.on('boss:break', (e) => {
        const boss = this.boss;
        if (e.broken && boss !== null) {
          this.hud.showBanner('BREAK!', 'break', 1200);
          this.sfx.play('break');
          this.sparks.burst(
            boss.currFeet.x,
            3,
            boss.currFeet.z,
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
      b.on('enemy:affix', (e) => {
        // Ward shatters in pale shards, reforms with a soft ring; a frenzy flares red.
        const color = e.kind === 'frenzy' ? 0xff3a2a : 0x8ad8ff;
        this.sparks.burst(
          e.x,
          e.y,
          e.z,
          e.kind === 'wardUp' ? 14 : 30,
          color,
          5,
          0,
          0,
          0.5,
          1.2,
          0.3,
        );
        if (e.kind === 'wardBroken' && this.boss !== null && e.actorId === this.boss.id)
          this.hud.showBanner('WARD SHATTERED', 'break', 1000);
        else if (e.kind === 'frenzy' && this.boss !== null && e.actorId === this.boss.id)
          this.hud.showBanner('FRENZY', 'warn', 1200);
      }),
      b.on('enemy:exploded', (e) => {
        this.effectVisuals.blast('explosion', e.x, e.z, e.radius, true);
        this.d.bus.emit('camera:shake', { trauma: 0.35 });
      }),
      b.on('boss:grab', (e) => {
        if (e.holding) this.hud.showBanner('GRABBED!', 'warn', 1000);
      }),
      b.on('boss:enrage', () => {
        this.hud.showBanner('ENRAGED', 'warn', 1800);
        this.sfx.play('roar');
      }),
    );
    this.souls.onCollect = () => this.sfx.play('soul', 0.6);
    // A tap anywhere (also on the touch layer, which covers the canvas) skips the fly-over and
    // the boss death shot.
    const onTap = (): void => {
      if (this.stageIntroActive || this.cam.kind === 'bossDeath') this.cam.skip();
    };
    window.addEventListener('pointerdown', onTap, { capture: true, passive: true });
    this.disposers.push(() => window.removeEventListener('pointerdown', onTap, { capture: true }));
  }

  // ------------------------------------------------------------------ run flow

  /** (Re)starts the battle from the beginning. */
  startRun(): void {
    this.fx.clear();
    this.fxd.clear();
    this.roster.clear();
    if (this.boss !== null) {
      this.boss.brain.reset();
      this.boss.removeFromWorld();
    }
    this.effects.clear();
    this.telegraphs.hideAll();
    this.souls.clear();
    this.clones.clear();
    this.numbers.clear();
    this.results.hide();
    this.hud.reset();
    this.feel.reset();
    this.hud.setVisible(true);
    this.tokens.clear();
    this.cam.cancel();
    this.stageIntroActive = false;
    this.pendingVictoryShot = false;
    this.killCams.reset();
    this.d.camera.setFraming(null);
    this.bossActive = false;
    this.bossIntroFinished = false;
    this.bossDown = false;
    this.resultKind = null;
    this.resultTimerMs = -1;
    this.finished = false;
    this.soulsThisRun = 0;
    this.enemiesKilled = 0;
    this.petStrikes = 0;
    this.petTimer = (this.setup.pet?.everySec ?? 0) * 0.6;
    const [sx, , sz] = this.arena.spawn;
    this.player.resetForRun(sx, sz, Math.PI, this.setup.startHpFrac);
    if (this.setup.stage.trainingDummy) {
      const [dx, dz] = this.arena.dummySpawn;
      this.dummy.health.reset(1);
      this.dummy.spawnAt(dx, dz, 0);
    } else {
      this.dummy.removeFromWorld();
    }
    if (this.duelist !== null) {
      const [bx, bz] = this.arena.bossSpawn;
      this.duelist.resetForRun(bx, bz, 0);
      this.duelBrain?.reset();
      this.duelHudShown = false;
    }
    this.director = new WaveDirector(this.setup.stage, this);
    this.runStartMs = this.d.clock.nowMs;
    this.d.camera.snap(this.player.currFeet);
    this.d.setInputEnabled(true);
    // The chapter card starts with the first rendered frame (building the arena can take a while).
    this.introPending = this.setup.chapterIntro !== undefined;
    if (!this.introPlayed) {
      this.introPlayed = true;
      this.startStageIntro();
    } else if (!this.introPending) {
      this.hud.showBanner(this.setup.label.toUpperCase(), 'wave', 1800);
    }
  }

  // ------------------------------------------------------------------ cinematics

  /**
   * Opening fly-over: a high sweep across the arena's landmark, a crane down onto the hero (who
   * draws their weapon), then a swing into the gameplay camera. The stage clock waits for it;
   * a tap, any input or moving skips it.
   */
  private startStageIntro(): void {
    const p = this.player;
    const o = this.d.camera.options;
    const [lx, lz] = this.arena.bossSpawn;
    const shots = stageIntroShots({
      hero: p.currFeet,
      heroYaw: p.yaw,
      landmark: { x: lx, z: lz },
      arenaRadius: this.arena.floorRadius,
      follow: {
        distance: o.distance,
        height: o.height,
        lookAtHeight: CAMERA_CONFIG.lookAtHeight,
        yawDeg: CAMERA_CONFIG.yawDeg,
      },
    });
    const total = shots.reduce((t, sh) => t + sh.durationMs, 0);
    this.stageIntroActive = true;
    this.entranceDone = false;
    // The chapter card titles a chapter's first stage; otherwise the stage name shows here.
    this.feel.stageIntro(this.introPending ? null : this.setup.label, total);
    this.cam.playSequence(shots, () => this.endStageIntro(), null, 'stageIntro');
  }

  private endStageIntro(): void {
    if (!this.stageIntroActive) return;
    this.stageIntroActive = false;
    this.feel.stageIntroEnd();
    this.d.camera.blendFromCurrent();
  }

  /** Cuts the fly-over now (Start now / test hooks / the boss arriving). */
  private cutStageIntro(): void {
    if (!this.stageIntroActive) return;
    this.cam.cancel();
    this.endStageIntro();
  }

  /** The hero lands in the close-up: weapon flourish, dust ring, a thud. */
  private heroEntrance(): void {
    this.entranceDone = true;
    const f = this.player.currFeet;
    this.player.playEntrance();
    this.telegraphs.ring(f.x, f.z, 2.4, this.setup.hero.color, 520);
    this.sparks.burst(f.x, 0.25, f.z, 28, SPARK.ash, 5, 0, 0, 0.7, 1.5, -0.1);
    this.sparks.burst(f.x, 1.2, f.z, 12, this.setup.hero.color, 3, 0, 0, 0.45, 1.1, -0.3);
    this.sfx.play('slam', 0.45);
    this.feel.heroEntrance();
  }

  /** Brief slow-motion push-in on a kill (rate limited; never over another shot). */
  private tryKillCam(kind: 'elite' | 'waveEnd', x: number, z: number): void {
    if (this.cam.active || !this.player.alive || this.resultKind !== null) return;
    if (!this.killCams.tryFire(kind, this.d.clock.nowMs)) return;
    const k = CINEMATIC_CONFIG.killCam;
    this.feel.killCam(k.slowScale, k.slowMs);
    this.cam.play(
      killCamShot(this.tmp.set(x, this.player.currFeet.y, z), this.player.currFeet),
      () => this.d.camera.blendFromCurrent(),
      null,
      'killCam',
    );
  }

  /** Slow-motion arc around the falling boss / rival, a burst and a flash; then the victory shot. */
  private playBossDeath(actor: Actor, x: number, z: number, color: number): void {
    const scale = actor.rig.height / 1.9;
    const y = actor.currFeet.y;
    this.sparks.burst(x, 1.6 * scale, z, 90, color, 12, 0, 0, 0.9, 1.8, 0.2);
    this.sparks.burst(x, 0.4, z, 50, SPARK.ash, 7, 0, 0, 1, 1.9, -0.2);
    this.telegraphs.ring(x, z, 5 * scale, color, 900);
    this.fxLights.flash(x, 2 * scale, z, 0xffe0b0, 2, 0.7);
    this.feel.bossDeath(() => this.fxd.screen(0.5, 0xffe6c0, 0.012));
    this.cam.play(
      bossDeathShot(this.tmp.set(x, y, z), this.player.currFeet, scale),
      () => {
        if (this.pendingVictoryShot) {
          this.pendingVictoryShot = false;
          this.playVictoryShot();
        } else {
          this.d.camera.blendFromCurrent();
        }
      },
      null,
      'bossDeath',
    );
  }

  /** Skips the practice countdown (Start now button, test hook) and the opening fly-over. */
  skipCountdown(): void {
    this.cutStageIntro();
    this.director.skipCountdown();
  }

  // WaveWorld ---------------------------------------------------------

  spawnEnemy(id: EnemyId): boolean {
    if (this.roster.aliveCount() >= this.d.preset.maxActiveEnemies) return false;
    const pts = this.arena.spawnPoints;
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
    const e = this.roster.spawn(id, x, z, yaw, this.enemyScale);
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
    const boss = this.boss;
    if (boss === null) return;
    this.cutStageIntro();
    this.removeDummy();
    const [bx, bz] = this.arena.bossSpawn;
    const yaw = Math.atan2(this.player.currFeet.x - bx, this.player.currFeet.z - bz);
    boss.activate(bx, bz, yaw, this.bossScale);
    this.bossActive = true;
    this.bossIntroFinished = false;
    this.d.setInputEnabled(false);
    const def = boss.bossDef;
    this.sfx.play('roar');
    this.feel.bossIntro(
      { name: def.name, title: this.bossTitle, line: BOSS_LINES[def.id as BossId].taunt },
      def.introMs,
    );
    // Framing in units of a 1.9 m figure (creatures are lower / taller than their scale says).
    // A low, wide sweep that pushes in on the boss.
    const scale = boss.rig.height / 1.9;
    this.cam.play(
      {
        center: this.tmp.set(bx, 0, bz),
        radius: 5.4 * scale,
        height: 0.9 * scale,
        fromDeg: (yaw * 180) / Math.PI + 55,
        toDeg: (yaw * 180) / Math.PI - 12,
        durationMs: def.introMs,
        lookHeight: 1.3 * scale,
        endRadiusMult: 0.58,
      },
      () => this.finishBossIntro(),
      null,
      'bossIntro',
    );
    this.d.bus.emit('stage:bossIntro', {});
  }

  private finishBossIntro(): void {
    const boss = this.boss;
    if (this.bossIntroFinished || boss === null) return;
    this.bossIntroFinished = true;
    this.feel.bossIntroEnd();
    this.d.camera.blendFromCurrent();
    this.d.setInputEnabled(true);
    boss.bossBrain.beginFight();
    const def = boss.bossDef;
    this.hud.showBoss({
      name: def.name,
      title: this.bossTitle,
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
    this.callouts.hideChapter();
    this.feel.waveStart(wave, total);
    // Camera beat: ease back to take in the incoming wave.
    const final = total > 1 && wave === total - 1;
    this.d.camera.punch(final ? 0.2 : 0.13, final ? 1600 : 1200);
    this.feel.waveBeat(final);
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
    const last = wave >= this.setup.stage.waves.length - 1;
    this.feel.waveCleared(last, this.boss !== null);
    this.d.bus.emit('wave:cleared', { wave });
  }

  onVictory(): void {
    this.resultKind = 'victory';
    this.resultTimerMs = VICTORY_DELAY_MS;
    const bossFight = this.bossDown;
    if (!bossFight) {
      // The final kill of a wave stage: a beat of slow motion and a push-in on the hero.
      this.d.bus.emit('time:slowMotion', { scale: 0.3, ms: 900 });
    }
    this.d.setInputEnabled(false);
    this.player.playVictory();
    // After a boss falls its death shot plays out first; the victory orbit follows it.
    if (this.cam.active && this.cam.kind === 'bossDeath') this.pendingVictoryShot = true;
    else this.playVictoryShot();
    this.feel.victory(bossFight ? VICTORY_TITLE_MS.boss : VICTORY_TITLE_MS.waves);
    this.d.bus.emit('stage:victory', {});
  }

  /** Slow orbit around the hero while VICTORY plays (cosmetic; any tap ends it). */
  private playVictoryShot(): void {
    const p = this.player;
    const yawDeg = (p.yaw * 180) / Math.PI;
    this.cam.play(
      {
        center: this.tmp.copy(p.currFeet),
        radius: 4.2,
        height: 1.5,
        fromDeg: yawDeg + 150,
        toDeg: yawDeg + 205,
        durationMs: 3400,
        lookHeight: 1.15,
        endRadiusMult: 0.72,
      },
      () => this.d.camera.blendFromCurrent(),
      p.renderFeet,
      'victory',
    );
  }

  // ------------------------------------------------------------------ events

  private onDamage(attacker: Actor | null, target: Actor, amount: number): void {
    const p = this.player;
    const hero = this.setup.hero;
    const gain = this.setup.mods.ultGain;
    if (attacker === p) {
      // The dummy charges the ultimate at half rate so practice is useful but not abusable.
      const rate = target === this.dummy ? 0.5 : 1;
      p.ultimate.add(amount * hero.ultGainPerDamage * gain * rate);
      this.d.bus.emit('ultimate:charge', { value: p.ultimate.value });
      const leech = this.setup.mods.lifesteal;
      if (leech > 0 && target !== this.dummy) p.health.heal(amount * leech);
    }
    if (target === p) {
      p.ultimate.add((amount / p.stats.maxHp) * hero.ultGainPerHpLost * gain);
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
      e.blocked ? 'dot' : kind,
    );
    if (e.dot) return;
    this.fxd.hit(e);
    if (e.blocked) {
      this.numbers.spawn('BLOCK', e.x, e.y + 0.45, e.z, 'info');
      this.sparks.burst(e.x, e.y - 0.6, e.z, 10, 0xd0d8e8, 5, -e.dirX, -e.dirZ, 0.3, 0.9, 1);
      this.sfx.play('hit', 0.5);
      return;
    }
    if (isPlayerTarget) {
      this.feel.playerHurt();
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
    this.feel.hitLanded(this.hud.registerHit());
    if (e.killed && e.attackerId === this.player.id && e.targetId !== this.dummy.id)
      this.feel.enemyKilled(this.d.clock.nowMs, e.shake > 0.35 || e.crit || e.poiseBroken);
    if (e.counter) this.numbers.spawn('COUNTER', e.x, e.y + 0.5, e.z, 'info');
    if (e.poiseBroken && (this.boss === null || e.targetId !== this.boss.id))
      this.numbers.spawn('STAGGER', e.x, e.y + 0.4, e.z, 'info');
  }

  private onDeath(actorId: number, team: string, x: number, z: number): void {
    if (team !== 'enemy') return;
    const big = (this.boss !== null && actorId === this.boss.id) || actorId === this.duelist?.id;
    this.fxd.death(x, z, big ? 0xffb050 : 0xff7a3a, big);
    if (this.duelist !== null && actorId === this.duelist.id) {
      this.bossDown = true;
      this.d.bus.emit('time:slowMotion', { scale: 0.25, ms: 1200 });
      this.d.bus.emit('camera:shake', { trauma: 0.6 });
      this.hud.showBanner(`${this.setup.duel?.name.toUpperCase() ?? 'RIVAL'} FALLS`, 'phase', 2200);
      this.hud.hideBoss();
      this.d.camera.setFraming(null);
      this.playBossDeath(this.duelist, x, z, this.setup.duel?.hero.color ?? 0xffb050);
      return;
    }
    const boss = this.boss;
    if (boss !== null && actorId === boss.id) {
      this.bossDown = true;
      const souls = Math.round(boss.bossDef.souls * this.difficulty.rewards);
      this.soulsThisRun += souls;
      this.souls.burst(x, 2.5, z, Math.min(30, souls));
      this.d.bus.emit('time:slowMotion', { scale: 0.25, ms: 1400 });
      this.d.bus.emit('camera:shake', { trauma: 0.9 });
      this.sfx.play('roar');
      this.feel.bossFell(boss.bossDef.name, BOSS_LINES[boss.bossDef.id as BossId].fall);
      this.hud.hideBoss();
      this.d.camera.setFraming(null);
      this.telegraphs.hideAll();
      this.playBossDeath(boss, x, z, 0xffb050);
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
    // Kill cam: an elite falls, or the last enemy of a wave (not the stage's very last kill,
    // where the victory shot takes over).
    const dir = this.director;
    const lastOfWave =
      dir.phase === 'wave' && dir.pendingSpawns === 0 && this.roster.aliveCount() === 0;
    const stageEnds =
      lastOfWave && dir.wave >= dir.totalWaves - 1 && this.boss === null && this.duelist === null;
    if (lastOfWave && !stageEnds) this.tryKillCam('waveEnd', x, z);
    else if (e !== undefined && isElite(e.def.stats.maxHp)) this.tryKillCam('elite', x, z);
  }

  private onPlayerAction(kind: 'attack' | 'dodge' | 'skill' | 'ultimate', index: number): void {
    const def = this.player.currentAction;
    if (kind !== 'dodge' && def !== null)
      this.fxd.playAction(
        this.player,
        def,
        this.player.stats.attackSpeed,
        this.setup.hero.color,
        this.player.aimPoint,
      );
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
        const hero = this.setup.hero;
        this.feel.ultimate(hero.ultimate.name, `#${hero.color.toString(16).padStart(6, '0')}`);
        this.fxd.screen(0.3, hero.color, 0.006);
        // A short move picked from the ultimate's own data (low angle / pull-out / orbit).
        this.cam.play(
          ultimateShot(hero.ultimate, p.currFeet, p.yaw),
          () => this.d.camera.blendFromCurrent(),
          p.renderFeet,
          'ultimate',
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
    if (this.boss !== null && this.boss.inWorld) put(this.boss);
    if (this.duelist !== null && this.duelist.inWorld) put(this.duelist);
    for (const e of this.roster.active) put(e);
    this.actorCount = n;
  }

  private readonly onDot = (id: StatusId, units: number, mult: number): void => {
    if (this.dotTarget !== null) this.combat.applyDot(this.dotTarget, id, units, mult);
  };

  fixedUpdate(dtSec: number): void {
    const dtMs = dtSec * 1000;
    // The stage clock waits for the opening fly-over.
    if (!this.stageIntroActive) this.director.update(dtMs);
    const boss = this.boss;

    this.player.think(dtSec);
    if (this.dummy.inWorld) this.dummy.think(dtSec);
    if (boss !== null && boss.inWorld) boss.think(dtSec);
    const duelist = this.duelist;
    if (duelist !== null && duelist.inWorld) {
      // The duelist waits for the countdown, then fights.
      if (this.director.phase === 'boss') this.duelBrain?.think(dtSec);
      duelist.think(dtSec);
    }
    for (const e of this.roster.active) e.think(dtSec);

    this.collectActors();
    for (let i = 0; i < this.actorCount; i++) {
      const a = this.actors[i];
      if (a === undefined || !a.alive) continue;
      this.dotTarget = a;
      a.status.tick(dtMs, this.onDot);
    }
    this.dotTarget = null;
    this.effects.update(dtSec);
    separateCrowd(this.actors, this.actorCount);
    for (let i = 0; i < this.actorCount; i++) this.actors[i]?.integrate(dtSec);
    this.d.physics.step(dtSec);
    this.roster.collectDead();
    if (boss !== null && boss.inWorld && boss.readyForRelease) boss.removeFromWorld();
    this.petThink(dtSec);

    // Ultimate shadow clones strike around targets during the active window.
    const p = this.player;
    if (
      p.state === 'ultimate' &&
      p.runner.phase === 'active' &&
      this.setup.hero.ultimate.clones > 0
    ) {
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

  private outcome(victory: boolean, abandoned: boolean): BattleOutcome {
    const p = this.player;
    const timeSec = this.stageTimeSec;
    const stars = victory
      ? rateRun(
          {
            cleared: true,
            timeSec,
            damageTakenFrac: p.damageTaken / p.stats.maxHp,
            revives: p.revivesUsed,
          },
          this.setup.stage.stars,
        )
      : 0;
    return {
      victory,
      abandoned,
      timeSec,
      stars,
      damageTaken: p.damageTaken,
      perfectDodges: p.perfectDodges,
      revives: p.revivesUsed,
      kills: this.enemiesKilled,
      bossKilled: this.bossDown,
      bossReached: this.bossActive,
      souls: this.soulsThisRun,
      hpFrac: p.alive ? p.health.frac : 0,
    };
  }

  private finish(victory: boolean, abandoned: boolean): void {
    if (this.finished) return;
    this.finished = true;
    this.d.setInputEnabled(false);
    this.hud.setVisible(false);
    this.results.hide();
    this.d.onFinish(this.outcome(victory, abandoned));
  }

  /** Leave the battle from the pause menu (counts as a defeat, no rewards). */
  abandon(): void {
    this.finish(false, true);
  }

  private showResult(): void {
    if (this.resultKind === 'victory') {
      this.sfx.play('victory');
      this.finish(true, false);
    } else if (this.resultKind === 'defeat') {
      const cost = ECONOMY.reviveCostGems;
      const revivesLeft = this.setup.allowRevive
        ? ECONOMY.maxRevivesPerRun - this.player.revivesUsed
        : 0;
      const canRevive = revivesLeft > 0 && this.d.wallet.canAfford('gems', cost);
      this.d.setInputEnabled(false);
      this.results.showDefeat(
        {
          canRevive,
          reviveCost: cost,
          gems: this.d.wallet.get('gems'),
          revivesLeft,
          allowRevive: this.setup.allowRevive,
          heroLine: HERO_LINES[this.setup.hero.id].defeat,
        },
        () => this.revive(),
        () => this.startRun(),
        () => this.finish(false, false),
      );
    }
  }

  private revive(): void {
    if (!this.d.wallet.spend('gems', ECONOMY.reviveCostGems)) return;
    this.d.commitWallet();
    this.results.hide();
    this.resultKind = null;
    this.director.resumeAfterRevive();
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

  render(alpha: number, realDtSec: number, timeScale: number): void {
    const animDt = realDtSec * timeScale;
    for (let i = 0; i < this.actorCount; i++) this.actors[i]?.render(alpha, animDt, realDtSec);
    const feet = this.player.renderFeet;
    const boss = this.boss;
    const duelist = this.duelist;
    if (duelist !== null && duelist.alive) this.d.camera.setFraming(duelist.renderFeet);
    if (boss !== null && this.bossActive && this.bossIntroFinished && boss.alive) {
      this.bossFrame.copy(boss.renderFeet);
      const size = Math.min(
        0.6,
        0.12 * Math.max(0, boss.rig.def.scale - 1.5) + boss.visualLift * 0.05,
      );
      this.d.camera.setFraming(this.bossFrame, size);
    }
    if (this.stageIntroActive) {
      // Moving the stick takes control straight away.
      const v = this.player.renderVelocity;
      if (v.x * v.x + v.z * v.z > 0.5) this.cam.skip();
      else if (
        !this.entranceDone &&
        (this.cam.sequenceIndex > 1 ||
          (this.cam.sequenceIndex === 1 &&
            this.cam.progress >= CINEMATIC_CONFIG.stageIntro.entranceAt))
      )
        this.heroEntrance();
    }
    this.updateDynamicFraming();
    const shot = this.cam.update(realDtSec, this.d.camera.camera);
    // Depth of field only while a shot plays (High / Ultra); gameplay stays sharp.
    this.d.ctx.setCinematicFocus(shot ? this.cam.focusDistance : null, realDtSec);
    if (!shot) {
      this.d.camera.update(
        feet,
        this.player.renderVelocity,
        realDtSec,
        this.player.stats.moveSpeed,
      );
    }
    const charge = this.player.chargeFrac;
    if (charge > 0) {
      this.chargeSparkSec -= realDtSec;
      if (this.chargeSparkSec <= 0) {
        this.chargeSparkSec = 0.12;
        this.sparks.burst(
          feet.x,
          1.4,
          feet.z,
          4 + Math.round(charge * 10),
          this.setup.hero.color,
          2 + charge * 3,
          0,
          0,
          0.35,
          1,
          -0.4,
        );
        if (charge >= 1) this.player.flashHit(0xffd080, 10);
      }
    }
    this.atmosphere.lightningOn = shot;
    if (this.pet !== null) {
      this.pet.update(animDt, feet, this.player.yaw);
      this.pet.setVisible(this.player.alive);
    }
    this.atmosphere.update(feet, realDtSec);
    this.builder.update(realDtSec);
    this.embers.update(realDtSec, feet);
    this.telegraphs.tick(realDtSec * 1000);
    this.effects.render();
    this.sparks.update(realDtSec);
    this.fx.update(realDtSec);
    this.fxd.update(realDtSec);
    this.trails.update(realDtSec);
    this.souls.update(realDtSec, feet.x, feet.y + 1.2, feet.z);
    this.clones.update(animDt);
    this.blobs.update(this.actors, this.actorCount);
    const size = this.d.ctx.renderer.domElement;
    this.numbers.update(realDtSec, this.d.camera.camera, size.clientWidth, size.clientHeight);
    this.updateHud(realDtSec);
    this.feel.update(realDtSec, this.player.health.frac, this.player.alive);
    const intro = this.setup.chapterIntro;
    if (this.introPending && intro !== undefined && realDtSec > 0) {
      this.introPending = false;
      this.feel.chapterIntro(intro);
    }
  }

  /** Lean toward the nearest enemy and ease back when the field is crowded (no allocation). */
  private updateDynamicFraming(): void {
    const feet = this.player.renderFeet;
    let best: Enemy | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const e of this.roster.active) {
      if (!e.alive) continue;
      const dx = e.renderFeet.x - feet.x;
      const dz = e.renderFeet.z - feet.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    this.d.camera.setThreat(best === null ? null : best.renderFeet);
    this.d.camera.setCrowd(this.roster.aliveCount());
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
      const secs = Math.ceil(dir.countdownRemainingMs / 1000);
      if (this.setup.duel !== undefined) {
        line = `Duel begins in ${secs}…`;
      } else if (this.setup.stage.trainingDummy) {
        line = `Practice on the dummy — enemies in ${secs}s`;
        showStart = true;
      } else {
        line = `Get ready… ${secs}`;
      }
    } else if (dir.phase === 'wave' || dir.phase === 'interwave') {
      line = `Wave ${dir.wave + 1} / ${dir.totalWaves} · ${this.roster.aliveCount() + dir.pendingSpawns} left`;
    }
    this.hud.setWaveLine(line, showStart);
    const duel = this.setup.duel;
    if (duel !== undefined && this.duelist !== null && this.duelist.alive && dir.phase === 'boss') {
      if (!this.duelHudShown) {
        this.duelHudShown = true;
        this.hud.showBoss({
          name: duel.name,
          title: duel.title,
          hpFrac: 1,
          breakFrac: -1,
          broken: false,
          phaseMarks: [],
          enrageInSec: -1,
          enraged: false,
        });
        this.hud.showBanner('FIGHT!', 'phase', 1000);
      }
      this.hud.updateBoss(
        {
          name: duel.name,
          title: duel.title,
          hpFrac: this.duelist.health.frac,
          breakFrac: -1,
          broken: false,
          phaseMarks: [],
          enrageInSec: -1,
          enraged: false,
        },
        dtSec,
      );
    }
    const boss = this.boss;
    if (boss !== null && this.bossActive && this.bossIntroFinished && boss.inWorld) {
      const def = boss.bossDef;
      this.hud.updateBoss(
        {
          name: def.name,
          title: this.bossTitle,
          hpFrac: boss.health.frac,
          breakFrac: boss.poise.frac,
          broken: boss.isBroken,
          phaseMarks: [],
          enrageInSec: Math.max(0, (def.enrageAfterMs - boss.bossBrain.fightMs) / 1000),
          enraged: boss.bossBrain.enraged,
        },
        dtSec,
      );
    }
    this.hud.tick(dtSec);
  }

  applyQuality(preset: QualityPreset, level: QualityLevel): void {
    this.atmosphere.applyQuality(preset);
    this.embers.setCount(emberCountFor(preset, level));
    const pr = this.d.ctx.currentPixelRatio;
    this.embers.setPixelRatio(pr);
    this.sparks.setPixelRatio(pr);
    this.sparks.density = preset.particleCount / PARTICLE_REFERENCE + 0.25;
    this.blobs.setStrength(preset.shadows ? 0.4 : 0.6);
    this.fxLights.setEnabled(preset.pointLights);
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
    this.skipCountdown();
    this.killAllEnemies();
    this.director.skipToBoss();
  }

  damageBoss(frac: number): void {
    const boss = this.boss;
    if (boss === null || !boss.alive) return;
    const amount = Math.ceil(boss.health.max * frac);
    boss.health.damage(Math.min(amount, boss.health.current - 1));
    boss.bossBrain.checkPhase();
  }

  killBoss(): void {
    const boss = this.boss;
    if (boss !== null && boss.alive)
      this.combat.applyHit(this.player, boss, KILL_SPEC, 0, 1, { difficultyMod: 1e6 });
  }

  killDuelist(): void {
    const d = this.duelist;
    if (d !== null && d.alive)
      this.combat.applyHit(this.player, d, KILL_SPEC, 0, 1, { difficultyMod: 1e6 });
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
    if (this.finished) return this.resultKind;
    return this.results.visible ? (this.resultKind ?? null) : null;
  }

  get cinematicActive(): boolean {
    return this.cam.active;
  }

  /** Debug: camera shot playback speed (0.05..1). */
  get cinematicSpeed(): number {
    return this.cam.timeScale;
  }

  set cinematicSpeed(k: number) {
    this.cam.timeScale = Math.min(1, Math.max(0.05, Number.isFinite(k) ? k : 1));
  }

  /** Playing shot: 'stageIntro', 'bossIntro', 'killCam', 'ultimate', 'bossDeath', 'victory'. */
  get cinematicKind(): string {
    return this.cam.kind;
  }

  get telegraphCount(): number {
    return this.telegraphs.activeCount;
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.d.ctx.setCinematicFocus(null, 10);
    this.d.camera.setThreat(null);
    this.d.camera.setCrowd(0);
    this.effects.dispose();
    this.duelist?.dispose();
    this.player.dispose();
    this.boss?.dispose();
    this.dummy.dispose();
    this.roster.dispose();
    this.clones.dispose();
    this.trails.dispose();
    this.sparks.dispose();
    this.fxd.clear();
    this.fx.dispose();
    this.fxLights.dispose();
    this.souls.dispose();
    this.blobs.dispose();
    this.telegraphs.dispose();
    this.embers.dispose();
    this.atmosphere.dispose();
    this.builder.dispose();
    this.hud.dispose();
    this.callouts.dispose();
    this.numbers.dispose();
    this.results.dispose();
    this.pet?.dispose();
  }

  /**
   * The pet strikes the nearest living foe in range (not the training dummy) every few seconds
   * while the fight is on; damage scales with the hero's ATK through the normal damage formula.
   */
  private petThink(dtSec: number): void {
    const pet = this.setup.pet;
    if (
      pet === undefined ||
      pet === null ||
      this.pet === null ||
      this.stageIntroActive ||
      !this.player.alive
    )
      return;
    const phase = this.director.phase;
    if (phase === 'countdown' || phase === 'victory' || phase === 'defeat') return;
    this.petTimer -= dtSec;
    if (this.petTimer > 0) return;
    const from = this.player.currFeet;
    let best: Actor | null = null;
    let bestD = pet.rangeM * pet.rangeM;
    for (const t of this.targetList()) {
      if (t === this.dummy) continue;
      const dx = t.currFeet.x - from.x;
      const dz = t.currFeet.z - from.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD) {
        bestD = d2;
        best = t;
      }
    }
    if (best === null) {
      this.petTimer = 0.4;
      return;
    }
    this.petTimer = pet.everySec;
    const at = best.currFeet;
    const src = this.pet.position;
    const dx = at.x - src.x;
    const dz = at.z - src.z;
    const len = Math.hypot(dx, dz) || 1;
    this.pet.strike(at);
    // A streak of sparks from the pet to the target, a flash where it lands.
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      this.sparks.burst(
        src.x + dx * t,
        src.y + (at.y + 1 - src.y) * t,
        src.z + dz * t,
        3,
        pet.look.accent,
        1.2,
        0,
        0,
        0.25,
        0.7,
        0,
      );
    }
    this.sparks.burst(at.x, at.y + 1, at.z, 14, pet.look.color, 4, 0, 0, 0.4, 1.1, 0.3);
    this.fxLights.flash(at.x, at.y + 1.2, at.z, pet.look.color, 1.6, 0.35);
    this.combat.applyHit(this.player, best, PET_SPEC, dx / len, dz / len, {
      damageMult: pet.mult,
      difficultyMod: 1,
    });
    this.petStrikes++;
  }
}

const PET_SPEC = {
  damage: 1,
  poise: 4,
  reaction: 'flinch' as const,
  knockback: 0.15,
  hitStopMs: 0,
  shake: 0,
  shape: { kind: 'circle' as const, radius: 0, forward: 0 },
};

const KILL_SPEC = {
  damage: 1,
  poise: 0,
  reaction: 'flinch' as const,
  knockback: 0,
  hitStopMs: 0,
  shake: 0,
  shape: { kind: 'circle' as const, radius: 0, forward: 0 },
};
