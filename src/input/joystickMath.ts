export interface StickVector {
  x: number;
  y: number;
  /** Shaped magnitude 0..1 (after dead zone and response curve). */
  magnitude: number;
}

/**
 * Converts a raw stick offset into a shaped analog vector.
 * - Offsets are divided by `radius` and clamped to the unit circle.
 * - Magnitudes inside `deadZone` read as zero; the rest is rescaled to 0..1 so there is no jump
 *   at the dead-zone edge.
 * - `exponent` > 1 gives finer control near the centre.
 * Writes into `out` (no allocation) and returns it.
 */
export function shapeStick(
  dx: number,
  dy: number,
  radius: number,
  deadZone: number,
  exponent: number,
  out: StickVector,
): StickVector {
  const len = Math.hypot(dx, dy);
  const raw = radius > 0 ? Math.min(len / radius, 1) : 0;
  if (len === 0 || raw <= deadZone) {
    out.x = 0;
    out.y = 0;
    out.magnitude = 0;
    return out;
  }
  const rescaled = (raw - deadZone) / (1 - deadZone);
  const shaped = Math.pow(Math.min(Math.max(rescaled, 0), 1), exponent);
  out.x = (dx / len) * shaped;
  out.y = (dy / len) * shaped;
  out.magnitude = shaped;
  return out;
}

/**
 * When the thumb drags past the radius, move the stick origin toward the thumb so the offset
 * stays exactly `radius` long. Returns the new origin in `out` (index 0 = x, 1 = y).
 */
export function followOrigin(
  originX: number,
  originY: number,
  thumbX: number,
  thumbY: number,
  radius: number,
  out: Float64Array,
): Float64Array {
  const dx = thumbX - originX;
  const dy = thumbY - originY;
  const len = Math.hypot(dx, dy);
  if (len <= radius || len === 0) {
    out[0] = originX;
    out[1] = originY;
    return out;
  }
  const excess = (len - radius) / len;
  out[0] = originX + dx * excess;
  out[1] = originY + dy * excess;
  return out;
}
