import {
  AdditiveAnimationBlendMode,
  AnimationMixer,
  AnimationUtils,
  LoopOnce,
  LoopRepeat,
  Quaternion,
  Vector3,
  type AnimationAction,
  type AnimationClip,
  type Bone,
  type Object3D,
} from 'three';

export interface PlayOptions {
  /** Crossfade time in seconds. */
  readonly fade?: number;
  readonly loop?: boolean;
  /** Stretch/compress the clip to exactly this many seconds. */
  readonly durationSec?: number;
  /** Restart even if this clip is already playing. */
  readonly restart?: boolean;
}

interface ClipEvent {
  readonly clip: string;
  readonly at: number;
  readonly fn: () => void;
}

const UP = new Vector3(0, 1, 0);

/**
 * Animation state player on top of THREE.AnimationMixer: one base layer with crossfades, an
 * additive hit-reaction layer, normalised-time events, and a procedural head look-at applied
 * after the mixer. Combat timing stays authoritative in fixed-step logic; clips are stretched to
 * the logic durations so the visible hit frame matches.
 */
export class AnimationController {
  readonly mixer: AnimationMixer;
  private readonly actions = new Map<string, AnimationAction>();
  private readonly additive = new Map<string, AnimationAction>();
  private current: AnimationAction | null = null;
  private currentName = '';
  private readonly events: ClipEvent[] = [];
  private lastNorm = 0;
  private lookBone: Bone | null = null;
  private lookYaw = 0;
  private lookTargetYaw = 0;
  private readonly lookQ = new Quaternion();

  constructor(
    root: Object3D,
    clips: readonly AnimationClip[],
    additiveClips: readonly AnimationClip[] = [],
  ) {
    this.mixer = new AnimationMixer(root);
    for (const c of clips) this.actions.set(c.name, this.mixer.clipAction(c));
    for (const c of additiveClips) {
      const add = AnimationUtils.makeClipAdditive(c.clone());
      const a = this.mixer.clipAction(add, undefined, AdditiveAnimationBlendMode);
      a.setLoop(LoopOnce, 1);
      a.clampWhenFinished = false;
      this.additive.set(c.name, a);
    }
  }

  get playing(): string {
    return this.currentName;
  }

  has(name: string): boolean {
    return this.actions.has(name);
  }

  play(name: string, opts: PlayOptions = {}): void {
    const next = this.actions.get(name);
    if (next === undefined) {
      console.warn(`[anim] missing clip ${name}`);
      return;
    }
    if (next === this.current && opts.restart !== true) {
      if (opts.durationSec !== undefined) next.setDuration(opts.durationSec);
      return;
    }
    const fade = opts.fade ?? 0.12;
    next.reset();
    next.enabled = true;
    next.setLoop(opts.loop === true ? LoopRepeat : LoopOnce, opts.loop === true ? Infinity : 1);
    next.clampWhenFinished = opts.loop !== true;
    next.setEffectiveTimeScale(1);
    if (opts.durationSec !== undefined && opts.durationSec > 0) next.setDuration(opts.durationSec);
    next.setEffectiveWeight(1);
    next.play();
    if (this.current !== null && this.current !== next && fade > 0) {
      this.current.crossFadeTo(next, fade, false);
    } else if (this.current !== null && this.current !== next) {
      this.current.stop();
    }
    this.current = next;
    this.currentName = name;
    this.lastNorm = 0;
  }

  /** Freezes / resumes the current clip (hold-to-charge skills hold their wind-up pose). */
  setPaused(paused: boolean): void {
    if (this.current !== null) this.current.paused = paused;
  }

  /** Additive hit reaction on top of whatever plays (strength 0..1). */
  react(name: string, strength = 1, durationSec?: number): void {
    const a = this.additive.get(name);
    if (a === undefined) return;
    a.reset();
    if (durationSec !== undefined) a.setDuration(durationSec);
    a.setEffectiveWeight(Math.min(Math.max(strength, 0), 1.5));
    a.play();
  }

  /** Calls `fn` when clip `clip` crosses normalised time `at` (0..1). */
  onEvent(clip: string, at: number, fn: () => void): void {
    this.events.push({ clip, at, fn });
  }

  /** Bone that turns toward a look target (usually Head). */
  setLookBone(bone: Bone | null): void {
    this.lookBone = bone;
  }

  /** Yaw (radians, relative to the body) the head should turn toward; 0 = straight ahead. */
  setLookYaw(relativeYaw: number): void {
    const limit = 1.05;
    this.lookTargetYaw = Math.min(Math.max(relativeYaw, -limit), limit);
  }

  /** Normalised time of the current clip (0..1). */
  get normalizedTime(): number {
    const a = this.current;
    if (a === null) return 0;
    const d = a.getClip().duration;
    return d > 0 ? (a.time % d) / d : 0;
  }

  update(dtSec: number): void {
    this.mixer.update(dtSec);
    const a = this.current;
    if (a !== null && this.events.length > 0) {
      const d = a.getClip().duration;
      const norm = d > 0 ? Math.min(a.time / d, 1) : 0;
      const loopNorm = a.loop === LoopRepeat ? (a.time % d) / d : norm;
      const prev = this.lastNorm;
      for (const ev of this.events) {
        if (ev.clip !== this.currentName) continue;
        const crossed =
          loopNorm >= prev ? ev.at > prev && ev.at <= loopNorm : ev.at > prev || ev.at <= loopNorm;
        if (crossed) ev.fn();
      }
      this.lastNorm = loopNorm;
    }
    if (this.lookBone !== null) {
      this.lookYaw += (this.lookTargetYaw - this.lookYaw) * Math.min(1, dtSec * 8);
      if (Math.abs(this.lookYaw) > 1e-4) {
        this.lookQ.setFromAxisAngle(UP, this.lookYaw);
        this.lookBone.quaternion.premultiply(this.lookQ);
      }
    }
  }

  stopAll(): void {
    this.mixer.stopAllAction();
    this.current = null;
    this.currentName = '';
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
  }
}
