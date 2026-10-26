import { Vector3, type AnimationClip, type Scene } from 'three';
import { AnimationController } from '../anim/AnimationController';
import { BodyDynamics } from '../anim/BodyDynamics';
import type { CharacterAnimator, CharacterRig } from '../anim/characterTypes';
import { HumanoidRig } from '../anim/HumanoidRig';
import { lerpAngle } from './components/movementMath';
import { Health } from '../combat/Health';
import { Poise } from '../combat/Poise';
import { StatusEffects } from '../combat/StatusEffects';
import type { TeamName } from '../core/events';
import type { HitSpec, StatBlock } from '../data/combatTypes';
import { PHYSICS_CONFIG } from '../data/config';
import { DissolveTimeline } from '../render/dissolve';
import type { RigDef } from '../data/rigs';
import { CharacterBody } from '../physics/CharacterBody';
import type { PhysicsWorld } from '../physics/PhysicsWorld';

export interface HitReceived {
  readonly attacker: Actor;
  readonly spec: HitSpec;
  readonly dirX: number;
  readonly dirZ: number;
  readonly amount: number;
  readonly crit: boolean;
  readonly poiseBroken: boolean;
  readonly killed: boolean;
  /** Absorbed by a shield. */
  readonly blocked?: boolean;
}

export interface ActorOptions {
  readonly rig: RigDef;
  /** A ready-made body (creatures); when given, `rig` / `clips` are not used. */
  readonly body?: { readonly rig: CharacterRig; readonly anim: CharacterAnimator };
  readonly stats: StatBlock;
  readonly poise: number;
  readonly radius: number;
  readonly halfHeight: number;
  readonly physics: PhysicsWorld;
  readonly membership: number;
  readonly clips: readonly AnimationClip[];
  readonly additiveClips: readonly AnimationClip[];
  readonly scene: Scene;
  readonly knockbackResist: number;
}

/** Knockback velocity decays exponentially at this rate (1/s); distance = v0 / rate. */
const KNOCKBACK_DECAY = 12;
/** Small downward velocity while grounded so slopes/steps stay glued. */
const GROUND_STICK = -2;

/**
 * Shared base for everything that fights: player, enemies, boss, training dummy.
 * Logic (fixed step) writes velocities/facing; `integrate()` moves the kinematic body; `render()`
 * interpolates the visual between the last two logic states and advances animation.
 */
export abstract class Actor {
  private static nextId = 1;
  readonly id = Actor.nextId++;
  abstract readonly team: TeamName;
  readonly rig: CharacterRig;
  readonly anim: CharacterAnimator;
  readonly body: CharacterBody;
  readonly health: Health;
  readonly poise: Poise;
  readonly status = new StatusEffects();
  stats: StatBlock;
  readonly radius: number;
  readonly halfHeight: number;
  readonly knockbackResist: number;

  readonly prevFeet = new Vector3();
  readonly currFeet = new Vector3();
  readonly renderFeet = new Vector3();
  /** Planar velocity of the rendered position (camera look-ahead). */
  readonly renderVelocity = new Vector3();
  private readonly lastRenderFeet = new Vector3();
  prevYaw = 0;
  currYaw = 0;
  /** Logic facing (radians, 0 = +Z). */
  yaw = 0;
  /** Planar locomotion velocity (m/s). */
  readonly vel = { x: 0, z: 0 };
  vy = 0;
  /** One-step displacement from separation / pushes (m). */
  readonly push = { x: 0, z: 0 };
  /** One-step displacement from action movement curves (m). */
  readonly actionDisp = { x: 0, z: 0 };
  private readonly kb = { x: 0, z: 0 };
  /** Visual-only vertical offset (boss leap arc). */
  visualLift = 0;
  inWorld = false;
  private flash = 0;
  private flashColor = 0xffffff;
  private flashDecay = 6;
  /** Procedural torso lean and hit recoil on top of the clips. */
  readonly dynamics = new BodyDynamics();
  /** Burn-away / form-from-ash state of the body (deaths, spawns). */
  readonly dissolve = new DissolveTimeline();
  private shownDissolve = 0;
  private lastRenderYaw = 0;

  protected constructor(opts: ActorOptions) {
    this.stats = opts.stats;
    this.radius = opts.radius;
    this.halfHeight = opts.halfHeight;
    this.knockbackResist = opts.knockbackResist;
    this.health = new Health(opts.stats.maxHp);
    this.poise = new Poise(opts.poise);
    if (opts.body !== undefined) {
      this.rig = opts.body.rig;
      this.anim = opts.body.anim;
    } else {
      const rig = new HumanoidRig(opts.rig);
      this.rig = rig;
      this.anim = new AnimationController(rig.root, opts.clips, opts.additiveClips);
    }
    this.anim.setLookBone(this.rig.bone('Head'));
    this.body = new CharacterBody(
      opts.physics,
      opts.radius,
      opts.halfHeight,
      0,
      -50,
      0,
      opts.membership,
    );
    this.body.setEnabled(false);
    this.rig.setVisible(false);
    opts.scene.add(this.rig.root);
  }

  get alive(): boolean {
    return this.inWorld && !this.health.dead;
  }

  get colliderHandle(): number {
    return this.body.colliderHandle;
  }

  abstract isInvulnerable(): boolean;
  abstract hasSuperArmor(): boolean;
  /** Reaction to a hit that already applied damage/poise/status. */
  abstract onHit(h: HitReceived): void;

  /** Multiplier on incoming damage (e.g. boss break window). */
  damageTakenMult(): number {
    return 1;
  }

  /** Fraction of the damage this actor deals that heals it (elite affixes; 0 = none). */
  lifeSteal(): number {
    return 0;
  }

  /**
   * Damage multiplier when hit by `attacker` (1 = no block). Shielded enemies return < 1 for
   * hits from the front.
   */
  blockFactor(_attacker: Actor): number {
    return 1;
  }

  /** Poise multiplier for blocked hits. */
  blockedPoiseMult(): number {
    return 1;
  }

  /** Called when an attack is avoided thanks to i-frames. */
  onEvaded(): void {
    // Default: nothing.
  }

  /** Places the actor in the world at (x, z) facing `yaw`, standing on the floor. */
  spawnAt(x: number, z: number, yaw: number, groundY = 0): void {
    this.body.setEnabled(true);
    this.body.teleport(x, groundY + this.body.footOffset + 0.05, z);
    this.yaw = this.prevYaw = this.currYaw = yaw;
    this.vel.x = this.vel.z = 0;
    this.kb.x = this.kb.z = 0;
    this.vy = 0;
    this.visualLift = 0;
    this.syncFeet();
    this.prevFeet.copy(this.currFeet);
    this.renderFeet.copy(this.currFeet);
    this.lastRenderFeet.copy(this.currFeet);
    this.renderVelocity.set(0, 0, 0);
    this.inWorld = true;
    this.rig.setVisible(true);
    this.rig.root.position.copy(this.currFeet);
    this.rig.root.rotation.y = yaw;
    this.lastRenderYaw = yaw;
    this.dynamics.reset();
    this.rig.resetSecondary();
    this.dissolve.reset();
    this.shownDissolve = 0;
    this.rig.setDissolve(0);
  }

  removeFromWorld(): void {
    this.inWorld = false;
    this.body.setEnabled(false);
    this.rig.setVisible(false);
    this.status.clear();
  }

  knockback(dirX: number, dirZ: number, distance: number): void {
    const d = distance * (1 - this.knockbackResist);
    if (d <= 0) return;
    const len = Math.hypot(dirX, dirZ) || 1;
    this.kb.x = (dirX / len) * d * KNOCKBACK_DECAY;
    this.kb.z = (dirZ / len) * d * KNOCKBACK_DECAY;
  }

  stopKnockback(): void {
    this.kb.x = this.kb.z = 0;
  }

  /** Torso recoil away from a hit (direction = where the hit pushes, strength ~0.5..2.5). */
  recoil(dirX: number, dirZ: number, strength: number): void {
    this.dynamics.impulse(dirX, dirZ, this.currYaw, strength);
  }

  flashHit(color = 0xffffff, decayPerSec = 6): void {
    this.flash = 1;
    this.flashColor = color;
    this.flashDecay = decayPerSec;
  }

  /** Facing helpers. */
  faceToward(x: number, z: number): void {
    const dx = x - this.currFeet.x;
    const dz = z - this.currFeet.z;
    if (dx * dx + dz * dz > 1e-6) this.yaw = Math.atan2(dx, dz);
  }

  distanceTo(other: Actor): number {
    return Math.hypot(other.currFeet.x - this.currFeet.x, other.currFeet.z - this.currFeet.z);
  }

  /** Edge-to-edge distance (subtracting both radii). */
  gapTo(other: Actor): number {
    return this.distanceTo(other) - this.radius - other.radius;
  }

  integrate(dtSec: number): void {
    this.prevFeet.copy(this.currFeet);
    this.prevYaw = this.currYaw;
    if (!this.inWorld) return;
    if (this.body.grounded && this.vy <= 0) this.vy = GROUND_STICK;
    else this.vy += PHYSICS_CONFIG.gravity * dtSec;
    const dx = (this.vel.x + this.kb.x) * dtSec + this.push.x + this.actionDisp.x;
    const dz = (this.vel.z + this.kb.z) * dtSec + this.push.z + this.actionDisp.z;
    this.body.move(dx, this.vy * dtSec, dz);
    const k = Math.exp(-KNOCKBACK_DECAY * dtSec);
    this.kb.x *= k;
    this.kb.z *= k;
    this.push.x = this.push.z = 0;
    this.actionDisp.x = this.actionDisp.z = 0;
    this.syncFeet();
    this.currYaw = this.yaw;
    if (this.currFeet.y < PHYSICS_CONFIG.killPlaneY) this.onFellOut();
  }

  /** Default: put back near the arena centre. */
  protected onFellOut(): void {
    this.body.teleport(0, 2, 0);
    this.syncFeet();
  }

  render(alpha: number, animDtSec: number, realDtSec: number): void {
    if (!this.inWorld) return;
    this.renderFeet.lerpVectors(this.prevFeet, this.currFeet, alpha);
    if (realDtSec > 0) {
      this.renderVelocity
        .subVectors(this.renderFeet, this.lastRenderFeet)
        .multiplyScalar(1 / realDtSec);
      this.renderVelocity.y = 0;
    }
    this.lastRenderFeet.copy(this.renderFeet);
    const root = this.rig.root;
    root.position.copy(this.renderFeet);
    root.position.y += this.visualLift;
    root.rotation.y = lerpAngle(this.prevYaw, this.currYaw, alpha);
    this.anim.update(animDtSec);
    if (animDtSec > 0) {
      let dYaw = root.rotation.y - this.lastRenderYaw;
      dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
      const turnRate = Math.max(-12, Math.min(12, dYaw / Math.max(realDtSec, 1e-3)));
      const v = this.renderVelocity;
      const yaw = root.rotation.y;
      const forward = v.x * Math.sin(yaw) + v.z * Math.cos(yaw);
      this.dynamics.update(animDtSec, Math.hypot(v.x, v.z), forward, turnRate);
      this.dynamics.apply(this.rig.bone('Spine'), this.rig.bone('Chest'));
      const right = -v.x * Math.cos(yaw) + v.z * Math.sin(yaw);
      this.rig.updateSecondary(animDtSec, forward, right, turnRate);
      this.postAnimate(animDtSec);
    }
    this.lastRenderYaw = root.rotation.y;
    this.dissolve.update(animDtSec);
    if (this.dissolve.amount !== this.shownDissolve) {
      this.shownDissolve = this.dissolve.amount;
      this.rig.setDissolve(this.shownDissolve);
    }
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - realDtSec * this.flashDecay);
      this.rig.setFlash(this.flash * 0.9, this.flashColor);
    }
  }

  /** Procedural touches applied after the clips and body dynamics (weapon shudder…). */
  protected postAnimate(_dtSec: number): void {
    // Default: nothing.
  }

  protected syncFeet(): void {
    const p = this.body.position;
    this.currFeet.set(p.x, p.y - this.body.footOffset, p.z);
  }

  dispose(): void {
    this.anim.dispose();
    this.rig.dispose();
    this.body.dispose();
  }
}
