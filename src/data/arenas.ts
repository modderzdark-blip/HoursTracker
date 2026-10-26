/**
 * Arena layouts. Each entry produces both a visual and a static collider, so an arena is
 * changed (or a new one added) purely by editing this data.
 */

export interface PillarDef {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly height: number;
}

export interface BoxDef {
  /** Centre of the box. */
  readonly position: readonly [number, number, number];
  /** Full size. */
  readonly size: readonly [number, number, number];
  readonly rotationYDeg: number;
  /** Rotation around the box's local X axis (used for ramps). */
  readonly tiltXDeg?: number;
}

export interface RockDef {
  readonly x: number;
  readonly z: number;
  readonly scale: number;
}

export interface BrazierDef {
  readonly x: number;
  readonly z: number;
}

/** A point on the ground (x, z). */
export type Vec2 = readonly [number, number];

export interface ArenaDef {
  readonly id: string;
  readonly name: string;
  /**
   * Radius of the open fight circle: the outline never comes closer to the centre than this,
   * and every spawn point lies inside it.
   */
  readonly floorRadius: number;
  /** Boundary wall: segment count (round arenas) and the collider's height and thickness. */
  readonly wall: { readonly segments: number; readonly height: number; readonly thickness: number };
  /**
   * The walkable edge as a polygon (x, z), counter-clockwise or clockwise; sealed by a wall
   * collider along every edge. Absent: a round arena (a `wall.segments`-gon around floorRadius).
   */
  readonly outline?: readonly Vec2[];
  readonly spawn: readonly [number, number, number];
  /** Enemy spawn points (x, z) — kept clear of props (verified by a unit test). */
  readonly spawnPoints: readonly (readonly [number, number])[];
  readonly bossSpawn: readonly [number, number];
  readonly dummySpawn: readonly [number, number];
  readonly pillars: readonly PillarDef[];
  readonly blocks: readonly BoxDef[];
  readonly rocks: readonly RockDef[];
  readonly braziers: readonly BrazierDef[];
  readonly palette: {
    readonly background: number;
    readonly fog: number;
    readonly fogDensity: number;
    readonly floorBase: number;
    readonly stone: number;
    readonly ember: number;
    readonly moonlight: number;
    readonly hemiSky: number;
    readonly hemiGround: number;
  };
  readonly lighting: {
    readonly moonIntensity: number;
    /** Direction the moonlight comes FROM (normalised in code). */
    readonly moonDirection: readonly [number, number, number];
    readonly hemiIntensity: number;
    readonly environmentIntensity: number;
    readonly brazierIntensity: number;
    readonly brazierRange: number;
  };
}

/**
 * A castle courtyard: an octagonal yard inside fort walls, arcaded on the east and west, a
 * gatehouse with two great towers on the north side behind a stepped dais, the keep rising
 * beyond it and mountains on the horizon.
 */
const CINDER_COURT: ArenaDef = {
  id: 'cinder_court',
  name: 'Cinder Court',
  floorRadius: 22,
  wall: { segments: 28, height: 3.2, thickness: 1.4 },
  // Octagon with flat sides north / south / east / west (inradius 22).
  outline: [
    [-9.11, -22],
    [9.11, -22],
    [22, -9.11],
    [22, 9.11],
    [9.11, 22],
    [-9.11, 22],
    [-22, 9.11],
    [-22, -9.11],
  ],
  spawn: [0, 1.2, 6],
  spawnPoints: [
    [-15, -5],
    [15, -5],
    [-11, 13],
    [11, 13],
    [0, 18],
    [-7, -14],
    [7, -14],
    [-17, 4],
  ],
  bossSpawn: [0, -9.5],
  dummySpawn: [0, 1],
  pillars: [
    { x: -7, z: -4, radius: 0.8, height: 6 },
    { x: 7, z: -4, radius: 0.8, height: 6 },
    { x: -7, z: 8, radius: 0.8, height: 3.2 },
    { x: 7, z: 8, radius: 0.8, height: 6 },
    { x: -14, z: 2, radius: 0.9, height: 2.2 },
    { x: 14, z: 2, radius: 0.9, height: 6 },
  ],
  blocks: [
    // Low steps (test autostep: first two are under the step height, the third is not).
    { position: [-3, 0.12, -6], size: [2, 0.24, 2], rotationYDeg: 0 },
    { position: [-3, 0.3, -8], size: [2, 0.6, 2], rotationYDeg: 0 },
    { position: [3.5, 0.5, -7], size: [2.4, 1, 1.4], rotationYDeg: 20 },
    // 15° ramp; its raised (+Z local) end meets the platform (centre = ramp end + 2 m along it).
    { position: [11, 0.75, -12], size: [3, 0.3, 6], rotationYDeg: 35, tiltXDeg: -15 },
    { position: [13.9, 0.75, -7.9], size: [4, 1.5, 4], rotationYDeg: 35 },
    // Broken altar in the middle-north.
    { position: [0, 0.4, -4], size: [3.2, 0.8, 1.6], rotationYDeg: 0 },
  ],
  rocks: [
    { x: -16.5, z: -10.5, scale: 1.2 },
    { x: 15.5, z: 14, scale: 1.2 },
    { x: -14, z: 16, scale: 1.0 },
    { x: 19.2, z: -2, scale: 0.8 },
  ],
  braziers: [
    { x: -4.5, z: 2 },
    { x: 4.5, z: 2 },
  ],
  palette: {
    background: 0x0b0a12,
    fog: 0x1a1520,
    fogDensity: 0.017,
    floorBase: 0x2a2526,
    stone: 0x4a4246,
    ember: 0xff7a2a,
    moonlight: 0xa8bcff,
    hemiSky: 0x4a4868,
    hemiGround: 0x2a1a14,
  },
  lighting: {
    moonIntensity: 2.6,
    moonDirection: [-0.45, 1, 0.35],
    hemiIntensity: 0.8,
    environmentIntensity: 0.5,
    brazierIntensity: 22,
    brazierRange: 12,
  },
};

/**
 * A ruined gate approach: a broken colonnade along the old road up to a burning gatehouse,
 * collapsed walls and dead trees to the west, a ravine dropping away to the east.
 */
const ASH_GATE: ArenaDef = {
  id: 'ash_gate',
  name: 'Gate of Soot',
  floorRadius: 20.5,
  wall: { segments: 26, height: 4, thickness: 1.4 },
  outline: [
    [-8, -24],
    [8, -24],
    [14, -21],
    [20, -14],
    [21, -2],
    [20.5, 10],
    [18, 18],
    [8, 22],
    [-8, 22],
    [-17, 19],
    [-21.5, 8],
    [-22, -6],
    [-18, -17],
    [-13, -22],
  ],
  spawn: [0, 1.2, 8],
  spawnPoints: [
    [-15, -4],
    [15, -4],
    [-10, 13],
    [10, 13],
    [0, -16],
    [-16, 6],
    [16, 6],
  ],
  bossSpawn: [0, -8],
  dummySpawn: [0, 3],
  pillars: [
    { x: -9, z: -9, radius: 0.9, height: 7 },
    { x: 9, z: -9, radius: 0.9, height: 7 },
    { x: -11, z: 0, radius: 0.9, height: 4.5 },
    { x: 11, z: 0, radius: 0.9, height: 7 },
    { x: -9, z: 9, radius: 0.9, height: 2.6 },
    { x: 9, z: 9, radius: 0.9, height: 7 },
  ],
  blocks: [
    { position: [-4.5, 0.45, -13], size: [3.5, 0.9, 1.6], rotationYDeg: 12 },
    { position: [5, 0.6, -12.5], size: [2.6, 1.2, 2.6], rotationYDeg: -25 },
    { position: [0, 0.3, 14], size: [4, 0.6, 1.4], rotationYDeg: 0 },
  ],
  rocks: [
    { x: -16, z: -11, scale: 1.3 },
    { x: 15.5, z: -12, scale: 1.1 },
    { x: -14, z: 13, scale: 1.0 },
    { x: 15, z: 13, scale: 1.3 },
    { x: -4, z: 18, scale: 0.9 },
  ],
  braziers: [
    { x: -5, z: -4 },
    { x: 5, z: -4 },
  ],
  palette: {
    background: 0x0e0809,
    fog: 0x2a1512,
    fogDensity: 0.019,
    floorBase: 0x2c2321,
    stone: 0x52423e,
    ember: 0xff6a1a,
    moonlight: 0xd0b0ff,
    hemiSky: 0x5a4458,
    hemiGround: 0x2e1610,
  },
  lighting: {
    moonIntensity: 2.4,
    moonDirection: [0.5, 1, 0.3],
    hemiIntensity: 0.8,
    environmentIntensity: 0.45,
    brazierIntensity: 22,
    brazierRange: 12,
  },
};

/**
 * A volcanic plateau: a rim of broken rock above lava channels, terraced ledges east and west,
 * a cliff wall and a burning river to the north and the volcano on the horizon.
 */
const ASHEN_WASTES: ArenaDef = {
  id: 'ashen_wastes',
  name: 'The Smoldering Wastes',
  floorRadius: 24,
  wall: { segments: 30, height: 2.4, thickness: 1.6 },
  outline: [
    [-10, -25],
    [0, -26.5],
    [10, -25],
    [19, -19],
    [25, -8],
    [26, 4],
    [22, 15],
    [13, 23],
    [0, 25.5],
    [-13, 23],
    [-22, 15],
    [-26, 4],
    [-25, -8],
    [-19, -19],
  ],
  spawn: [0, 1.2, 9],
  spawnPoints: [
    [-19, -4],
    [19, -4],
    [-14, 15],
    [14, 15],
    [0, -21],
    [-20, 8],
    [20, 8],
    [-9, -18],
    [9, -18],
  ],
  bossSpawn: [0, -9],
  dummySpawn: [0, 4],
  pillars: [
    { x: -10, z: -6, radius: 1, height: 2.2 },
    { x: 11, z: -8, radius: 1, height: 3.4 },
    { x: -13, z: 9, radius: 0.9, height: 1.6 },
    { x: 13, z: 7, radius: 1.1, height: 4.2 },
  ],
  blocks: [
    { position: [-5, 0.35, -15], size: [4, 0.7, 2], rotationYDeg: 25 },
    { position: [6, 0.5, 16], size: [3, 1, 2.2], rotationYDeg: -15 },
  ],
  rocks: [
    { x: -20, z: -13, scale: 1.6 },
    { x: 19, z: -13.5, scale: 1.4 },
    { x: -17.2, z: 15.6, scale: 1.3 },
    { x: 17.2, z: 15.4, scale: 1.4 },
    { x: -3, z: 22.5, scale: 1.1 },
    { x: 23, z: 2, scale: 1.0 },
    { x: -23.5, z: 1, scale: 1.1 },
    { x: 4, z: -22.8, scale: 1.2 },
  ],
  braziers: [
    { x: -6, z: 2 },
    { x: 6, z: 2 },
  ],
  palette: {
    background: 0x180a06,
    fog: 0x3a1a0e,
    fogDensity: 0.016,
    floorBase: 0x2e2420,
    stone: 0x5a4438,
    ember: 0xff5a10,
    moonlight: 0xffb888,
    hemiSky: 0x6a3a26,
    hemiGround: 0x2a0e08,
  },
  lighting: {
    moonIntensity: 2.7,
    moonDirection: [0.6, 0.8, -0.2],
    hemiIntensity: 0.75,
    environmentIntensity: 0.45,
    brazierIntensity: 20,
    brazierRange: 12,
  },
};

/** The demon tower's crown: a ring of tall pillars under violet witch-light. */
const BOUND_SPIRE: ArenaDef = {
  id: 'bound_spire',
  name: 'The Bound Spire',
  floorRadius: 22,
  wall: { segments: 28, height: 5, thickness: 1.4 },
  spawn: [0, 1.2, 8],
  spawnPoints: [
    [-17, 0],
    [17, 0],
    [0, -17],
    [-11, 13],
    [11, 13],
    [-12, -12],
    [12, -12],
  ],
  bossSpawn: [0, -7],
  dummySpawn: [0, 3],
  pillars: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    return { x: Math.cos(a) * 14.5, z: Math.sin(a) * 14.5, radius: 0.85, height: 8 };
  }),
  blocks: [{ position: [0, 0.3, -15.5], size: [5, 0.6, 2], rotationYDeg: 0 }],
  rocks: [
    { x: -6, z: 18, scale: 0.9 },
    { x: 7, z: 18, scale: 1.0 },
  ],
  braziers: [
    { x: -5, z: -3 },
    { x: 5, z: -3 },
    { x: 0, z: 6 },
  ],
  palette: {
    background: 0x07050c,
    fog: 0x140c22,
    fogDensity: 0.03,
    floorBase: 0x221e2a,
    stone: 0x3e3650,
    ember: 0xb070ff,
    moonlight: 0x9080ff,
    hemiSky: 0x302850,
    hemiGround: 0x0c0814,
  },
  lighting: {
    moonIntensity: 2,
    moonDirection: [-0.3, 1, 0.5],
    hemiIntensity: 0.6,
    environmentIntensity: 0.35,
    brazierIntensity: 12,
    brazierRange: 9,
  },
};

/** A cavern under the wastes: stalagmites, glowing fungus and an open floor for big beasts. */
const HOLLOW_DEEP: ArenaDef = {
  id: 'hollow_deep',
  name: 'The Hollow Deep',
  floorRadius: 24,
  wall: { segments: 30, height: 6, thickness: 1.8 },
  spawn: [0, 1.2, 9],
  spawnPoints: [
    [-18, 2],
    [18, 2],
    [-13, 13],
    [13, 13],
    [-13, -13],
    [13, -13],
    [-7, -18],
  ],
  bossSpawn: [0, -6],
  dummySpawn: [0, 4],
  pillars: [
    { x: -15, z: -6, radius: 1.2, height: 7 },
    { x: 15, z: -6, radius: 1.2, height: 7 },
    { x: -9, z: 17, radius: 0.9, height: 4 },
    { x: 9, z: 17, radius: 0.9, height: 5.5 },
    { x: 0, z: -18, radius: 1.4, height: 9 },
  ],
  blocks: [],
  rocks: [
    { x: -19, z: -11, scale: 1.6 },
    { x: 19, z: -11, scale: 1.5 },
    { x: -20, z: 10, scale: 1.2 },
    { x: 20, z: 9, scale: 1.3 },
    { x: -4, z: 20, scale: 1.1 },
    { x: 5, z: -21, scale: 1.2 },
  ],
  braziers: [
    { x: -9, z: 0 },
    { x: 9, z: 0 },
    { x: 0, z: -15 },
  ],
  palette: {
    background: 0x040706,
    fog: 0x0a120e,
    fogDensity: 0.03,
    floorBase: 0x23271f,
    stone: 0x3c4238,
    ember: 0x8aff5a,
    moonlight: 0x8ac8a8,
    hemiSky: 0x283a32,
    hemiGround: 0x0c0a08,
  },
  lighting: {
    moonIntensity: 1.4,
    moonDirection: [0.35, 1, 0.4],
    hemiIntensity: 0.5,
    environmentIntensity: 0.35,
    brazierIntensity: 18,
    brazierRange: 12,
  },
};

export const ARENAS = {
  cinder_court: CINDER_COURT,
  ash_gate: ASH_GATE,
  ashen_wastes: ASHEN_WASTES,
  bound_spire: BOUND_SPIRE,
  hollow_deep: HOLLOW_DEEP,
} as const satisfies Record<string, ArenaDef>;

export type ArenaId = keyof typeof ARENAS;

export const ARENA_IDS = Object.keys(ARENAS) as ArenaId[];

/** One edge of an arena's outline with its outward normal. */
export interface OutlineEdge {
  readonly a: Vec2;
  readonly b: Vec2;
  readonly length: number;
  /** Unit outward normal (x, z). */
  readonly normal: Vec2;
  /** The outline turns outward-convex at a / b (wall colliders overlap there to seal it). */
  readonly convexA: boolean;
  readonly convexB: boolean;
}

/** The arena's boundary polygon (its outline, or the round arena's polygon). */
export function arenaOutline(def: ArenaDef): Vec2[] {
  if (def.outline !== undefined) return def.outline.map((p): Vec2 => [p[0], p[1]]);
  const n = def.wall.segments;
  const rc = def.floorRadius / Math.cos(Math.PI / n);
  return Array.from({ length: n }, (_, i): Vec2 => {
    const a = ((i + 0.5) / n) * Math.PI * 2;
    return [Math.cos(a) * rc, Math.sin(a) * rc];
  });
}

/** Signed area of a polygon (positive when counter-clockwise in x / z). */
function signedArea(poly: readonly Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] ?? [0, 0];
    const q = poly[(i + 1) % poly.length] ?? [0, 0];
    s += p[0] * q[1] - q[0] * p[1];
  }
  return s / 2;
}

/** The outline's edges, each with its outward normal and corner convexity. */
export function outlineEdges(def: ArenaDef): OutlineEdge[] {
  const poly = arenaOutline(def);
  const ccw = signedArea(poly) > 0;
  const n = poly.length;
  const turn = (i: number): number => {
    const p = poly[(i + n - 1) % n] ?? [0, 0];
    const c = poly[i] ?? [0, 0];
    const q = poly[(i + 1) % n] ?? [0, 0];
    return (c[0] - p[0]) * (q[1] - c[1]) - (c[1] - p[1]) * (q[0] - c[0]);
  };
  const convex = (i: number): boolean => turn(i) > 0 === ccw;
  return poly.map((a, i): OutlineEdge => {
    const b = poly[(i + 1) % n] ?? a;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const length = Math.hypot(dx, dz);
    // Counter-clockwise (signed area > 0) puts the outside on the right of travel.
    const s = ccw ? 1 : -1;
    const normal: Vec2 = [(dz / length) * s, (-dx / length) * s];
    return { a, b, length, normal, convexA: convex(i), convexB: convex((i + 1) % n) };
  });
}

/** Distance from (x, z) to the nearest outline edge. */
export function outlineDistance(def: ArenaDef, x: number, z: number): number {
  let best = Infinity;
  for (const e of outlineEdges(def)) {
    const dx = e.b[0] - e.a[0];
    const dz = e.b[1] - e.a[1];
    const t = Math.max(0, Math.min(1, ((x - e.a[0]) * dx + (z - e.a[1]) * dz) / e.length ** 2));
    best = Math.min(best, Math.hypot(x - e.a[0] - dx * t, z - e.a[1] - dz * t));
  }
  return best;
}

/** Even-odd point-in-polygon test. */
export function pointInPolygon(poly: readonly Vec2[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i] ?? [0, 0];
    const [xj, zj] = poly[j] ?? [0, 0];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** True when (x, z) is inside the outline and at least `margin` m from its edges. */
export function insideOutline(def: ArenaDef, x: number, z: number, margin = 0): boolean {
  return (
    pointInPolygon(arenaOutline(def), x, z) && (margin <= 0 || outlineDistance(def, x, z) >= margin)
  );
}

/** Farthest outline corner from the centre. */
export function outlineReach(def: ArenaDef): number {
  return Math.max(...arenaOutline(def).map(([x, z]) => Math.hypot(x, z)));
}

/** A boundary wall collider: centre (x, z), half sizes along and across the edge, yaw. */
export interface WallBox {
  readonly x: number;
  readonly z: number;
  readonly halfLength: number;
  readonly halfThickness: number;
  /** Rotation about Y turning the box's X axis along its edge. */
  readonly yaw: number;
}

/**
 * The wall colliders sealing an arena: one box standing just outside every outline edge,
 * overlapping its neighbours at outward corners.
 */
export function wallBoxes(def: ArenaDef): WallBox[] {
  const t = def.wall.thickness;
  return outlineEdges(def).map((e): WallBox => {
    const extA = e.convexA ? t / 2 : 0;
    const extB = e.convexB ? t / 2 : 0;
    const ux = (e.b[0] - e.a[0]) / e.length;
    const uz = (e.b[1] - e.a[1]) / e.length;
    const shift = (extB - extA) / 2;
    return {
      x: (e.a[0] + e.b[0]) / 2 + e.normal[0] * (t / 2) + ux * shift,
      z: (e.a[1] + e.b[1]) / 2 + e.normal[1] * (t / 2) + uz * shift,
      halfLength: e.length / 2 + (extA + extB) / 2,
      halfThickness: t / 2,
      yaw: -Math.atan2(uz, ux),
    };
  });
}
