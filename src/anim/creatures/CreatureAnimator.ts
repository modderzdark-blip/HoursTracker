import { Euler, Quaternion, Vector3, type Bone } from 'three';
import type { CreatureMotion } from '../../data/creatures';
import type { PlayOptions } from '../AnimationController';
import type { CharacterAnimator } from '../characterTypes';
import type { CreatureMode, CreaturePlan, PoseOut } from './types';

const UP = new Vector3(0, 1, 0);

interface ClipEvent {
  readonly clip: string;
  readonly at: number;
  readonly fn: () => void;
}

/**
 * Procedural animation for creatures, behind the same interface as the clip-based
 * AnimationController: the AI still asks for 'idle', 'run', '<attack>:tele', '<attack>:strike',
 * 'stagger', 'roar', 'death'…, and the body plan computes the pose from the mode, the attack's
 * motion and time. Changes of mode cross-fade from a snapshot of the previous pose.
 */
export class CreatureAnimator implements CharacterAnimator {
  private name = '';
  private mode: CreatureMode = 'idle';
  private motion: CreatureMotion | null = null;
  private elapsed = 0;
  private duration = 1;
  private loop = true;
  private paused = false;
  private time = Math.random() * 10;
  private gait = 0;
  private moving = 0;
  private fade = 0;
  private fadeLeft = 0;
  private lookYaw = 0;
  private lookTarget = 0;
  private hurt = 0;
  private lastNorm = 0;
  private readonly events: ClipEvent[] = [];
  private readonly out: PoseOut = new Map();
  private readonly snapQ = new Map<string, Quaternion>();
  private snapLift = 0;
  private lift = 0;
  private readonly baseBodyPos = new Vector3();
  private readonly e = new Euler();
  private readonly q = new Quaternion();
  private readonly lookQ = new Quaternion();

  constructor(
    private readonly plan: CreaturePlan,
    private readonly bones: ReadonlyMap<string, Bone>,
    /** Attack id → motion (from the creature's attack data). */
    private readonly motions: ReadonlyMap<string, CreatureMotion>,
  ) {
    const body = bones.get(plan.bodyBone);
    if (body !== undefined) this.baseBodyPos.copy(body.position);
    for (const name of bones.keys()) this.snapQ.set(name, new Quaternion());
  }

  get playing(): string {
    return this.name;
  }

  get normalizedTime(): number {
    return this.loop
      ? (this.elapsed / this.duration) % 1
      : Math.min(1, this.elapsed / this.duration);
  }

  has(name: string): boolean {
    return this.parse(name) !== null;
  }

  /** Procedural modes have no natural length; callers pass `durationSec`. */
  clipDuration(_name: string): number {
    return 0;
  }

  get finished(): boolean {
    return !this.loop && this.elapsed >= this.duration;
  }

  private parse(name: string): { mode: CreatureMode; motion: CreatureMotion | null } | null {
    const i = name.lastIndexOf(':');
    if (i > 0) {
      const kind = name.slice(i + 1);
      const motion = this.motions.get(name.slice(0, i)) ?? null;
      if (kind === 'tele') return { mode: 'tele', motion };
      if (kind === 'strike') return { mode: 'strike', motion };
      return null;
    }
    switch (name) {
      case 'idle':
      case 'run':
      case 'stagger':
      case 'death':
      case 'roar':
      case 'spawn':
      case 'knockdown':
      case 'getup':
        return { mode: name, motion: null };
      default:
        return null;
    }
  }

  play(name: string, opts: PlayOptions = {}): void {
    const parsed = this.parse(name);
    if (parsed === null) return;
    if (name === this.name && opts.restart !== true) {
      if (opts.durationSec !== undefined && opts.durationSec > 0) this.duration = opts.durationSec;
      return;
    }
    // Snapshot the current pose so the new mode blends in from it.
    for (const [bone, q] of this.snapQ) {
      const b = this.bones.get(bone);
      if (b !== undefined) q.copy(b.quaternion);
    }
    this.snapLift = this.lift;
    this.fade = Math.max(0.001, opts.fade ?? 0.12);
    this.fadeLeft = this.fade;
    this.name = name;
    this.mode = parsed.mode;
    this.motion = parsed.motion;
    this.elapsed = 0;
    this.lastNorm = 0;
    this.loop = opts.loop === true;
    this.duration = opts.durationSec !== undefined && opts.durationSec > 0 ? opts.durationSec : 1;
  }

  react(_name: string, strength = 1): void {
    this.hurt = Math.min(1.5, Math.max(this.hurt, strength));
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  setLookBone(_bone: Bone | null): void {
    // The plan's head bone is used directly.
  }

  setLookYaw(relativeYaw: number): void {
    this.lookTarget = Math.max(-0.9, Math.min(0.9, relativeYaw));
  }

  onEvent(clip: string, at: number, fn: () => void): void {
    this.events.push({ clip, at, fn });
  }

  update(dtSec: number): void {
    if (dtSec <= 0) return;
    this.time += dtSec;
    if (!this.paused) this.elapsed += dtSec;
    const running = this.mode === 'run';
    this.moving += ((running ? 1 : 0) - this.moving) * Math.min(1, dtSec * 6);
    if (running) this.gait = (this.gait + dtSec / Math.max(0.2, this.duration)) % 1;
    this.lookYaw += (this.lookTarget - this.lookYaw) * Math.min(1, dtSec * 6);
    this.hurt = Math.max(0, this.hurt - dtSec * 4);
    const norm = this.normalizedTime;
    for (const ev of this.events) {
      if (ev.clip !== this.name) continue;
      const crossed =
        norm >= this.lastNorm
          ? ev.at > this.lastNorm && ev.at <= norm
          : ev.at > this.lastNorm || ev.at <= norm;
      if (crossed) ev.fn();
    }
    this.lastNorm = norm;

    this.out.clear();
    const lift = this.plan.pose(
      {
        mode: this.mode,
        motion: this.motion,
        t: this.loop ? norm : Math.min(1, this.elapsed / this.duration),
        time: this.time,
        gait: this.gait,
        moving: this.moving,
        look: this.lookYaw,
      },
      this.out,
    );
    this.fadeLeft = Math.max(0, this.fadeLeft - dtSec);
    const k = 1 - this.fadeLeft / this.fade;
    const blend = k * k * (3 - 2 * k);
    for (const [name, bone] of this.bones) {
      const r = this.out.get(name);
      if (r === undefined) this.q.identity();
      else this.q.setFromEuler(this.e.set(r[0], r[1], r[2], 'XYZ'));
      const snap = this.snapQ.get(name);
      if (snap !== undefined && blend < 1) bone.quaternion.slerpQuaternions(snap, this.q, blend);
      else bone.quaternion.copy(this.q);
    }
    // Hurt recoil: the body jolts back briefly.
    if (this.hurt > 0) {
      const body = this.bones.get(this.plan.core.Chest);
      if (body !== undefined) {
        this.q.setFromEuler(this.e.set(-0.18 * this.hurt, 0, 0));
        body.quaternion.multiply(this.q);
      }
    }
    // Head turns toward the target on top of the pose.
    const head = this.bones.get(this.plan.core.Head);
    if (head !== undefined && Math.abs(this.lookYaw) > 1e-4) {
      this.lookQ.setFromAxisAngle(UP, this.lookYaw * 0.6);
      head.quaternion.premultiply(this.lookQ);
    }
    this.lift = this.snapLift + (lift - this.snapLift) * blend;
    const body = this.bones.get(this.plan.bodyBone);
    if (body !== undefined)
      body.position.set(this.baseBodyPos.x, this.baseBodyPos.y + this.lift, this.baseBodyPos.z);
  }

  stopAll(): void {
    this.name = '';
  }

  dispose(): void {
    this.events.length = 0;
  }
}
