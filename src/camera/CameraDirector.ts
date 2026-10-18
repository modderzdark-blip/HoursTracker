import { Vector3, type PerspectiveCamera } from 'three';

export interface OrbitShot {
  /** Point the camera circles and looks at (copied at start; can follow via `follow`). */
  readonly center: Vector3;
  readonly radius: number;
  readonly height: number;
  readonly fromDeg: number;
  readonly toDeg: number;
  readonly durationMs: number;
  /** Look-at height above the centre. */
  readonly lookHeight: number;
  /** Radius multiplier at the end (zoom in < 1 / out > 1). */
  readonly endRadiusMult?: number;
}

/**
 * Scripted camera moves (boss intro, ultimate). While a shot plays it owns the camera; the
 * follow camera then blends back from wherever the shot ended.
 */
export class CameraDirector {
  private shot: OrbitShot | null = null;
  private elapsed = 0;
  private readonly center = new Vector3();
  private readonly look = new Vector3();
  private onDone: (() => void) | null = null;
  private follow: Vector3 | null = null;

  get active(): boolean {
    return this.shot !== null;
  }

  /** `follow`, if given, is read every frame so the orbit tracks a moving actor. */
  play(shot: OrbitShot, onDone: () => void, follow: Vector3 | null = null): void {
    this.shot = shot;
    this.elapsed = 0;
    this.center.copy(shot.center);
    this.onDone = onDone;
    this.follow = follow;
  }

  /** Ends the current shot early (tap to skip). */
  skip(): void {
    if (this.shot === null) return;
    this.elapsed = this.shot.durationMs;
  }

  cancel(): void {
    this.shot = null;
    this.onDone = null;
  }

  /** Returns true while it controls the camera. */
  update(dtSec: number, camera: PerspectiveCamera): boolean {
    const s = this.shot;
    if (s === null) return false;
    this.elapsed += dtSec * 1000;
    const t = Math.min(1, this.elapsed / s.durationMs);
    const k = t * t * (3 - 2 * t);
    if (this.follow !== null) this.center.lerp(this.follow, Math.min(1, dtSec * 6));
    const deg = s.fromDeg + (s.toDeg - s.fromDeg) * k;
    const rad = (deg * Math.PI) / 180;
    const r = s.radius * (1 + ((s.endRadiusMult ?? 1) - 1) * k);
    camera.position.set(
      this.center.x + Math.sin(rad) * r,
      this.center.y + s.height,
      this.center.z + Math.cos(rad) * r,
    );
    this.look.set(this.center.x, this.center.y + s.lookHeight, this.center.z);
    camera.up.set(0, 1, 0);
    camera.lookAt(this.look);
    if (t >= 1) {
      const done = this.onDone;
      this.shot = null;
      this.onDone = null;
      done?.();
    }
    return true;
  }
}
