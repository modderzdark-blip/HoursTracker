import type { HitShape } from '../data/combatTypes';

/** Radius of a circle (centred on the shape's query centre) that contains the whole shape. */
export function shapeBoundingRadius(shape: HitShape): number {
  switch (shape.kind) {
    case 'arc':
      return shape.range;
    case 'circle':
      return shape.radius;
    case 'box':
      return Math.hypot(shape.length / 2, shape.width / 2);
  }
}

/** Forward offset of the query centre from the attacker for each shape. */
export function shapeCenterForward(shape: HitShape): number {
  switch (shape.kind) {
    case 'arc':
      return 0;
    case 'circle':
      return shape.forward;
    case 'box':
      return shape.forward + shape.length / 2;
  }
}

/**
 * Precise test: does a target circle (tx, tz, targetRadius) overlap the hit shape of an attacker
 * at (ox, oz) facing `yaw` (forward = (sin yaw, cos yaw))?
 */
export function targetInShape(
  shape: HitShape,
  ox: number,
  oz: number,
  yaw: number,
  tx: number,
  tz: number,
  targetRadius: number,
): boolean {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const dx = tx - ox;
  const dz = tz - oz;
  switch (shape.kind) {
    case 'arc': {
      const dist = Math.hypot(dx, dz);
      if (dist > shape.range + targetRadius) return false;
      if (dist <= targetRadius) return true;
      const cos = (dx * fx + dz * fz) / dist;
      const angle = Math.acos(Math.min(1, Math.max(-1, cos)));
      // Allow the target's own width at its distance.
      const allowance = Math.asin(Math.min(1, targetRadius / dist));
      return angle <= (shape.angleDeg * Math.PI) / 360 + allowance;
    }
    case 'circle': {
      const cx = ox + fx * shape.forward;
      const cz = oz + fz * shape.forward;
      return Math.hypot(tx - cx, tz - cz) <= shape.radius + targetRadius;
    }
    case 'box': {
      const along = dx * fx + dz * fz;
      // Right vector = (cos yaw, -sin yaw).
      const side = dx * fz - dz * fx;
      return (
        along >= shape.forward - targetRadius &&
        along <= shape.forward + shape.length + targetRadius &&
        Math.abs(side) <= shape.width / 2 + targetRadius
      );
    }
  }
}
