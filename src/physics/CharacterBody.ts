import type RAPIER from '@dimforge/rapier3d-compat';
import { PHYSICS_CONFIG } from '../data/config';
import { MOVE_QUERY_GROUPS, characterGroups, GROUP } from './groups';
import type { PhysicsWorld } from './PhysicsWorld';

interface MutableVec {
  x: number;
  y: number;
  z: number;
}

/**
 * Kinematic capsule driven by Rapier's KinematicCharacterController: slides along walls, climbs
 * slopes up to a limit, auto-steps small ledges and snaps to the ground. `position` is the
 * capsule centre and is tracked here so reading it never allocates.
 */
export class CharacterBody {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly controller: RAPIER.KinematicCharacterController;
  readonly position: MutableVec = { x: 0, y: 0, z: 0 };
  /** Distance from capsule centre down to the feet. */
  readonly footOffset: number;
  grounded = false;
  private readonly desired: MutableVec = { x: 0, y: 0, z: 0 };
  private readonly corrected: MutableVec = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly physics: PhysicsWorld,
    radius: number,
    halfHeight: number,
    x: number,
    y: number,
    z: number,
    membership: number = GROUP.player,
  ) {
    const R = physics.rapier;
    const world = physics.world;
    this.footOffset = halfHeight + radius;
    this.body = world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z),
    );
    this.collider = world.createCollider(
      R.ColliderDesc.capsule(halfHeight, radius).setCollisionGroups(characterGroups(membership)),
      this.body,
    );
    this.position.x = x;
    this.position.y = y;
    this.position.z = z;

    const c = world.createCharacterController(PHYSICS_CONFIG.controllerOffset);
    c.setUp({ x: 0, y: 1, z: 0 });
    c.setSlideEnabled(true);
    c.setMaxSlopeClimbAngle((PHYSICS_CONFIG.maxSlopeClimbDeg * Math.PI) / 180);
    c.setMinSlopeSlideAngle((PHYSICS_CONFIG.minSlopeSlideDeg * Math.PI) / 180);
    c.enableAutostep(PHYSICS_CONFIG.autostepMaxHeight, PHYSICS_CONFIG.autostepMinWidth, false);
    c.enableSnapToGround(PHYSICS_CONFIG.snapToGroundDistance);
    c.setApplyImpulsesToDynamicBodies(false);
    this.controller = c;
  }

  /** Resolves a desired displacement against the world and queues the kinematic move. */
  move(dx: number, dy: number, dz: number): void {
    this.desired.x = dx;
    this.desired.y = dy;
    this.desired.z = dz;
    // Characters only collide with level geometry; crowd separation keeps them apart softly.
    this.controller.computeColliderMovement(
      this.collider,
      this.desired,
      undefined,
      MOVE_QUERY_GROUPS,
    );
    this.controller.computedMovement(this.corrected);
    this.grounded = this.controller.computedGrounded();
    this.position.x += this.corrected.x;
    this.position.y += this.corrected.y;
    this.position.z += this.corrected.z;
    this.body.setNextKinematicTranslation(this.position);
  }

  /** Last applied displacement (after collision response). */
  get lastMovement(): Readonly<MutableVec> {
    return this.corrected;
  }

  teleport(x: number, y: number, z: number): void {
    this.position.x = x;
    this.position.y = y;
    this.position.z = z;
    this.body.setTranslation(this.position, true);
    this.body.setNextKinematicTranslation(this.position);
    this.grounded = false;
  }

  /** Pooled actors are disabled instead of destroyed (no hits, no queries). */
  setEnabled(enabled: boolean): void {
    this.body.setEnabled(enabled);
  }

  get colliderHandle(): number {
    return this.collider.handle;
  }

  dispose(): void {
    this.physics.world.removeCharacterController(this.controller);
    this.physics.world.removeRigidBody(this.body);
  }
}
