/**
 * Test arena layout. Each entry produces both a visual and a static collider, so the arena is
 * changed purely by editing this data.
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

export const TEST_ARENA: ArenaDef = {
  id: 'test_arena',
  name: 'Cinder Court (test arena)',
  floorRadius: 24,
  wall: { segments: 28, height: 3.2, thickness: 1.4 },
  spawn: [0, 1.2, 6],
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
