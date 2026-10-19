import { Euler, Quaternion, type Bone } from 'three';

/** Damped spring for one value (semi-implicit Euler, sub-stepped for stability). */
class Spring {
  x = 0;
  v = 0;

  constructor(
    private readonly k: number,
    private readonly c: number,
  ) {}

  step(target: number, dt: number): void {
    const a = this.k * (target - this.x) - this.c * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
  }

  reset(): void {
    this.x = this.v = 0;
  }
}

const DEG = Math.PI / 180;
const MAX_LEAN_ROLL = 12 * DEG;
const MAX_LEAN_PITCH = 9 * DEG;
const MAX_RECOIL = 26 * DEG;
const SUBSTEP = 1 / 120;

/**
 * Procedural secondary motion layered on top of the animation clips, so pose-to-pose
 * animation reads as weight: the torso banks into turns, leans with acceleration, and snaps
 * away from the side a hit came from before springing back. Applied after the mixer each frame
 * (the mixer rewrites bone rotations every frame, so nothing accumulates).
 */
export class BodyDynamics {
  private readonly roll = new Spring(90, 14);
  private readonly pitch = new Spring(90, 14);
  private readonly recoilPitch = new Spring(220, 13);
  private readonly recoilRoll = new Spring(220, 13);
  private lastForwardSpeed = 0;
  private readonly e = new Euler();
  private readonly q = new Quaternion();

  /** Total torso offset in radians (x = pitch forward, z = roll toward the right). */
  get pitchRad(): number {
    return this.pitch.x + this.recoilPitch.x;
  }

  get rollRad(): number {
    return this.roll.x + this.recoilRoll.x;
  }

  /**
   * @param speed planar speed (m/s)
   * @param forwardSpeed speed along the facing direction (m/s)
   * @param turnRate yaw change (rad/s, positive = turning left)
   */
  update(dtSec: number, speed: number, forwardSpeed: number, turnRate: number): void {
    if (dtSec <= 0) return;
    const dt = Math.min(dtSec, 0.1);
    const accel = (forwardSpeed - this.lastForwardSpeed) / dt;
    this.lastForwardSpeed = forwardSpeed;
    // Bank into the turn (turning left tilts the torso left = negative roll), more when fast.
    const rollTarget = clamp(-turnRate * Math.min(speed, 8) * 0.018, MAX_LEAN_ROLL);
    // Lean forward when speeding up, back when braking; a slight constant lean while running.
    const pitchTarget = clamp(accel * 0.006 + Math.min(speed, 8) * 0.006, MAX_LEAN_PITCH);
    let t = dt;
    while (t > 1e-6) {
      const h = Math.min(SUBSTEP, t);
      this.roll.step(rollTarget, h);
      this.pitch.step(pitchTarget, h);
      this.recoilPitch.step(0, h);
      this.recoilRoll.step(0, h);
      t -= h;
    }
    this.recoilPitch.x = clamp(this.recoilPitch.x, MAX_RECOIL);
    this.recoilRoll.x = clamp(this.recoilRoll.x, MAX_RECOIL);
  }

  /**
   * Hit recoil. (dirX, dirZ) is the world direction the hit pushes the target; `yaw` the
   * target's facing. A hit from the front bends the torso back, from the right bends it left.
   */
  impulse(dirX: number, dirZ: number, yaw: number, strength: number): void {
    const len = Math.hypot(dirX, dirZ);
    if (len < 1e-6 || strength <= 0) return;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    // Character right = forward × up = (−fz, 0, fx).
    const forward = (dirX * fx + dirZ * fz) / len;
    const right = (dirX * -fz + dirZ * fx) / len;
    const kick = 3.2 * Math.min(strength, 2.5);
    this.recoilPitch.v += forward * kick;
    this.recoilRoll.v += right * kick;
  }

  /** Applies the offsets to the spine bones (call after the mixer has posed the rig). */
  apply(spine: Bone, chest: Bone): void {
    const p = this.pitchRad;
    const r = this.rollRad;
    if (Math.abs(p) < 1e-4 && Math.abs(r) < 1e-4) return;
    // Lean mostly from the lower spine; recoil also bends the chest so it reads as a whip.
    this.e.set(
      this.pitch.x * 0.8 + this.recoilPitch.x * 0.5,
      0,
      this.roll.x * 0.8 + this.recoilRoll.x * 0.5,
    );
    this.q.setFromEuler(this.e);
    spine.quaternion.premultiply(this.q);
    this.e.set(
      this.pitch.x * 0.2 + this.recoilPitch.x * 0.5,
      0,
      this.roll.x * 0.2 + this.recoilRoll.x * 0.5,
    );
    this.q.setFromEuler(this.e);
    chest.quaternion.premultiply(this.q);
  }

  reset(): void {
    this.roll.reset();
    this.pitch.reset();
    this.recoilPitch.reset();
    this.recoilRoll.reset();
    this.lastForwardSpeed = 0;
  }
}

function clamp(v: number, max: number): number {
  return Math.min(max, Math.max(-max, v));
}
