import { PerspectiveCamera, Vector3 } from 'three';
import { CAMERA_CONFIG } from '../data/config';
import { CameraShake, type ShakeSample } from './CameraShake';

/** Frame-rate independent exponential smoothing factor. */
export function smoothingFactor(sharpness: number, dtSec: number): number {
  return 1 - Math.exp(-sharpness * dtSec);
}

/**
 * Three-quarter elevated follow camera. Position = target + offset from (distance, height, yaw);
 * eases toward the target with a small look-ahead in the movement direction. Shake is applied
 * in camera space on top, so it never moves the follow anchor.
 */
export class FollowCamera {
  readonly camera: PerspectiveCamera;
  readonly shake = new CameraShake(CAMERA_CONFIG.shake);
  private readonly anchor = new Vector3();
  private readonly lead = new Vector3();
  private readonly offset = new Vector3();
  private readonly lookTarget = new Vector3();
  private readonly tmp = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly shakeSample: ShakeSample = { x: 0, y: 0, rollRad: 0 };
  /** Ground-plane basis for camera-relative movement (unit vectors on XZ). */
  readonly forwardXZ = new Vector3();
  readonly rightXZ = new Vector3();

  constructor(aspect: number) {
    const c = CAMERA_CONFIG;
    this.camera = new PerspectiveCamera(c.fovDeg, aspect, c.near, c.far);
    this.recomputeOffset();
  }

  /** Re-read distance/height/yaw from config (debug tweaks or per-stage overrides). */
  recomputeOffset(
    distance: number = CAMERA_CONFIG.distance,
    height: number = CAMERA_CONFIG.height,
    yawDeg: number = CAMERA_CONFIG.yawDeg,
  ): void {
    const yaw = (yawDeg * Math.PI) / 180;
    // yaw 0: camera sits at +Z looking toward -Z.
    this.offset.set(Math.sin(yaw) * distance, height, Math.cos(yaw) * distance);
    this.forwardXZ.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    this.rightXZ.set(Math.cos(yaw), 0, -Math.sin(yaw));
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Jump straight to the target (spawn, respawn, cut). */
  snap(target: Vector3): void {
    this.anchor.copy(target);
    this.lead.set(0, 0, 0);
    this.apply(0);
  }

  /**
   * @param target the (interpolated) position of the followed actor's feet
   * @param velocity its planar velocity, used for look-ahead
   */
  update(target: Vector3, velocity: Vector3, dtSec: number, maxSpeed: number): void {
    const c = CAMERA_CONFIG;
    this.anchor.lerp(target, smoothingFactor(c.followSharpness, dtSec));
    const speedRatio = maxSpeed > 0 ? Math.min(velocity.length() / maxSpeed, 1) : 0;
    this.tmp.set(velocity.x, 0, velocity.z);
    if (this.tmp.lengthSq() > 1e-6) this.tmp.normalize().multiplyScalar(c.lookAhead * speedRatio);
    else this.tmp.set(0, 0, 0);
    this.lead.lerp(this.tmp, smoothingFactor(c.lookAheadSharpness, dtSec));
    this.apply(dtSec);
  }

  private apply(dtSec: number): void {
    const c = CAMERA_CONFIG;
    this.lookTarget.copy(this.anchor).add(this.lead);
    this.lookTarget.y += c.lookAtHeight;
    this.camera.position.copy(this.anchor).add(this.lead).add(this.offset);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.lookTarget);

    const s = this.shake.update(dtSec, this.shakeSample);
    if (s.x !== 0 || s.y !== 0 || s.rollRad !== 0) {
      // lookAt() updated the quaternion but not yet the matrix, so derive the axes from it.
      this.right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
      this.up.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
      this.camera.position.addScaledVector(this.right, s.x).addScaledVector(this.up, s.y);
      this.camera.rotateZ(s.rollRad);
    }
  }
}
