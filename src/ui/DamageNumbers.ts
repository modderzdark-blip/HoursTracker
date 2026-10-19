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
  /** Screen-space lift (px) chosen on the first frame so labels never sit on each other. */
  lift: number;
  placed: boolean;
  /** Last drawn box (px) for the overlap test. */
  x: number;
  y: number;
  w: number;
}

/** Row height (px) used when stacking labels that would overlap. */
const ROW_PX = 26;
const MAX_ROWS = 4;
/** Labels never rise into the top strip of the screen (HUD bars, wave text). */
const TOP_SAFE_FRAC = 0.17;

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
      this.pool.push({
        el: n,
        active: false,
        age: 0,
        life: 1,
        pos: new Vector3(),
        jitter: 0,
        lift: 0,
        placed: false,
        x: 0,
        y: 0,
        w: 0,
      });
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
    n.lift = 0;
    n.placed = false;
    n.w = 14 + text.length * (kind === 'info' ? 13 : 15);
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
      const bx = (this.v.x * 0.5 + 0.5) * width;
      const by = (-this.v.y * 0.5 + 0.5) * height;
      if (!n.placed) {
        // First frame: take the lowest free row above the anchor.
        n.placed = true;
        for (let row = 0; row < MAX_ROWS; row++) {
          const y = by - row * ROW_PX;
          if (!this.overlaps(n, bx, y)) {
            n.lift = row * ROW_PX;
            break;
          }
          n.lift = row * ROW_PX;
        }
      }
      const sx = bx + n.jitter * t;
      const sy = Math.max(height * TOP_SAFE_FRAC, by - n.lift - 46 * t);
      n.x = sx;
      n.y = sy;
      const pop = t < 0.12 ? 1.35 - t * 2.9 : 1;
      n.el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -50%) scale(${pop.toFixed(2)})`;
      n.el.style.opacity = (t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3).toFixed(2);
    }
  }

  private overlaps(self: Num, x: number, y: number): boolean {
    for (const o of this.pool) {
      if (o === self || !o.active || !o.placed) continue;
      if (Math.abs(o.y - y) < ROW_PX - 2 && Math.abs(o.x - x) < (o.w + self.w) / 2) return true;
    }
    return false;
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
