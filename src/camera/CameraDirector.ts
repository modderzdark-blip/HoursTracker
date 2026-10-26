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
  /** Camera height at the end (default: `height`), e.g. a crane down from a high wide view. */
  readonly endHeight?: number;
  /** Look-at height at the end (default: `lookHeight`). */
  readonly endLookHeight?: number;
  /** The centre travels here over the shot (ignored when the shot follows an actor). */
  readonly toCenter?: Vector3;
  /** Easing of the move: 'smooth' (default, in-out), 'out' (fast start, gentle landing), 'in'. */
  readonly ease?: 'smooth' | 'out' | 'in';
}

/** Eased 0..1 progress for a shot (pure; exported for tests). */
export function easeShot(t: number, ease: OrbitShot['ease']): number {
  const x = Math.min(1, Math.max(0, t));
  switch (ease) {
    case 'out':
      return 1 - (1 - x) * (1 - x) * (1 - x);
    case 'in':
      return x * x * x;
    default:
      return x * x * (3 - 2 * x);
  }
}

/**
 * Scripted camera moves (stage fly-over, boss intro and death, kill cams, ultimate). While a shot
 * plays it owns the camera; the follow camera then blends back from wherever the shot ended. A
 * sequence plays several shots back to back; skip() ends the whole sequence.
 */
export class CameraDirector {
  private shot: OrbitShot | null = null;
  private queue: readonly OrbitShot[] = [];
  private queueIndex = 0;
  private elapsed = 0;
  private readonly center = new Vector3();
  private readonly look = new Vector3();
  private onDone: (() => void) | null = null;
  private follow: Vector3 | null = null;
  private focus = 0;
  /** Name of the playing shot (debug/tests). */
  kind = '';
  /** Playback speed (debug: slow shots down for screenshots on slow renderers). */
  timeScale = 1;

  get active(): boolean {
    return this.shot !== null;
  }

  /** Distance from the camera to the point it looks at (depth-of-field focus). */
  get focusDistance(): number {
    return this.focus;
  }

  /** 0..1 progress of the current shot (1 when idle). */
  get progress(): number {
    const s = this.shot;
    return s === null ? 1 : Math.min(1, this.elapsed / Math.max(1, s.durationMs));
  }

  /** Index of the playing shot inside its sequence. */
  get sequenceIndex(): number {
    return this.queueIndex;
  }

  /** `follow`, if given, is read every frame so the orbit tracks a moving actor. */
  play(shot: OrbitShot, onDone: () => void, follow: Vector3 | null = null, kind = 'shot'): void {
    this.playSequence([shot], onDone, follow, kind);
  }

  /** Plays the shots back to back (each starts where its own parameters say), then `onDone`. */
  playSequence(
    shots: readonly OrbitShot[],
    onDone: () => void,
    follow: Vector3 | null = null,
    kind = 'sequence',
  ): void {
    const first = shots[0];
    if (first === undefined) {
      onDone();
      return;
    }
    this.queue = shots;
    this.queueIndex = 0;
    this.onDone = onDone;
    this.follow = follow;
    this.kind = kind;
    this.begin(first);
  }

  private begin(shot: OrbitShot): void {
    this.shot = shot;
    this.elapsed = 0;
    this.center.copy(shot.center);
  }

  /** Ends the current shot — and the rest of its sequence — early (tap to skip). */
  skip(): void {
    if (this.shot === null) return;
    const last = this.queue[this.queue.length - 1];
    if (last !== undefined && last !== this.shot) {
      this.queueIndex = this.queue.length - 1;
      this.begin(last);
    }
    this.elapsed = this.shot.durationMs;
  }

  cancel(): void {
    this.shot = null;
    this.onDone = null;
    this.queue = [];
    this.kind = '';
  }

  /** Returns true while it controls the camera. */
  update(dtSec: number, camera: PerspectiveCamera): boolean {
    const s = this.shot;
    if (s === null) return false;
    this.elapsed += dtSec * 1000 * this.timeScale;
    const t = Math.min(1, this.elapsed / Math.max(1, s.durationMs));
    const k = easeShot(t, s.ease);
    if (this.follow !== null) {
      this.center.lerp(this.follow, t >= 1 ? 1 : Math.min(1, dtSec * 6));
    } else if (s.toCenter !== undefined) {
      this.center.lerpVectors(s.center, s.toCenter, k);
    }
    const deg = s.fromDeg + (s.toDeg - s.fromDeg) * k;
    const rad = (deg * Math.PI) / 180;
    const r = s.radius * (1 + ((s.endRadiusMult ?? 1) - 1) * k);
    const h = s.height + ((s.endHeight ?? s.height) - s.height) * k;
    const lh = s.lookHeight + ((s.endLookHeight ?? s.lookHeight) - s.lookHeight) * k;
    camera.position.set(
      this.center.x + Math.sin(rad) * r,
      this.center.y + h,
      this.center.z + Math.cos(rad) * r,
    );
    this.look.set(this.center.x, this.center.y + lh, this.center.z);
    this.focus = camera.position.distanceTo(this.look);
    camera.up.set(0, 1, 0);
    camera.lookAt(this.look);
    if (t >= 1) {
      const next = this.queue[this.queueIndex + 1];
      if (next !== undefined) {
        this.queueIndex++;
        this.begin(next);
        return true;
      }
      const done = this.onDone;
      this.shot = null;
      this.onDone = null;
      this.queue = [];
      this.kind = '';
      done?.();
    }
    return true;
  }
}
