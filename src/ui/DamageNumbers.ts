import { Vector3, type Camera } from 'three';
import { el } from './dom';

export type NumberKind = 'normal' | 'crit' | 'player' | 'dot' | 'info' | 'counter';

interface Num {
  readonly el: HTMLElement;
  active: boolean;
  age: number;
  life: number;
  readonly pos: Vector3;
  jitter: number;
}

const LIFE: Readonly<Record<NumberKind, number>> = {
  normal: 0.75,
  crit: 0.95,
  player: 0.85,
  dot: 0.6,
  info: 1.1,
  counter: 1.0,
};

/**
 * Pooled floating damage numbers (DOM). Projected from world space each frame; crits are bigger
 * and gold, damage taken is red, DoT ticks smaller. Writes only transform/opacity per frame.
 */
export class DamageNumbers {
  readonly root: HTMLElement;
  private readonly pool: Num[] = [];
  private readonly v = new Vector3();
  private next = 0;

  constructor(container: HTMLElement, size = 40) {
    this.root = el('div', 'dmg-layer');
    for (let i = 0; i < size; i++) {
      const n = el('div', 'dmg');
      n.style.opacity = '0';
      this.root.append(n);
      this.pool.push({ el: n, active: false, age: 0, life: 1, pos: new Vector3(), jitter: 0 });
    }
    container.append(this.root);
  }

  spawn(text: string, x: number, y: number, z: number, kind: NumberKind): void {
    const n = this.pool[this.next];
    if (n === undefined) return;
    this.next = (this.next + 1) % this.pool.length;
    n.active = true;
    n.age = 0;
    n.life = LIFE[kind];
    n.pos.set(x, y, z);
    n.jitter = (Math.random() - 0.5) * 36;
    n.el.textContent = text;
    n.el.className = `dmg dmg-${kind}`;
  }

  update(dtSec: number, camera: Camera, width: number, height: number): void {
    for (const n of this.pool) {
      if (!n.active) continue;
      n.age += dtSec;
      const t = n.age / n.life;
      if (t >= 1) {
        n.active = false;
        n.el.style.opacity = '0';
        continue;
      }
      this.v.copy(n.pos).project(camera);
      if (this.v.z > 1) {
        n.el.style.opacity = '0';
        continue;
      }
      const sx = (this.v.x * 0.5 + 0.5) * width + n.jitter * t;
      const sy = (-this.v.y * 0.5 + 0.5) * height - 46 * t;
      const pop = t < 0.12 ? 1.35 - t * 2.9 : 1;
      n.el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -50%) scale(${pop.toFixed(2)})`;
      n.el.style.opacity = (t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3).toFixed(2);
    }
  }

  clear(): void {
    for (const n of this.pool) {
      n.active = false;
      n.el.style.opacity = '0';
    }
  }

  dispose(): void {
    this.root.remove();
  }
}
