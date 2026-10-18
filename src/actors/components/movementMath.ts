const TAU = Math.PI * 2;

/** Wraps an angle to (-π, π]. */
export function wrapAngle(a: number): number {
  let r = a % TAU;
  if (r <= -Math.PI) r += TAU;
  else if (r > Math.PI) r -= TAU;
  return r;
}

/** Rotates `current` toward `target` along the shortest arc by at most `maxDelta` radians. */
export function moveTowardsAngle(current: number, target: number, maxDelta: number): number {
  const diff = wrapAngle(target - current);
  if (Math.abs(diff) <= maxDelta) return wrapAngle(target);
  return wrapAngle(current + Math.sign(diff) * maxDelta);
}

export interface PlanarVelocity {
  x: number;
  z: number;
}

/**
 * Moves a planar velocity toward `target` by at most `maxDelta` (m/s) this step — constant
 * acceleration that never overshoots. Mutates and returns `v`.
 */
export function approachVelocity(
  v: PlanarVelocity,
  targetX: number,
  targetZ: number,
  maxDelta: number,
): PlanarVelocity {
  const dx = targetX - v.x;
  const dz = targetZ - v.z;
  const len = Math.hypot(dx, dz);
  if (len <= maxDelta || len === 0) {
    v.x = targetX;
    v.z = targetZ;
  } else {
    const k = maxDelta / len;
    v.x += dx * k;
    v.z += dz * k;
  }
  return v;
}

/** Linear interpolation between angles along the shortest arc. */
export function lerpAngle(a: number, b: number, t: number): number {
  return wrapAngle(a + wrapAngle(b - a) * t);
}
