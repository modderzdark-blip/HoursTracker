import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { CAMERA_CONFIG } from '../data/config';
import { CameraShake, type ShakeSample } from './CameraShake';
import { DEFAULT_CAMERA_OPTIONS, type CameraOptions } from './cameraOptions';

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
  private readonly baseOffset = new Vector3();
  private readonly framePoint = new Vector3();
  private framing = false;
  private frameBlend = 0;
  private readonly frameShift = new Vector3();
  private blendMs = 0;
  private blendTotalMs = 0;
  private readonly blendPos = new Vector3();
  private readonly blendQuat = new Quaternion();
  /** Live parameters from the camera settings (CAMERA_CONFIG scaled); see setOptions(). */
  private opts: CameraOptions = DEFAULT_CAMERA_OPTIONS;

  constructor(aspect: number, options: CameraOptions = DEFAULT_CAMERA_OPTIONS) {
    const c = CAMERA_CONFIG;
    this.camera = new PerspectiveCamera(options.fovDeg, aspect, c.near, c.far);
    this.setOptions(options);
  }

  get options(): CameraOptions {
    return this.opts;
  }

  /**
   * Applies the player's camera settings immediately: distance / height move the follow offset,
   * FOV changes the lens, and sharpness / look-ahead / shake are read every frame. Boss framing
   * scales this offset and cinematics blend back into it, so both keep working.
   */
  setOptions(options: CameraOptions): void {
    this.opts = options;
    this.recomputeOffset(options.distance, options.height);
    if (this.camera.fov !== options.fovDeg) {
      this.camera.fov = options.fovDeg;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Re-read distance/height/yaw (defaults: the live options; debug tweaks or per-stage overrides). */
  recomputeOffset(
    distance: number = this.opts.distance,
    height: number = this.opts.height,
    yawDeg: number = CAMERA_CONFIG.yawDeg,
  ): void {
    const yaw = (yawDeg * Math.PI) / 180;
    // yaw 0: camera sits at +Z looking toward -Z.
    this.baseOffset.set(Math.sin(yaw) * distance, height, Math.cos(yaw) * distance);
    this.offset.copy(this.baseOffset);
    this.forwardXZ.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    this.rightXZ.set(Math.cos(yaw), 0, -Math.sin(yaw));
  }

  /**
   * Keep a second point (the boss) in frame; null to stop. `sizeBonus` pulls the camera further
   * back for very large (or airborne) bosses (0.2 = +20% distance).
   */
  setFraming(point: Vector3 | null, sizeBonus = 0): void {
    this.framing = point !== null;
    if (point !== null) this.framePoint.copy(point);
    this.frameSize = Math.max(0, sizeBonus);
  }

  private frameSize = 0;

  /** Start from the current camera transform and ease into the follow pose (after cinematics). */
  blendFromCurrent(ms: number = CAMERA_CONFIG.cinematicBlendMs): void {
    this.blendPos.copy(this.camera.position);
    this.blendQuat.copy(this.camera.quaternion);
    this.blendMs = 0;
    this.blendTotalMs = ms;
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
    const o = this.opts;
    this.anchor.lerp(target, smoothingFactor(o.followSharpness, dtSec));
    const speedRatio = maxSpeed > 0 ? Math.min(velocity.length() / maxSpeed, 1) : 0;
    this.tmp.set(velocity.x, 0, velocity.z);
    if (this.tmp.lengthSq() > 1e-6 && o.lookAhead > 0)
      this.tmp.normalize().multiplyScalar(o.lookAhead * speedRatio);
    else this.tmp.set(0, 0, 0);
    this.lead.lerp(this.tmp, smoothingFactor(c.lookAheadSharpness, dtSec));
    // Boss framing: blend the anchor toward the boss and pull the camera back with distance.
    const bf = c.bossFraming;
    this.frameBlend +=
      ((this.framing ? 1 : 0) - this.frameBlend) * smoothingFactor(bf.sharpness, dtSec);
    let extra = 0;
    if (this.frameBlend > 0.001) {
      this.tmp.subVectors(this.framePoint, target);
      this.tmp.y = 0;
      const d = this.tmp.length();
      this.frameShift.copy(this.tmp).multiplyScalar(bf.anchorShift);
      if (this.frameShift.length() > bf.maxShift) this.frameShift.setLength(bf.maxShift);
      this.frameShift.multiplyScalar(this.frameBlend);
      extra =
        ((Math.min(d, bf.farDistance) / bf.farDistance) * bf.extraDistance + this.frameSize) *
        this.frameBlend;
    } else {
      this.frameShift.set(0, 0, 0);
    }
    this.offset.copy(this.baseOffset).multiplyScalar(1 + extra);
    this.apply(dtSec);
    if (this.blendTotalMs > 0) {
      this.blendMs += dtSec * 1000;
      const t = Math.min(1, this.blendMs / this.blendTotalMs);
      const k = t * t * (3 - 2 * t);
      this.camera.position.lerpVectors(this.blendPos, this.camera.position, k);
      this.camera.quaternion.slerpQuaternions(this.blendQuat, this.camera.quaternion, k);
      if (t >= 1) this.blendTotalMs = 0;
    }
  }

  private apply(dtSec: number): void {
    const c = CAMERA_CONFIG;
    this.lookTarget.copy(this.anchor).add(this.lead).add(this.frameShift);
    this.lookTarget.y += c.lookAtHeight;
    this.camera.position.copy(this.anchor).add(this.lead).add(this.frameShift).add(this.offset);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.lookTarget);

    const s = this.shake.update(dtSec, this.shakeSample);
    const k = this.opts.shake;
    if (k > 0 && (s.x !== 0 || s.y !== 0 || s.rollRad !== 0)) {
      // lookAt() updated the quaternion but not yet the matrix, so derive the axes from it.
      this.right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
      this.up.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
      this.camera.position.addScaledVector(this.right, s.x * k).addScaledVector(this.up, s.y * k);
      this.camera.rotateZ(s.rollRad * k);
    }
  }
}
