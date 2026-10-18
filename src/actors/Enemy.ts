import type { Scene } from 'three';
import { buildEnemyAttackClips, buildHumanoidClips } from '../anim/clipSets';
import { POSE_LIBRARY } from '../anim/poses';
import { EnemyBrain, type BrainContext } from '../ai/EnemyBrain';
import type { EnemyAttackDef, EnemyDef } from '../data/enemies';
import { RIGS } from '../data/rigs';
import { GROUP } from '../physics/groups';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { Actor, type HitReceived } from './Actor';

export interface EnemyDeps {
  readonly physics: PhysicsWorld;
  readonly scene: Scene;
  readonly ctx: BrainContext;
}

/** Visual sink into the ground at the end of the death animation (metres). */
const DEATH_SINK = 1.4;
const SINK_MS = 700;

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
  private deadMs = 0;
  private wasMoving = false;

  constructor(
    readonly def: EnemyDef,
    deps: EnemyDeps,
    brain?: EnemyBrain,
  ) {
    const idle = POSE_LIBRARY[def.idlePose];
    const base = buildHumanoidClips(idle);
    const clips = [...base.clips];
    for (const a of def.attacks) clips.push(...buildEnemyAttackClips(a, idle));
    super({
      rig: RIGS[def.rig],
      stats: def.stats,
      poise: def.poise,
      radius: def.radius,
      halfHeight: def.halfHeight,
      physics: deps.physics,
      membership: GROUP.enemy,
      clips,
      additiveClips: base.additive,
      scene: deps.scene,
      knockbackResist: def.knockbackResist,
    });
    this.brain = brain ?? new EnemyBrain(deps.ctx);
    this.brain.bind(this);
  }

  get actionSpeed(): number {
    return this.speedMult;
  }

  attackById(id: string): EnemyAttackDef | undefined {
    return this.def.attacks.find((a) => a.id === id);
  }

  activate(x: number, z: number, yaw: number, hpMult: number, poiseMult: number): void {
    this.stats = { ...this.def.stats, maxHp: Math.round(this.def.stats.maxHp * hpMult) };
    this.health.reset(1, this.stats.maxHp);
    this.poise.refill(this.def.poise * poiseMult);
    this.damageMult = 1;
    this.speedMult = 1;
    this.deadMs = 0;
    this.wasMoving = false;
    this.spawnAt(x, z, yaw);
    this.brain.reset();
    this.brain.goSpawning();
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
      const sinkStart = this.def.deathMs - SINK_MS;
      if (this.deadMs > sinkStart)
        this.visualLift = -DEATH_SINK * Math.min(1, (this.deadMs - sinkStart) / SINK_MS);
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

  /** Locomotion animation from the current planar speed (called by the brain). */
  playLocomotion(speed: number): void {
    const moving = speed > (this.wasMoving ? 0.3 : 0.5);
    if (moving) {
      const cadence = Math.min(
        1.6,
        Math.max(
          0.42,
          (0.72 * this.def.stats.moveSpeed * 0.55 * this.rig.def.scale) / Math.max(speed, 0.3),
        ),
      );
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
