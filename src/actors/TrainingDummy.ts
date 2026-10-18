import type { Scene } from 'three';
import { buildHumanoidClips } from '../anim/clipSets';
import { NEUTRAL } from '../anim/poses';
import { RIGS } from '../data/rigs';
import { GROUP } from '../physics/groups';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { Actor, type HitReceived } from './Actor';

export const DUMMY_TUNING = {
  maxHp: 99999,
  def: 30,
  /** HP refills this long after the last hit. */
  refillAfterMs: 2500,
} as const;

/** Practice target: takes every hit (numbers, flinches, statuses) and never dies. */
export class TrainingDummy extends Actor {
  readonly team = 'neutral' as const;
  private sinceHitMs = 0;

  constructor(physics: PhysicsWorld, scene: Scene) {
    const base = buildHumanoidClips(NEUTRAL);
    super({
      rig: RIGS.dummy,
      stats: {
        maxHp: DUMMY_TUNING.maxHp,
        atk: 0,
        def: DUMMY_TUNING.def,
        critChance: 0,
        critDamage: 1,
        attackSpeed: 1,
        moveSpeed: 0,
      },
      poise: 1e9,
      radius: 0.42,
      halfHeight: 0.55,
      physics,
      membership: GROUP.neutral,
      clips: base.clips,
      additiveClips: base.additive,
      scene,
      knockbackResist: 1,
    });
    this.anim.play('idle', { loop: true, fade: 0 });
  }

  isInvulnerable(): boolean {
    return false;
  }

  hasSuperArmor(): boolean {
    return true;
  }

  onHit(h: HitReceived): void {
    this.sinceHitMs = 0;
    this.flashHit(0xffffff, 7);
    this.anim.react('hurt', h.spec.reaction === 'flinch' ? 1 : 1.5);
  }

  think(dtSec: number): void {
    this.sinceHitMs += dtSec * 1000;
    if (this.sinceHitMs > DUMMY_TUNING.refillAfterMs && this.health.current < this.health.max) {
      this.health.reset(1);
    }
    this.vel.x = this.vel.z = 0;
  }
}
