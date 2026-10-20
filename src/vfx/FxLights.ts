import { PointLight, type Scene } from 'three';

interface Slot {
  readonly light: PointLight;
  peak: number;
  life: number;
  age: number;
}

/**
 * A tiny pool of point lights that flash with big effects (explosions, slams, ultimates,
 * deaths) so they light the floor and walls around them. The lights stay in the scene with
 * zero intensity when idle: changing the number of visible lights recompiles every lit
 * shader, so they are only shown or hidden when the quality preset changes.
 */
export class FxLights {
  private readonly slots: Slot[] = [];
  private enabled = true;

  constructor(scene: Scene, count = 2) {
    for (let i = 0; i < count; i++) {
      const light = new PointLight(0xffffff, 0, 9, 2);
      light.position.set(0, -50, 0);
      scene.add(light);
      this.slots.push({ light, peak: 0, life: 1, age: 1 });
    }
  }

  /** Lights follow the "Decorative point lights" quality flag. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    for (const s of this.slots) s.light.visible = on;
  }

  /** Flash a light at (x, y, z): `power` scales intensity and reach, `life` in seconds. */
  flash(x: number, y: number, z: number, color: number, power: number, life = 0.32): void {
    if (!this.enabled || this.slots.length === 0) return;
    // Reuse the slot with the least light left in it.
    let best: Slot | undefined;
    let bestLeft = Infinity;
    for (const s of this.slots) {
      const left = s.age >= s.life ? 0 : s.peak * (1 - s.age / s.life);
      if (left < bestLeft) {
        bestLeft = left;
        best = s;
      }
    }
    if (best === undefined) return;
    const peak = 14 * power;
    if (peak < bestLeft) return;
    best.peak = peak;
    best.life = Math.max(0.05, life);
    best.age = 0;
    best.light.color.setHex(color);
    best.light.distance = 5 + 4 * Math.min(2, power);
    best.light.position.set(x, Math.max(0.6, y), z);
    best.light.intensity = peak;
  }

  update(dtSec: number): void {
    for (const s of this.slots) {
      if (s.age >= s.life) {
        s.light.intensity = 0;
        continue;
      }
      s.age += dtSec;
      const k = Math.max(0, 1 - s.age / s.life);
      s.light.intensity = s.peak * k * k;
    }
  }

  clear(): void {
    for (const s of this.slots) {
      s.age = s.life;
      s.light.intensity = 0;
    }
  }

  dispose(): void {
    for (const s of this.slots) {
      s.light.removeFromParent();
      s.light.dispose();
    }
    this.slots.length = 0;
  }
}
