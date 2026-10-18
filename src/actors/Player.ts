import { Vector3, type Scene } from 'three';
import { PHYSICS_CONFIG } from '../data/config';
import type { HeroDef } from '../data/heroes';
import { CharacterBody } from '../physics/CharacterBody';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { CharacterMotor, type Displacement } from './components/CharacterMotor';
import { lerpAngle } from './components/movementMath';
import { PlaceholderHeroVisual } from './PlaceholderHeroVisual';

/**
 * The player-controlled hero: locomotion motor + kinematic physics body + visual.
 * Logic runs in fixedUpdate at the fixed rate; render() interpolates between the last two logic
 * states so motion stays smooth at any display rate.
 */
export class Player {
  readonly motor: CharacterMotor;
  readonly body: CharacterBody;
  readonly visual: PlaceholderHeroVisual;
  /** Feet position at the previous / current logic step. */
  readonly prevFeet = new Vector3();
  readonly currFeet = new Vector3();
  prevYaw = 0;
  currYaw = 0;
  /** Interpolated feet position for this render frame. */
  readonly renderFeet = new Vector3();
  readonly renderVelocity = new Vector3();
  private readonly lastRenderFeet = new Vector3();
  private readonly displacement: Displacement = { x: 0, y: 0, z: 0 };
  private readonly spawnPoint = new Vector3();
  respawnCount = 0;

  constructor(
    readonly def: HeroDef,
    physics: PhysicsWorld,
    scene: Scene,
    spawn: readonly [number, number, number],
  ) {
    this.motor = new CharacterMotor(def.movement, PHYSICS_CONFIG.gravity);
    const { capsuleRadius: r, capsuleHalfHeight: h } = def.body;
    this.spawnPoint.set(spawn[0], spawn[1], spawn[2]);
    this.body = new CharacterBody(physics, r, h, spawn[0], spawn[1] + h + r, spawn[2]);
    this.visual = new PlaceholderHeroVisual(def);
    scene.add(this.visual.root);
    this.syncFromBody();
    this.prevFeet.copy(this.currFeet);
    this.renderFeet.copy(this.currFeet);
    this.lastRenderFeet.copy(this.currFeet);
    // Face away from the camera at spawn.
    this.motor.reset(Math.PI);
    this.prevYaw = this.currYaw = this.motor.yaw;
  }

  /**
   * @param moveX world-space X of the move input (≤1 magnitude)
   * @param moveZ world-space Z of the move input
   */
  fixedUpdate(dtSec: number, moveX: number, moveZ: number): void {
    this.prevFeet.copy(this.currFeet);
    this.prevYaw = this.currYaw;

    this.motor.step(moveX, moveZ, dtSec, this.body.grounded, this.displacement);
    this.body.move(this.displacement.x, this.displacement.y, this.displacement.z);
    // If a wall blocked us, bleed off the velocity we couldn't use (no "sticky" acceleration).
    const applied = this.body.lastMovement;
    if (dtSec > 0) {
      const wantX = this.displacement.x;
      const wantZ = this.displacement.z;
      if (Math.abs(applied.x) < Math.abs(wantX) * 0.5) this.motor.velocity.x = applied.x / dtSec;
      if (Math.abs(applied.z) < Math.abs(wantZ) * 0.5) this.motor.velocity.z = applied.z / dtSec;
    }
    this.syncFromBody();
    this.currYaw = this.motor.yaw;

    if (this.currFeet.y < PHYSICS_CONFIG.killPlaneY) this.respawn();
  }

  render(alpha: number, dtSec: number): void {
    this.renderFeet.lerpVectors(this.prevFeet, this.currFeet, alpha);
    const yaw = lerpAngle(this.prevYaw, this.currYaw, alpha);
    this.visual.root.position.copy(this.renderFeet);
    this.visual.root.rotation.y = yaw;
    const travelled = Math.hypot(
      this.renderFeet.x - this.lastRenderFeet.x,
      this.renderFeet.z - this.lastRenderFeet.z,
    );
    if (dtSec > 0) {
      this.renderVelocity
        .subVectors(this.renderFeet, this.lastRenderFeet)
        .multiplyScalar(1 / dtSec);
      this.renderVelocity.y = 0;
    }
    this.lastRenderFeet.copy(this.renderFeet);
    const speedRatio = this.motor.planarSpeed / this.def.movement.moveSpeed;
    this.visual.update(dtSec, speedRatio, travelled);
  }

  respawn(): void {
    const { capsuleRadius: r, capsuleHalfHeight: h } = this.def.body;
    this.body.teleport(this.spawnPoint.x, this.spawnPoint.y + h + r, this.spawnPoint.z);
    this.motor.reset(Math.PI);
    this.syncFromBody();
    this.prevFeet.copy(this.currFeet);
    this.renderFeet.copy(this.currFeet);
    this.lastRenderFeet.copy(this.currFeet);
    this.prevYaw = this.currYaw = this.motor.yaw;
    this.respawnCount++;
  }

  dispose(): void {
    this.visual.dispose();
    this.body.dispose();
  }

  private syncFromBody(): void {
    const p = this.body.position;
    this.currFeet.set(p.x, p.y - this.body.footOffset, p.z);
  }
}
