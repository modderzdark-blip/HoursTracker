import type { AnimationClip, Scene } from 'three';
import { buildEnemyAttackClips, buildHumanoidClips } from '../anim/clipSets';
import { CreatureAnimator } from '../anim/creatures/CreatureAnimator';
import { CreatureRig } from '../anim/creatures/CreatureRig';
import { runCycleSec } from '../anim/locomotion';
import { POSE_LIBRARY } from '../anim/poses';
import { EnemyBrain, type BrainContext } from '../ai/EnemyBrain';
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
/** Spawning enemies form out of ash over this long (s). */
const MATERIALIZE_SEC = 0.75;

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

  constructor(
    readonly def: EnemyDef,
    deps: EnemyDeps,
    brain?: EnemyBrain,
  ) {
    let body: { rig: CreatureRig; anim: CreatureAnimator } | undefined;
    const clips: AnimationClip[] = [];
    let additive: ReturnType<typeof buildHumanoidClips>['additive'] = [];
    if (def.creature !== undefined) {
      const rig = new CreatureRig(CREATURES[def.creature]);
      const motions = new Map<string, CreatureMotion>(
        def.attacks.map((a) => [a.id, a.motion ?? 'bite']),
      );
      body = { rig, anim: new CreatureAnimator(rig.plan, rig.bones, motions) };
    } else {
      const idle = POSE_LIBRARY[def.idlePose];
      const base = buildHumanoidClips(idle);
      clips.push(...base.clips);
      additive = base.additive;
      for (const a of def.attacks) clips.push(...buildEnemyAttackClips(a, idle));
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
    this.deadMs = 0;
    this.wasMoving = false;
    this.dissolving = false;
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

  hasSuperArmor(): boolean {
    return this.brain.hasSuperArmor();
  }

  get readyForRelease(): boolean {
    return this.brain.state === 'dead' && this.deadMs >= this.def.deathMs;
  }

  onHit(h: HitReceived): void {
    this.flashHit(0xffffff, 7);
    if (h.killed) {
      this.die();
      return;
    }
    if (h.poiseBroken) {
      this.brain.goStagger(this.def.staggerMs);
      this.poise.refill();
      this.knockback(h.dirX, h.dirZ, h.spec.knockback * 0.5);
      return;
    }
    if (h.blocked === true) {
      // The shield takes it: a small shove, no flinch.
      this.knockback(h.dirX, h.dirZ, h.spec.knockback * 0.25);
      return;
    }
    if (this.hasSuperArmor()) return;
    switch (h.spec.reaction) {
      case 'flinch':
        this.brain.goHurt(this.def.hurtMs);
        this.anim.react('hurt', 1);
        this.knockback(h.dirX, h.dirZ, h.spec.knockback);
        break;
      case 'knockback':
        this.brain.goHurt(this.def.hurtMs + 180);
        this.anim.react('hurt', 1.3);
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

  /** Suicide attackers: dies on the spot (no killer). */
  selfDestruct(): void {
    if (this.health.dead) return;
    this.health.damage(this.health.current);
    this.die();
    this.rig.setVisible(false);
  }

  protected die(): void {
    this.brain.goDead();
    this.deadMs = 0;
    this.vel.x = this.vel.z = 0;
    this.anim.play('death', {
      durationSec: Math.min(1.1, this.def.deathMs / 1000),
      fade: 0.06,
      restart: true,
    });
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
    this.brain.think(dtSec);
    const s = this.brain.state;
    const look =
      s === 'chase' || s === 'position' || s === 'alert' ? this.brain.angleToPlayer() : 0;
    this.anim.setLookYaw(look);
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
    const moving = speed > (this.wasMoving ? 0.3 : 0.5);
    if (moving) {
      const cadence = runCycleSec(speed, this.rig.def.scale);
      this.anim.play('run', { loop: true, durationSec: cadence, fade: 0.15 });
    } else if (
      this.wasMoving ||
      (this.anim.playing !== 'idle' && this.brain.state !== 'spawning')
    ) {
      this.anim.play('idle', { loop: true, fade: 0.2 });
    }
    this.wasMoving = moving;
  }
}
