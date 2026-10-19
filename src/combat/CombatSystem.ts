import type RAPIER from '@dimforge/rapier3d-compat';
import type { Actor } from '../actors/Actor';
import type { EventBus } from '../core/EventBus';
import type { GameEvents, HitEvent } from '../core/events';
import type { HitSpec } from '../data/combatTypes';
import type { StatusId } from '../data/statusEffects';
import { GROUP, hitQueryGroups } from '../physics/groups';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { computeDamage, computeDotDamage, type DamageResult } from './damage';
import { shapeBoundingRadius, shapeCenterForward, targetInShape } from './hitShapes';

export interface StrikeOptions {
  /** Extra multiplier on the hit's skill multiplier (perfect-dodge counter, etc.). */
  readonly damageMult?: number;
  readonly forceCrit?: boolean;
  readonly counter?: boolean;
  /** Difficulty modifier of the damage formula (enemy damage scaling; 1 for the player). */
  readonly difficultyMod: number;
  /** Targets already hit by this action (each target is hit once per hit window). */
  readonly hitSet: Set<number>;
  /** Extra status applied on hit (skill-tree modifiers), on top of the hit's own status. */
  readonly extraStatus?: { readonly status: StatusId; readonly chance: number } | null;
}

export interface StrikeResult {
  hits: number;
  maxHitStopMs: number;
  maxShake: number;
  killed: number;
}

const IDENTITY_ROT = { x: 0, y: 0, z: 0, w: 1 };

/**
 * Hit detection + damage pipeline. Detection uses a Rapier shape-intersection query (ball around
 * the hit area, filtered to the opposing team's colliders) followed by a precise 2D shape test;
 * no physics bodies push each other. Every hit goes through one pipeline:
 * i-frames → damage formula → HP → poise → status → reaction → events.
 */
export class CombatSystem {
  private readonly actors = new Map<number, Actor>();
  private readonly ball: RAPIER.Ball;
  private readonly candidates: Actor[] = [];
  private candidateCount = 0;
  private readonly queryPos = { x: 0, y: 0, z: 0 };
  private readonly dmg: DamageResult = { amount: 0, crit: false };
  private readonly result: StrikeResult = { hits: 0, maxHitStopMs: 0, maxShake: 0, killed: 0 };
  private readonly hitEvent: HitEvent = {
    attackerId: 0,
    targetId: 0,
    targetTeam: 'enemy',
    amount: 0,
    crit: false,
    killed: false,
    poiseBroken: false,
    counter: false,
    blocked: false,
    dot: false,
    status: null,
    x: 0,
    y: 0,
    z: 0,
    dirX: 0,
    dirZ: 1,
    hitStopMs: 0,
    shake: 0,
  };
  /** Invoked after damage lands (ultimate charge, run stats). */
  onDamage: ((attacker: Actor | null, target: Actor, amount: number) => void) | null = null;
  private querySelf: Actor | null = null;

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly bus: EventBus<GameEvents>,
    private readonly rng: () => number,
  ) {
    this.ball = new physics.rapier.Ball(1);
  }

  register(actor: Actor): void {
    this.actors.set(actor.colliderHandle, actor);
  }

  unregister(actor: Actor): void {
    this.actors.delete(actor.colliderHandle);
  }

  private readonly collect = (collider: RAPIER.Collider): boolean => {
    const a = this.actors.get(collider.handle);
    if (a !== undefined && a !== this.querySelf && a.alive) {
      if (this.candidateCount < this.candidates.length) this.candidates[this.candidateCount] = a;
      else this.candidates.push(a);
      this.candidateCount++;
    }
    return true;
  };

  private targetGroups(attacker: Actor): number {
    return attacker.team === 'enemy' ? GROUP.player : GROUP.enemy | GROUP.neutral;
  }

  /**
   * Tests `spec.shape` from the attacker's current position/facing and applies the hit to every
   * new target inside it.
   */
  strike(attacker: Actor, spec: HitSpec, opts: StrikeOptions): StrikeResult {
    const r = this.result;
    r.hits = 0;
    r.maxHitStopMs = 0;
    r.maxShake = 0;
    r.killed = 0;
    const ox = attacker.currFeet.x;
    const oz = attacker.currFeet.z;
    const yaw = attacker.yaw;
    const fwd = shapeCenterForward(spec.shape);
    this.queryPos.x = ox + Math.sin(yaw) * fwd;
    this.queryPos.y = attacker.currFeet.y + 0.9;
    this.queryPos.z = oz + Math.cos(yaw) * fwd;
    this.ball.radius = Math.max(1, shapeBoundingRadius(spec.shape));
    this.candidateCount = 0;
    this.querySelf = attacker;
    this.physics.world.intersectionsWithShape(
      this.queryPos,
      IDENTITY_ROT,
      this.ball,
      this.collect,
      undefined,
      hitQueryGroups(this.targetGroups(attacker)),
    );
    this.querySelf = null;
    for (let i = 0; i < this.candidateCount; i++) {
      const t = this.candidates[i];
      if (t === undefined || opts.hitSet.has(t.id)) continue;
      if (!targetInShape(spec.shape, ox, oz, yaw, t.currFeet.x, t.currFeet.z, t.radius)) continue;
      opts.hitSet.add(t.id);
      let dirX = t.currFeet.x - ox;
      let dirZ = t.currFeet.z - oz;
      const len = Math.hypot(dirX, dirZ);
      if (len < 1e-4) {
        dirX = Math.sin(yaw);
        dirZ = Math.cos(yaw);
      } else {
        dirX /= len;
        dirZ /= len;
      }
      if (this.applyHit(attacker, t, spec, dirX, dirZ, opts)) {
        r.hits++;
        r.maxHitStopMs = Math.max(r.maxHitStopMs, spec.hitStopMs);
        r.maxShake = Math.max(r.maxShake, spec.shake);
        if (t.health.dead) r.killed++;
      }
    }
    return r;
  }

  /** Returns false if the target evaded (i-frames). */
  applyHit(
    attacker: Actor,
    target: Actor,
    spec: HitSpec,
    dirX: number,
    dirZ: number,
    opts: Pick<
      StrikeOptions,
      'damageMult' | 'forceCrit' | 'counter' | 'difficultyMod' | 'extraStatus'
    >,
  ): boolean {
    if (!target.alive) return false;
    if (target.isInvulnerable()) {
      target.onEvaded();
      return false;
    }
    const block = target.blockFactor(attacker);
    const blocked = block < 1;
    computeDamage(
      {
        atk: attacker.stats.atk,
        def: target.stats.def,
        skillMult: spec.damage * (opts.damageMult ?? 1),
        critChance: blocked ? 0 : attacker.stats.critChance,
        critDamage: attacker.stats.critDamage,
        difficultyMod: opts.difficultyMod,
        bonusMult: target.damageTakenMult() * block,
        forceCrit: !blocked && opts.forceCrit === true,
      },
      this.rng,
      this.dmg,
    );
    const applied = target.health.damage(this.dmg.amount);
    const killed = target.health.dead;
    const poiseBroken =
      !killed && target.poise.apply(spec.poise * (blocked ? target.blockedPoiseMult() : 1));
    let status: StatusId | null = null;
    if (!killed && !blocked && spec.status !== undefined && this.rng() < spec.status.chance) {
      target.status.apply(spec.status.id, attacker.stats.atk, opts.difficultyMod);
      status = spec.status.id;
    }
    const extra = opts.extraStatus;
    if (!killed && !blocked && extra !== undefined && extra !== null && this.rng() < extra.chance) {
      target.status.apply(extra.status, attacker.stats.atk, opts.difficultyMod);
      status = extra.status;
    }
    const recoil =
      (spec.reaction === 'knockdown' ? 2 : spec.reaction === 'knockback' ? 1.5 : 1) *
      (this.dmg.crit ? 1.3 : 1) *
      (blocked ? 0.4 : 1) *
      (target.hasSuperArmor() ? 0.5 : 1);
    target.recoil(dirX, dirZ, recoil);
    target.onHit({
      attacker,
      spec,
      dirX,
      dirZ,
      amount: applied,
      crit: this.dmg.crit,
      poiseBroken,
      killed,
      blocked,
    });
    this.onDamage?.(attacker, target, applied);
    const e = this.hitEvent;
    e.attackerId = attacker.id;
    e.targetId = target.id;
    e.targetTeam = target.team;
    e.amount = applied;
    e.crit = this.dmg.crit;
    e.killed = killed;
    e.poiseBroken = poiseBroken;
    e.counter = opts.counter === true;
    e.blocked = blocked;
    e.dot = false;
    e.status = status;
    e.x = target.currFeet.x;
    e.y = target.currFeet.y + target.halfHeight * 2 + target.radius;
    e.z = target.currFeet.z;
    e.dirX = dirX;
    e.dirZ = dirZ;
    e.hitStopMs = spec.hitStopMs;
    e.shake = spec.shake;
    this.bus.emit('combat:hit', e);
    if (killed) {
      this.bus.emit('combat:death', {
        actorId: target.id,
        team: target.team,
        x: target.currFeet.x,
        z: target.currFeet.z,
      });
    }
    return true;
  }

  /** Damage-over-time tick from a status effect. */
  applyDot(target: Actor, id: StatusId, atkUnits: number, sourceMult: number): void {
    if (!target.alive) return;
    const amount = computeDotDamage(atkUnits, target.stats.def, sourceMult);
    const applied = target.health.damage(amount);
    if (applied <= 0) return;
    const killed = target.health.dead;
    this.onDamage?.(null, target, applied);
    const e = this.hitEvent;
    e.attackerId = 0;
    e.targetId = target.id;
    e.targetTeam = target.team;
    e.amount = applied;
    e.crit = false;
    e.killed = killed;
    e.poiseBroken = false;
    e.counter = false;
    e.blocked = false;
    e.dot = true;
    e.status = id;
    e.x = target.currFeet.x;
    e.y = target.currFeet.y + target.halfHeight * 2 + target.radius;
    e.z = target.currFeet.z;
    e.dirX = 0;
    e.dirZ = 0;
    e.hitStopMs = 0;
    e.shake = 0;
    this.bus.emit('combat:hit', e);
    if (killed) {
      target.onHit({
        attacker: target,
        spec: DOT_SPEC,
        dirX: 0,
        dirZ: 0,
        amount: applied,
        crit: false,
        poiseBroken: false,
        killed: true,
      });
      this.bus.emit('combat:death', {
        actorId: target.id,
        team: target.team,
        x: target.currFeet.x,
        z: target.currFeet.z,
      });
    }
  }
}

const DOT_SPEC: HitSpec = {
  damage: 0,
  poise: 0,
  reaction: 'flinch',
  knockback: 0,
  hitStopMs: 0,
  shake: 0,
  shape: { kind: 'circle', radius: 0, forward: 0 },
};
