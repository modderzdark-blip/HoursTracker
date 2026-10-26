import type { AnimationClip, Scene } from 'three';
import { enemyAnimSet } from '../anim/animSets';
import { rigStyle, type DeathKind, type MotionStyle } from '../anim/motionStyles';
import { FLINCH_CLIPS, HEAVY_CLIPS, HURT_CLIPS, hitSide } from '../anim/reactions';
import type { AiState } from '../ai/EnemyBrain';
import { CreatureAnimator } from '../anim/creatures/CreatureAnimator';
import { CreatureRig } from '../anim/creatures/CreatureRig';
import { runCycleSec } from '../anim/locomotion';
import { EnemyBrain, type BrainContext } from '../ai/EnemyBrain';
import { NO_AFFIX_EFFECTS, type AffixEffects } from '../data/affixes';
import type { HitSpec } from '../data/combatTypes';
import { CREATURES, type CreatureMotion } from '../data/creatures';
import type { EnemyAttackDef, EnemyDef } from '../data/enemies';
import { RIGS } from '../data/rigs';
import { GROUP } from '../physics/groups';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { wrapAngle } from './components/movementMath';
import { Actor, type HitReceived } from './Actor';

/** Multipliers applied to an enemy's base stats when it spawns (level, difficulty, mode). */
export interface EnemyScale {
  readonly hp: number;
  readonly atk: number;
  readonly def: number;
  readonly poise: number;
  /** Movement / attack speed (hunt omens). */
  readonly speed?: number;
  /** Elite affix behaviours (stats are already folded into the multipliers above). */
  readonly affix?: AffixEffects;
}

export const UNIT_SCALE: EnemyScale = { hp: 1, atk: 1, def: 1, poise: 1 };

export interface EnemyDeps {
  readonly physics: PhysicsWorld;
  readonly scene: Scene;
  readonly ctx: BrainContext;
}

/** The corpse burns away into embers over the end of the death time (ms). */
const DISSOLVE_MS = 1100;
const BIG_DISSOLVE_MS = 1900;
/** Slight settle into the ash while it burns (metres). */
const DEATH_SINK = 0.18;
/** Embers are released this often while a body burns (ms). */
const EMBER_EVERY_MS = 130;
/** States in which the enemy's feet drive its animation (idle / run). */
const LOCOMOTION_STATES: ReadonlySet<AiState> = new Set<AiState>([
  'inactive',
  'idle',
  'patrol',
  'alert',
  'chase',
  'position',
]);

const DEATH_CLIPS: Readonly<Record<DeathKind, string>> = {
  back: 'death_back',
  crumple: 'death_crumple',
  spin: 'death_spin',
  forward: 'death_forward',
  kneel: 'death_kneel',
};

/** Spawning enemies form out of ash over this long (s). */
const MATERIALIZE_SEC = 0.75;
/** Hit flash while a ward soaks the blow (pale blue) instead of the plain white flash. */
export const WARD_FLASH = 0x8ad8ff;

/** Cinderburst blast (damage / radius come from the affix; bosses blow twice as wide). */
function burstSpec(damage: number, radius: number): HitSpec {
  return {
    damage,
    poise: 30,
    reaction: 'knockback',
    knockback: 2.2,
    hitStopMs: 60,
    shake: 0.4,
    shape: { kind: 'circle', radius, forward: 0 },
    status: { id: 'burn', chance: 0.6 },
  };
}

/**
 * Pooled enemy: rig + kinematic body + AI brain. `activate()` takes it from the pool into the
 * world; once the death animation and sink finish, the manager returns it to the pool.
 */
export class Enemy extends Actor {
  readonly team = 'enemy' as const;
  readonly brain: EnemyBrain;
  /** Multipliers from boss phases / enrage. */
  damageMult = 1;
  speedMult = 1;
  /** Speed from the spawn scale; boss phases multiply on top of it. */
  baseSpeed = 1;
  private deadMs = 0;
  private wasMoving = false;
  private dissolving = false;
  private emberMs = 0;
  /** Colour of the burning edge and embers (the body's glow colour). */
  readonly burnColor: number;
  private readonly bus: EnemyDeps['ctx']['bus'];
  /** Movement personality (humanoids); picks deaths. */
  protected readonly style: MotionStyle;
  /** A one-shot flourish (taunt / roar) playing while standing still. */
  private flourish = false;
  private celebrated = false;
  /** Elite affixes of the current spawn. */
  affix: AffixEffects = NO_AFFIX_EFFECTS;
  /** Ward: HP it can still soak, its full size, and time since the last hit (ms). */
  wardHp = 0;
  private wardMax = 0;
  private wardIdleMs = 0;
  /** Frenzy multipliers (1 until the frenzy affix triggers); boss phases keep them. */
  frenzyDamage = 1;
  frenzySpeed = 1;
  private readonly brainCtx: EnemyDeps['ctx'];

  constructor(
    readonly def: EnemyDef,
    deps: EnemyDeps,
    brain?: EnemyBrain,
  ) {
    let body: { rig: CreatureRig; anim: CreatureAnimator } | undefined;
    let clips: readonly AnimationClip[] = [];
    let additive: readonly AnimationClip[] = [];
    if (def.creature !== undefined) {
      const rig = new CreatureRig(CREATURES[def.creature]);
      const motions = new Map<string, CreatureMotion>(
        def.attacks.map((a) => [a.id, a.motion ?? 'bite']),
      );
      body = { rig, anim: new CreatureAnimator(rig.plan, rig.bones, motions) };
    } else {
      const set = enemyAnimSet(def);
      clips = set.clips;
      additive = set.additive;
    }
    super({
      rig: RIGS[def.rig],
      body,
      stats: def.stats,
      poise: def.poise,
      radius: def.radius,
      halfHeight: def.halfHeight,
      physics: deps.physics,
      membership: GROUP.enemy,
      clips,
      additiveClips: additive,
      scene: deps.scene,
      knockbackResist: def.knockbackResist,
    });
    this.brain = brain ?? new EnemyBrain(deps.ctx);
    this.brain.bind(this);
    this.bus = deps.ctx.bus;
    this.brainCtx = deps.ctx;
    this.style = rigStyle(def.rig);
    this.burnColor =
      def.creature !== undefined ? CREATURES[def.creature].colors.glow : RIGS[def.rig].look.eyes;
    this.rig.setDissolve(0, this.burnColor);
  }

  /** Bosses and other large bodies burn longer and throw more embers. */
  protected get bigDeath(): boolean {
    return false;
  }

  get actionSpeed(): number {
    return this.speedMult;
  }

  attackById(id: string): EnemyAttackDef | undefined {
    return this.def.attacks.find((a) => a.id === id);
  }

  activate(x: number, z: number, yaw: number, scale: EnemyScale): void {
    const b = this.def.stats;
    this.stats = {
      ...b,
      maxHp: Math.round(b.maxHp * scale.hp),
      atk: Math.round(b.atk * scale.atk),
      def: Math.round(b.def * scale.def),
    };
    this.health.reset(1, this.stats.maxHp);
    this.poise.refill(this.def.poise * scale.poise);
    this.damageMult = 1;
    this.baseSpeed = scale.speed ?? 1;
    this.speedMult = this.baseSpeed;
    this.affix = scale.affix ?? NO_AFFIX_EFFECTS;
    this.wardMax = this.affix.ward !== null ? this.stats.maxHp * this.affix.ward.frac : 0;
    this.wardHp = this.wardMax;
    this.wardIdleMs = 0;
    this.frenzyDamage = 1;
    this.frenzySpeed = 1;
    this.deadMs = 0;
    this.wasMoving = false;
    this.dissolving = false;
    this.flourish = false;
    this.celebrated = false;
    this.spawnAt(x, z, yaw);
    this.dissolve.materialize(MATERIALIZE_SEC);
    this.brain.reset();
    this.brain.goSpawning();
  }

  override blockFactor(attacker: Actor): number {
    const sh = this.def.shield;
    if (sh === undefined || attacker === this) return 1;
    const st = this.brain.state;
    // The guard drops while staggered, knocked down or mid-air.
    if (
      st === 'stagger' ||
      st === 'knockdown' ||
      st === 'airborne' ||
      st === 'getup' ||
      st === 'broken'
    )
      return 1;
    const toAttacker = Math.atan2(
      attacker.currFeet.x - this.currFeet.x,
      attacker.currFeet.z - this.currFeet.z,
    );
    return Math.abs(wrapAngle(toAttacker - this.yaw)) <= (sh.arcDeg * Math.PI) / 360
      ? sh.blockMult
      : 1;
  }

  override blockedPoiseMult(): number {
    return this.def.shield?.poiseMult ?? 1;
  }

  isInvulnerable(): boolean {
    const s = this.brain.state;
    return s === 'spawning' || s === 'dead' || s === 'inactive';
  }

  /** A standing ward soaks part of every blow. */
  override damageTakenMult(): number {
    const w = this.affix.ward;
    return w !== null && this.wardHp > 0 ? 1 - w.absorb : 1;
  }

  override lifeSteal(): number {
    return this.affix.drain;
  }

  /** Ward bookkeeping and the frenzy trigger after a hit (called before the reaction). */
  protected afterAffixHit(h: HitReceived): void {
    this.wardIdleMs = 0;
    const w = this.affix.ward;
    if (w !== null && this.wardHp > 0) {
      // The ward took what the hero's blow lost to it.
      this.wardHp -= (h.amount * w.absorb) / (1 - w.absorb);
      if (this.wardHp <= 0) {
        this.wardHp = 0;
        this.emitAffix('wardBroken');
      }
    }
    const f = this.affix.frenzy;
    if (f !== null && this.frenzyDamage === 1 && !h.killed && this.health.frac <= f.belowHpFrac) {
      this.frenzyDamage = f.damage;
      this.frenzySpeed = f.speed;
      this.damageMult *= f.damage;
      this.speedMult *= f.speed;
      this.emitAffix('frenzy');
    }
  }

  private emitAffix(kind: 'wardBroken' | 'wardUp' | 'frenzy'): void {
    this.bus.emit('enemy:affix', {
      kind,
      actorId: this.id,
      x: this.currFeet.x,
      y: this.currFeet.y + this.halfHeight * 2 + this.radius,
      z: this.currFeet.z,
    });
  }

  /** Cinderburst: a telegraphed blast where the body fell. */
  private releaseBurst(): void {
    const b = this.affix.burst;
    const fx = this.brainCtx.effects;
    if (b === null || fx === undefined) return;
    const radius = b.radius * (this.bigDeath ? 2 : 1);
    fx.emit(
      this,
      burstSpec(b.damage, radius),
      {
        kind: 'zone',
        zone: { visual: 'eruption', radius, delayMs: b.delayMs, ticks: 1, intervalMs: 0 },
        place: 'self',
        forward: 0,
        count: 1,
        scatter: 0,
      },
      { difficultyMod: this.brainCtx.difficultyMod },
    );
  }

  hasSuperArmor(): boolean {
    return this.brain.hasSuperArmor();
  }

  get readyForRelease(): boolean {
    return this.brain.state === 'dead' && this.deadMs >= this.def.deathMs;
  }

  onHit(h: HitReceived): void {
    this.flashHit(this.wardHp > 0 ? WARD_FLASH : 0xffffff, 7);
    this.afterAffixHit(h);
    if (h.killed) {
      this.die(h);
      return;
    }
    const side = hitSide(h.dirX, h.dirZ, this.yaw);
    if (h.poiseBroken) {
      this.brain.goStagger(this.def.staggerMs);
      this.poise.refill();
      this.knockback(h.dirX, h.dirZ, h.spec.knockback * 0.5);
      return;
    }
    if (h.blocked === true) {
      // The shield takes it: a small shove, a jolt behind the guard, no flinch.
      this.knockback(h.dirX, h.dirZ, h.spec.knockback * 0.25);
      this.anim.react(HURT_CLIPS[side], 0.45);
      return;
    }
    if (this.hasSuperArmor()) {
      this.anim.react(HURT_CLIPS[side], 0.6);
      return;
    }
    this.flourish = false;
    switch (h.spec.reaction) {
      case 'flinch':
        this.brain.goHurt(this.def.hurtMs);
        this.playReaction(FLINCH_CLIPS[side], this.def.hurtMs, HURT_CLIPS[side]);
        this.knockback(h.dirX, h.dirZ, h.spec.knockback);
        break;
      case 'knockback':
        this.brain.goHurt(this.def.hurtMs + 180);
        // Heavy stumble while the knockback slides the body.
        this.playReaction(HEAVY_CLIPS[side], this.def.hurtMs + 180, HURT_CLIPS[side]);
        this.knockback(h.dirX, h.dirZ, h.spec.knockback);
        break;
      case 'launch':
        this.knockback(h.dirX, h.dirZ, h.spec.knockback);
        this.brain.goAirborne();
        break;
      case 'knockdown':
        this.knockback(h.dirX, h.dirZ, h.spec.knockback);
        this.brain.goKnockdown();
        break;
    }
  }

  /** Hit reaction clip (creatures recoil procedurally instead). */
  private playReaction(clip: string, ms: number, jolt: string): void {
    if (this.anim.has(clip)) {
      this.anim.play(clip, { durationSec: Math.max(0.2, ms / 1000), fade: 0.04, restart: true });
    } else {
      this.anim.react(jolt, 1.2);
    }
  }

  /** Suicide attackers: dies on the spot (no killer). */
  selfDestruct(): void {
    if (this.health.dead) return;
    this.health.damage(this.health.current);
    this.die();
    this.rig.setVisible(false);
  }

  protected die(h?: HitReceived): void {
    this.brain.goDead();
    this.releaseBurst();
    this.deadMs = 0;
    this.vel.x = this.vel.z = 0;
    this.flourish = false;
    this.anim.play(this.deathClip(h), {
      durationSec: Math.min(1.1, this.def.deathMs / 1000),
      fade: 0.06,
      restart: true,
    });
  }

  /**
   * Death that fits the killing blow: thrown back by heavy hits from the front, pitched forward
   * from behind, spun round by sideways blows, otherwise one of the body's own deaths.
   */
  private deathClip(h?: HitReceived): string {
    const kinds = this.style.deaths;
    if (this.def.creature !== undefined || kinds.length === 0) return 'death';
    const has = (k: DeathKind): boolean => kinds.includes(k) && this.anim.has(DEATH_CLIPS[k]);
    if (h !== undefined) {
      const side = hitSide(h.dirX, h.dirZ, this.yaw);
      const heavy = h.spec.reaction !== 'flinch' || h.crit;
      if (side === 'back' && has('forward')) return DEATH_CLIPS.forward;
      if ((side === 'left' || side === 'right') && heavy && has('spin')) return DEATH_CLIPS.spin;
      if (heavy && side === 'front' && has('back')) return DEATH_CLIPS.back;
    }
    const pick =
      kinds[(this.id * 7 + Math.floor(this.deadMs + this.currFeet.x * 13)) % kinds.length];
    return pick !== undefined && this.anim.has(DEATH_CLIPS[pick]) ? DEATH_CLIPS[pick] : 'death';
  }

  /**
   * The player is down: plays a taunt (or a roar on creatures) once, while standing still.
   * Called by the brain; visual only.
   */
  celebrate(): void {
    if (this.celebrated || this.brain.state === 'dead') return;
    this.celebrated = true;
    const name = this.anim.has('taunt') && this.def.creature === undefined ? 'taunt' : 'roar';
    this.anim.play(name, { durationSec: 1.8, fade: 0.2, restart: true });
    this.flourish = true;
  }

  think(dtSec: number): void {
    if (!this.inWorld) return;
    const dtMs = dtSec * 1000;
    if (this.brain.state === 'dead') {
      this.deadMs += dtMs;
      this.tickDissolve(dtMs);
      this.vel.x = this.vel.z = 0;
      return;
    }
    this.poise.tick(dtMs);
    this.tickWard(dtMs);
    this.brain.think(dtSec);
    const s = this.brain.state;
    const look =
      s === 'chase' || s === 'position' || s === 'alert' ? this.brain.angleToPlayer() : 0;
    this.anim.setLookYaw(look);
  }

  /** A shattered ward reforms after a while without being hit. */
  private tickWard(dtMs: number): void {
    const w = this.affix.ward;
    if (w === null || this.wardHp > 0) return;
    this.wardIdleMs += dtMs;
    if (this.wardIdleMs < w.reformMs) return;
    this.wardHp = this.wardMax;
    this.emitAffix('wardUp');
  }

  /** Burns the corpse away over the end of its death time, releasing embers. */
  private tickDissolve(dtMs: number): void {
    const span = Math.min(this.bigDeath ? BIG_DISSOLVE_MS : DISSOLVE_MS, this.def.deathMs * 0.7);
    const start = this.def.deathMs - span;
    if (!this.dissolving) {
      if (this.deadMs < start) return;
      this.dissolving = true;
      this.emberMs = 0;
      this.dissolve.start(span / 1000);
    }
    const progress = Math.min(1, (this.deadMs - start) / span);
    this.visualLift = -DEATH_SINK * progress * this.rig.def.scale;
    this.emberMs -= dtMs;
    if (this.emberMs <= 0 && progress < 0.92 && this.rig.root.visible) {
      this.emberMs = EMBER_EVERY_MS;
      this.bus.emit('enemy:dissolve', {
        x: this.currFeet.x,
        y: this.currFeet.y,
        z: this.currFeet.z,
        height: this.rig.height,
        progress,
        color: this.burnColor,
        big: this.bigDeath,
      });
    }
  }

  /** Locomotion animation from the current planar speed (called by the brain). */
  playLocomotion(speed: number): void {
    // Reactions, attacks and other states own the animation; only feet-driven states loop here.
    if (!LOCOMOTION_STATES.has(this.brain.state)) return;
    const moving = speed > (this.wasMoving ? 0.3 : 0.5);
    if (moving) {
      this.flourish = false;
      const cadence = runCycleSec(speed, this.rig.def.scale);
      this.anim.play('run', { loop: true, durationSec: cadence, fade: 0.15 });
    } else if (this.flourish && !this.anim.finished) {
      // Let the taunt finish.
    } else if (this.wasMoving || this.anim.playing !== 'idle') {
      this.flourish = false;
      this.anim.play('idle', { loop: true, fade: 0.2 });
    }
    this.wasMoving = moving;
  }
}
