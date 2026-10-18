import type { HeroMovement } from '../../data/heroes';
import { approachVelocity, moveTowardsAngle, type PlanarVelocity } from './movementMath';

export interface Displacement {
  x: number;
  y: number;
  z: number;
}

/** Below this stick magnitude the character keeps its facing instead of snapping around. */
const FACING_INPUT_THRESHOLD = 0.08;
/** Small downward velocity kept while grounded so slopes and steps stay glued. */
const GROUND_STICK_VELOCITY = -2;

/**
 * Pure locomotion: analog input → accelerated planar velocity, turn-rate-limited facing, gravity.
 * Produces a displacement for the physics character controller. No allocation per step.
 */
export class CharacterMotor {
  readonly velocity: PlanarVelocity = { x: 0, z: 0 };
  verticalVelocity = 0;
  yaw = 0;
  /** 0..1 multiplier for future slows/roots (status effects in M5). */
  speedMultiplier = 1;

  constructor(
    private readonly movement: HeroMovement,
    private readonly gravity: number,
  ) {}

  /**
   * @param inputX world-space X component of the move input (magnitude ≤ 1 encodes analog speed)
   * @param inputZ world-space Z component
   * @param grounded whether the controller reported ground contact last step
   */
  step(
    inputX: number,
    inputZ: number,
    dtSec: number,
    grounded: boolean,
    out: Displacement,
  ): Displacement {
    const m = this.movement;
    const rawMag = Math.hypot(inputX, inputZ);
    const mag = Math.min(rawMag, 1);
    const speed = m.moveSpeed * this.speedMultiplier;
    // Clamp over-long input to the unit circle; magnitude below 1 = analog walk speed.
    const k = rawMag > 1 ? speed / rawMag : speed;
    const targetX = inputX * k;
    const targetZ = inputZ * k;
    const currentSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const accelerating = mag * speed >= currentSpeed - 1e-6 && mag > 0;
    const rate = accelerating ? m.acceleration : m.deceleration;
    approachVelocity(this.velocity, targetX, targetZ, rate * dtSec);

    if (mag > FACING_INPUT_THRESHOLD) {
      const targetYaw = Math.atan2(inputX, inputZ);
      this.yaw = moveTowardsAngle(this.yaw, targetYaw, ((m.turnRateDeg * Math.PI) / 180) * dtSec);
    }

    if (grounded && this.verticalVelocity <= 0) {
      this.verticalVelocity = GROUND_STICK_VELOCITY;
    } else {
      this.verticalVelocity += this.gravity * dtSec;
    }

    out.x = this.velocity.x * dtSec;
    out.y = this.verticalVelocity * dtSec;
    out.z = this.velocity.z * dtSec;
    return out;
  }

  get planarSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  reset(yaw = 0): void {
    this.velocity.x = 0;
    this.velocity.z = 0;
    this.verticalVelocity = 0;
    this.yaw = yaw;
  }
}
