import type { AnimationClip, Scene } from 'three';
import { AnimationController } from '../anim/AnimationController';
import { HumanoidRig } from '../anim/HumanoidRig';
import type { RigDef } from '../data/rigs';

interface Clone {
  readonly rig: HumanoidRig;
  readonly anim: AnimationController;
  ageSec: number;
  active: boolean;
}

const LIFE_SEC = 0.75;
const FADE_FROM = 0.4;

/**
 * Ultimate "Hollow Legion": translucent shadow copies of the hero that appear around targets and
 * strike. Pooled rigs (created at load), each playing one of the hero's real slash clips.
 */
export class ShadowClones {
  private readonly clones: Clone[] = [];
  private next = 0;

  constructor(
    scene: Scene,
    rigDef: RigDef,
    private readonly clipNames: readonly string[],
    clips: readonly AnimationClip[],
    count: number,
  ) {
    for (let i = 0; i < count; i++) {
      const rig = new HumanoidRig(rigDef, true);
      rig.setVisible(false);
      scene.add(rig.root);
      this.clones.push({
        rig,
        anim: new AnimationController(rig.root, clips),
        ageSec: 0,
        active: false,
      });
    }
  }

  spawn(x: number, z: number, yaw: number): void {
    const c = this.clones[this.next];
    if (c === undefined) return;
    this.next = (this.next + 1) % this.clones.length;
    c.active = true;
    c.ageSec = 0;
    c.rig.root.position.set(x, 0, z);
    c.rig.root.rotation.y = yaw;
    c.rig.material.opacity = 0.6;
    c.rig.setVisible(true);
    const clip = this.clipNames[Math.floor(Math.random() * this.clipNames.length)] ?? '';
    c.anim.play(clip, { durationSec: 0.42, fade: 0, restart: true });
  }

  update(dtSec: number): void {
    for (const c of this.clones) {
      if (!c.active) continue;
      c.ageSec += dtSec;
      c.anim.update(dtSec);
      if (c.ageSec > FADE_FROM)
        c.rig.material.opacity =
          0.6 * Math.max(0, 1 - (c.ageSec - FADE_FROM) / (LIFE_SEC - FADE_FROM));
      if (c.ageSec >= LIFE_SEC) {
        c.active = false;
        c.rig.setVisible(false);
      }
    }
  }

  clear(): void {
    for (const c of this.clones) {
      c.active = false;
      c.rig.setVisible(false);
    }
  }

  dispose(): void {
    for (const c of this.clones) {
      c.anim.dispose();
      c.rig.dispose();
    }
  }
}
