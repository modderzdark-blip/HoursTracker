import { Vector3, type BufferGeometry } from 'three';
import type { Surf, WeightFn } from '../meshKit';

export const S = {
  chitin: (color: number): Surf => ({ color, rough: 0.32, metal: 0.25 }),
  hide: (color: number): Surf => ({ color, rough: 0.7, metal: 0.02 }),
  horn: (color: number): Surf => ({ color, rough: 0.45, metal: 0.1 }),
  glow: (color: number): Surf => ({ color, rough: 1, metal: 0 }),
};

export const easeIn = (t: number): number => t * t;
export const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
export const smooth = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};
/** 0 → 1 → 0 bump over [a, b] of t. */
export const bump = (t: number, a: number, b: number): number => {
  if (t <= a || t >= b) return 0;
  return Math.sin(((t - a) / (b - a)) * Math.PI);
};

export function rigidW(i: number): WeightFn {
  return (_p, out) => {
    out.push([i, 1]);
  };
}

/** Weights along a chain of bones at the given bind positions (closest segment, blended). */
export function polylineW(bones: readonly number[], points: readonly Vector3[]): WeightFn {
  const ab = new Vector3();
  const ap = new Vector3();
  return (p, out) => {
    let best = Infinity;
    let bi = 0;
    let bu = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      if (a === undefined || b === undefined) continue;
      ab.subVectors(b, a);
      ap.subVectors(p, a);
      const len2 = ab.lengthSq() || 1;
      const u = Math.min(1, Math.max(0, ap.dot(ab) / len2));
      const d = ap.addScaledVector(ab, -u).lengthSq();
      if (d < best) {
        best = d;
        bi = i;
        bu = u;
      }
    }
    const a = bones[bi] ?? 0;
    const b = bones[bi + 1] ?? a;
    out.push([a, 1 - bu], [b, bu]);
  };
}

export function darken(hex: number, k: number): number {
  const r = Math.round(((hex >> 16) & 255) * k);
  const g = Math.round(((hex >> 8) & 255) * k);
  const b = Math.round((hex & 255) * k);
  return (Math.min(255, r) << 16) | (Math.min(255, g) << 8) | Math.min(255, b);
}

/** Scales a geometry in place about a point (bigger heads without re-tuning every offset). */
export function scaleAbout(g: BufferGeometry, c: Vector3, s: number): BufferGeometry {
  g.translate(-c.x, -c.y, -c.z);
  g.scale(s, s, s);
  g.translate(c.x, c.y, c.z);
  return g;
}
