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

export interface ArenaDef {
  readonly id: string;
  readonly name: string;
  readonly floorRadius: number;
  /** Ring wall: segment count and dimensions. */
  readonly wall: { readonly segments: number; readonly height: number; readonly thickness: number };
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

const CINDER_COURT: ArenaDef = {
  id: 'cinder_court',
  name: 'Cinder Court',
  floorRadius: 24,
  wall: { segments: 28, height: 3.2, thickness: 1.4 },
  spawn: [0, 1.2, 6],
  spawnPoints: [
    [-17, -3],
    [17, -2],
    [-12, 14],
    [12, 14],
    [0, 19],
    [-6, -18],
    [6, -18],
    [-20, 6],
  ],
  bossSpawn: [0, -9.5],
  dummySpawn: [0, 1],
  pillars: [
    { x: -7, z: -4, radius: 0.8, height: 6 },
    { x: 7, z: -4, radius: 0.8, height: 6 },
    { x: -7, z: 8, radius: 0.8, height: 3.2 },
    { x: 7, z: 8, radius: 0.8, height: 6 },
    { x: 0, z: -13, radius: 1.1, height: 7.5 },
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
    { x: -18, z: -9, scale: 1.4 },
    { x: -11, z: -16, scale: 1.1 },
    { x: 18, z: 10, scale: 1.6 },
    { x: 9, z: 17, scale: 1.0 },
    { x: -16, z: 13, scale: 1.3 },
    { x: -5, z: 18, scale: 0.9 },
    { x: 19, z: -4, scale: 0.8 },
  ],
  braziers: [
    { x: -4.5, z: 2 },
    { x: 4.5, z: 2 },
  ],
  palette: {
    background: 0x07060a,
    fog: 0x120d12,
    fogDensity: 0.028,
    floorBase: 0x2a2526,
    stone: 0x4a4246,
    ember: 0xff7a2a,
    moonlight: 0x9fb3ff,
    hemiSky: 0x3a3550,
    hemiGround: 0x1a0f0c,
  },
  lighting: {
    moonIntensity: 2.2,
    moonDirection: [-0.45, 1, 0.35],
    hemiIntensity: 0.55,
    environmentIntensity: 0.35,
    brazierIntensity: 14,
    brazierRange: 9,
  },
};

/** A tighter ruined gatehouse: a pillar colonnade, rubble and red-tinted haze. */
const ASH_GATE: ArenaDef = {
  id: 'ash_gate',
  name: 'Gate of Soot',
  floorRadius: 21,
  wall: { segments: 26, height: 4, thickness: 1.4 },
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
    { x: -16, z: -10, scale: 1.3 },
    { x: 16, z: -11, scale: 1.1 },
    { x: -14, z: 12, scale: 1.0 },
    { x: 15, z: 12, scale: 1.4 },
    { x: -4, z: 17, scale: 0.9 },
    { x: 6, z: -17, scale: 1.0 },
  ],
  braziers: [
    { x: -5, z: -4 },
    { x: 5, z: -4 },
  ],
  palette: {
    background: 0x0a0607,
    fog: 0x1c0d0b,
    fogDensity: 0.032,
    floorBase: 0x2c2321,
    stone: 0x52423e,
    ember: 0xff6a1a,
    moonlight: 0xc8a0ff,
    hemiSky: 0x40303a,
    hemiGround: 0x220e08,
  },
  lighting: {
    moonIntensity: 1.9,
    moonDirection: [0.5, 1, 0.3],
    hemiIntensity: 0.6,
    environmentIntensity: 0.3,
    brazierIntensity: 16,
    brazierRange: 10,
  },
};

/** Open, sun-scorched wastes: broken columns, scattered boulders, red haze. */
const ASHEN_WASTES: ArenaDef = {
  id: 'ashen_wastes',
  name: 'The Smoldering Wastes',
  floorRadius: 26,
  wall: { segments: 30, height: 2.4, thickness: 1.6 },
  spawn: [0, 1.2, 9],
  spawnPoints: [
    [-19, -4],
    [19, -4],
    [-14, 15],
    [14, 15],
    [0, -21],
    [-21, 8],
    [21, 8],
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
    { x: -20, z: -12, scale: 1.8 },
    { x: 20, z: -13, scale: 1.5 },
    { x: -18, z: 18, scale: 1.4 },
    { x: 17, z: 19, scale: 1.7 },
    { x: -2, z: 22, scale: 1.2 },
    { x: 22, z: 2, scale: 1.0 },
    { x: -23, z: 1, scale: 1.1 },
    { x: 4, z: -23, scale: 1.3 },
  ],
  braziers: [
    { x: -6, z: 2 },
    { x: 6, z: 2 },
  ],
  palette: {
    background: 0x100806,
    fog: 0x2a120a,
    fogDensity: 0.024,
    floorBase: 0x2e2420,
    stone: 0x5a4438,
    ember: 0xff5a10,
    moonlight: 0xffb080,
    hemiSky: 0x5a3020,
    hemiGround: 0x1a0806,
  },
  lighting: {
    moonIntensity: 2.4,
    moonDirection: [0.6, 0.8, -0.2],
    hemiIntensity: 0.6,
    environmentIntensity: 0.3,
    brazierIntensity: 14,
    brazierRange: 9,
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
    moonIntensity: 1.9,
    moonDirection: [0.35, 1, 0.4],
    hemiIntensity: 0.6,
    environmentIntensity: 0.35,
    brazierIntensity: 12,
    brazierRange: 10,
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
