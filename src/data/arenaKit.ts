import { mulberry32 } from '../core/random';
import type { Mass, SetPiece } from './arenaAssets';
import type { Vec2 } from './arenas';

/**
 * Composition helpers for the arena sets (src/data/arenaAssets.ts): runs of castle-kit walls
 * along a line, arcs of cliffs and backdrop terrain around the arena, stair flights and plinths.
 * Pure functions of their arguments, so the data stays deterministic.
 */

export const FORT = 'modular_fort_01';

/** Length (m, along the piece's Z axis) of the castle-kit pieces at scale 1. */
export const KIT_LENGTH = {
  wall_thin_straight_01: 14.82,
  wall_thin_straight_02: 14.82,
  wall_thin_straight_03: 7.41,
  wall_thin_straight_04: 7.41,
  wall_thick_straight_01: 14.56,
  wall_thick_straight_02: 14.56,
  wall_walkway_straight_01: 14.56,
  wall_walkway_straight_02: 14.56,
  wall_stairs_straight_01: 14.82,
  wall_thin_gate_01: 7.41,
} as const;

export type KitWall = keyof typeof KIT_LENGTH;

/** Full node name of a castle-kit piece. */
export function kit(node: string): string {
  return `${FORT}_${node}`;
}

export interface RunOptions {
  readonly scale: number;
  /** Base height (negative sinks the wall: a low ruin keeps its battlements). */
  readonly y?: number;
  /** Turn the pieces so their +X side (arcades, stairs) faces this point. */
  readonly face?: Vec2;
  readonly stretchY?: number;
  readonly tier?: 0 | 1 | 2;
  readonly far?: boolean;
  /** Lean the pieces (degrees about their own X axis): a toppling ruin. */
  readonly tilt?: number;
}

/** Castle-kit wall pieces from a to b, stretched slightly so whole pieces fill the run. */
export function wallRun(node: KitWall, a: Vec2, b: Vec2, o: RunOptions): SetPiece[] {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  const piece = KIT_LENGTH[node] * o.scale;
  const n = Math.max(1, Math.round(len / piece));
  const stretch = len / (n * piece);
  let yaw = Math.atan2(dx, dz);
  if (o.face !== undefined) {
    const mx = (a[0] + b[0]) / 2;
    const mz = (a[1] + b[1]) / 2;
    if (Math.cos(yaw) * (o.face[0] - mx) - Math.sin(yaw) * (o.face[1] - mz) < 0) yaw += Math.PI;
  }
  const out: SetPiece[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    out.push({
      model: FORT,
      node: kit(node),
      x: a[0] + dx * t,
      z: a[1] + dz * t,
      y: o.y ?? 0,
      yaw: (yaw * 180) / Math.PI,
      scale: o.scale,
      stretch: [1, o.stretchY ?? 1, stretch],
      tier: o.tier ?? 0,
      far: o.far,
      tilt: o.tilt,
    });
  }
  return out;
}

/** Walls along a polyline (open), one run per segment. */
export function wallPath(node: KitWall, points: readonly Vec2[], o: RunOptions): SetPiece[] {
  const out: SetPiece[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (a !== undefined && b !== undefined) out.push(...wallRun(node, a, b, o));
  }
  return out;
}

export interface ArcOptions {
  /** Compass degrees (0 = north, −Z; 90 = east) from / to. */
  readonly from: number;
  readonly to: number;
  readonly count: number;
  readonly radius: number;
  readonly scale: readonly [number, number];
  readonly seed: number;
  readonly node?: string;
  /** Extra yaw (degrees) on top of facing the centre, ± this much random turn. */
  readonly yaw?: number;
  readonly jitter?: number;
  readonly y?: number;
  readonly tier?: 0 | 1 | 2;
  readonly far?: boolean;
  /** Radius jitter (m). */
  readonly spread?: number;
  /** Uniform vertical stretch (taller cliffs). */
  readonly stretchY?: number;
}

/** Copies of a model along an arc around the centre, each turned to face it. */
export function arc(model: string, o: ArcOptions): SetPiece[] {
  const rand = mulberry32(o.seed);
  const out: SetPiece[] = [];
  for (let i = 0; i < o.count; i++) {
    const t = o.count === 1 ? 0.5 : i / (o.count - 1);
    const deg = o.from + (o.to - o.from) * t + (rand() - 0.5) * ((o.to - o.from) / o.count) * 0.4;
    const r = o.radius + (rand() - 0.5) * 2 * (o.spread ?? 0);
    const a = (deg * Math.PI) / 180;
    const x = Math.sin(a) * r;
    const z = -Math.cos(a) * r;
    const face = (Math.atan2(-x, -z) * 180) / Math.PI;
    const s = o.scale[0] + rand() * (o.scale[1] - o.scale[0]);
    out.push({
      model,
      node: o.node,
      x,
      z,
      y: o.y ?? 0,
      yaw: face + (o.yaw ?? 0) + (rand() - 0.5) * 2 * (o.jitter ?? 0),
      scale: s,
      stretch: o.stretchY !== undefined ? [1, o.stretchY, 1] : undefined,
      tier: o.tier ?? 0,
      far: o.far,
    });
  }
  return out;
}

/** Compass position (0 = north, −Z) at radius r. */
export function polarXZ(deg: number, r: number): Vec2 {
  const a = (deg * Math.PI) / 180;
  return [Math.sin(a) * r, -Math.cos(a) * r];
}

/**
 * A stepped dais: `tiers` nested slabs, each `rise` m higher and `inset` m smaller on every side
 * (walkable while the rise stays under the autostep height).
 */
export function dais(
  x: number,
  z: number,
  w: number,
  d: number,
  tiers: number,
  rise: number,
  inset: number,
  o: { readonly yaw?: number; readonly surface?: Mass['surface']; readonly solid?: boolean } = {},
): Mass[] {
  const out: Mass[] = [];
  for (let i = 0; i < tiers; i++) {
    const h = rise * (i + 1);
    out.push({
      x,
      z,
      size: [w - inset * 2 * i, h, d - inset * 2 * i],
      yaw: o.yaw ?? 0,
      surface: o.surface ?? 'stone',
      solid: o.solid ?? true,
    });
  }
  return out;
}
