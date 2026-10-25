import type { ColorGrade } from '../render/GradePass';
import type { SynthMaterialId } from '../render/env/synthShaders';
import type { ArenaId } from './arenas';

/** A synthesized surface: program, its three colours (main, secondary, accent), seed. */
export interface SurfaceLook {
  readonly material: SynthMaterialId;
  readonly colors: readonly [number, number, number];
  readonly seed: number;
  readonly normalStrength: number;
  /** Texture repeats per metre. */
  readonly scale: number;
  /** Gain on the program's emissive mask (lava cracks, veins, inlays, fungus); absent = none. */
  readonly glow?: number;
}

/** Floor emissive: colour, strength, and how it is dimmed around the fight centre. */
export interface FloorGlow {
  readonly color: number;
  readonly intensity: number;
  /** Fraction kept inside `inner` metres of the centre (telegraph readability). */
  readonly center: number;
  readonly inner: number;
  readonly outer: number;
}

/**
 * How an arena looks beyond its layout (src/data/arenas.ts): surface materials, the backdrop
 * outside the wall, sky, set dressing and colour grade. Pure data; ArenaBuilder and Atmosphere
 * read it.
 */
export interface ArenaLook {
  readonly floor: SurfaceLook;
  /** Second floor surface blended in patches (dirt, ash, moss). */
  readonly floorPatch: SurfaceLook;
  readonly floorGlow: FloorGlow;
  readonly wall: SurfaceLook;
  readonly rock: SurfaceLook;
  /** Dressed stone: columns, single blocks, buttresses (derived from the wall colours). */
  readonly stone?: SurfaceLook;
  /** Wall style: stacked masonry blocks, or rough rock (caves). */
  readonly wallKind: 'masonry' | 'rock';
  /** Outside the wall: cliffs ring + distant peaks. */
  readonly backdrop: { readonly cliffHeight: number; readonly peaks: boolean };
  readonly sky: {
    readonly zenith: number;
    readonly horizon: number;
    readonly moon: number;
    readonly stars: number;
    readonly clouds: number;
    readonly cloudColor: number;
    /** Caves have no sky: a dark ceiling dome instead. */
    readonly open: boolean;
  };
  readonly dressing: {
    readonly rubble: number;
    readonly bones: number;
    readonly spires: number;
    readonly brokenColumns: number;
  };
  readonly grade: ColorGrade;
  /** Ember / dust particle tint (the HUD fx keep their own colours). */
  readonly motes: number;
}

const FLAG = (colors: SurfaceLook['colors'], seed: number, glow = 0): SurfaceLook => ({
  material: 'flagstone',
  colors,
  seed,
  normalStrength: 6,
  scale: 0.125,
  glow,
});

export const ARENA_LOOKS: Readonly<Record<ArenaId, ArenaLook>> = {
  cinder_court: {
    floor: FLAG([0x625850, 0x2a1e18, 0x0c0806], 3, 1),
    floorPatch: {
      material: 'earth',
      colors: [0x3e302a, 0x2a2220, 0x0e0a08],
      seed: 5,
      normalStrength: 4,
      scale: 0.22,
      glow: 0.6,
    },
    floorGlow: { color: 0xff5010, intensity: 2.6, center: 0.25, inner: 5, outer: 13 },
    wall: {
      material: 'masonry',
      colors: [0x7a706a, 0x2a2624, 0x1c1816],
      seed: 7,
      normalStrength: 5,
      scale: 0.35,
    },
    rock: {
      material: 'rock',
      colors: [0x6a6260, 0x3a4a30, 0x111111],
      seed: 11,
      normalStrength: 6,
      scale: 0.3,
    },
    wallKind: 'masonry',
    backdrop: { cliffHeight: 16, peaks: true },
    sky: {
      zenith: 0x080c1c,
      horizon: 0x3a3048,
      moon: 0xb8c8ff,
      stars: 0.9,
      clouds: 0.45,
      cloudColor: 0x4a4458,
      open: true,
    },
    dressing: { rubble: 70, bones: 14, spires: 0, brokenColumns: 4 },
    grade: {
      shadowTint: 0x060a16,
      highlightTint: 0x160a00,
      saturation: 1.1,
      contrast: 1.08,
      vignette: 0.42,
    },
    motes: 0xff8a3d,
  },
  ash_gate: {
    floor: {
      material: 'cobble',
      colors: [0x6e625a, 0x8a827c, 0x0e0a08],
      seed: 13,
      normalStrength: 6,
      scale: 0.13,
      glow: 1,
    },
    floorPatch: {
      material: 'earth',
      colors: [0x2a2420, 0x141010, 0x080606],
      seed: 15,
      normalStrength: 3,
      scale: 0.2,
    },
    floorGlow: { color: 0xff5a14, intensity: 2.2, center: 0.3, inner: 5, outer: 12 },
    wall: {
      material: 'masonry',
      colors: [0x7a6660, 0x2a1a18, 0x1a1210],
      seed: 17,
      normalStrength: 5,
      scale: 0.35,
    },
    rock: {
      material: 'rock',
      colors: [0x6e5e5a, 0x4a2a20, 0x111111],
      seed: 19,
      normalStrength: 6,
      scale: 0.3,
    },
    wallKind: 'masonry',
    backdrop: { cliffHeight: 18, peaks: true },
    sky: {
      zenith: 0x0a0508,
      horizon: 0x2a100c,
      moon: 0xd8a8ff,
      stars: 0.5,
      clouds: 0.6,
      cloudColor: 0x3a1a18,
      open: true,
    },
    dressing: { rubble: 90, bones: 20, spires: 0, brokenColumns: 3 },
    grade: {
      shadowTint: 0x0c0610,
      highlightTint: 0x1a0800,
      saturation: 1.12,
      contrast: 1.1,
      vignette: 0.45,
    },
    motes: 0xff6a1a,
  },
  ashen_wastes: {
    floor: {
      material: 'earth',
      colors: [0x7e5c44, 0x4a3a34, 0x120604],
      seed: 21,
      normalStrength: 5,
      scale: 0.1,
      glow: 1,
    },
    floorPatch: FLAG([0x6a5a52, 0x2a1a14, 0x140c0a], 23),
    floorGlow: { color: 0xff3c08, intensity: 3.2, center: 0.35, inner: 5, outer: 14 },
    wall: {
      material: 'masonry',
      colors: [0x8a6e5c, 0x3a2418, 0x1e1410],
      seed: 25,
      normalStrength: 5,
      scale: 0.35,
    },
    rock: {
      material: 'rock',
      colors: [0x8a6a58, 0x5a3420, 0x111111],
      seed: 27,
      normalStrength: 6,
      scale: 0.25,
    },
    wallKind: 'masonry',
    backdrop: { cliffHeight: 10, peaks: true },
    sky: {
      zenith: 0x120806,
      horizon: 0x5a2410,
      moon: 0xff9050,
      stars: 0.15,
      clouds: 0.7,
      cloudColor: 0x5a2a18,
      open: true,
    },
    dressing: { rubble: 60, bones: 30, spires: 0, brokenColumns: 6 },
    grade: {
      shadowTint: 0x0a0408,
      highlightTint: 0x200c00,
      saturation: 1.15,
      contrast: 1.1,
      vignette: 0.4,
    },
    motes: 0xff6a20,
  },
  bound_spire: {
    floor: {
      material: 'marble',
      colors: [0x9c96aa, 0x2a1840, 0x3a2a56],
      seed: 31,
      normalStrength: 3,
      scale: 0.125,
      glow: 1,
    },
    floorPatch: {
      material: 'earth',
      colors: [0x2a2430, 0x18141e, 0x0a080e],
      seed: 33,
      normalStrength: 3,
      scale: 0.2,
    },
    floorGlow: { color: 0x9a5cff, intensity: 1.8, center: 0.3, inner: 6, outer: 14 },
    wall: {
      material: 'masonry',
      colors: [0x6a6278, 0x221c30, 0x14101c],
      seed: 35,
      normalStrength: 5,
      scale: 0.35,
    },
    rock: {
      material: 'rock',
      colors: [0x5e5868, 0x3a2a50, 0x111111],
      seed: 37,
      normalStrength: 6,
      scale: 0.3,
    },
    wallKind: 'masonry',
    backdrop: { cliffHeight: 6, peaks: true },
    sky: {
      zenith: 0x06040e,
      horizon: 0x1c1030,
      moon: 0xb090ff,
      stars: 1,
      clouds: 0.5,
      cloudColor: 0x2a1c48,
      open: true,
    },
    dressing: { rubble: 50, bones: 12, spires: 0, brokenColumns: 2 },
    grade: {
      shadowTint: 0x0a0616,
      highlightTint: 0x120818,
      saturation: 1.1,
      contrast: 1.1,
      vignette: 0.45,
    },
    motes: 0xb070ff,
  },
  hollow_deep: {
    floor: {
      material: 'cave',
      colors: [0x5a6058, 0x2e4a24, 0x7ae0b0],
      seed: 41,
      normalStrength: 6,
      scale: 0.12,
      glow: 1,
    },
    floorPatch: {
      material: 'earth',
      colors: [0x3a3a2a, 0x24301c, 0x0a0c08],
      seed: 43,
      normalStrength: 3,
      scale: 0.2,
    },
    floorGlow: { color: 0x40ffb0, intensity: 2.4, center: 0.4, inner: 5, outer: 12 },
    wall: {
      material: 'rock',
      colors: [0x50564c, 0x2e4228, 0x0e100c],
      seed: 45,
      normalStrength: 6,
      scale: 0.18,
    },
    rock: {
      material: 'rock',
      colors: [0x565c52, 0x3a5a30, 0x111111],
      seed: 47,
      normalStrength: 6,
      scale: 0.25,
    },
    wallKind: 'rock',
    backdrop: { cliffHeight: 22, peaks: false },
    sky: {
      zenith: 0x020403,
      horizon: 0x0a120e,
      moon: 0x8ac8a8,
      stars: 0,
      clouds: 0,
      cloudColor: 0x101810,
      open: false,
    },
    dressing: { rubble: 60, bones: 24, spires: 26, brokenColumns: 0 },
    grade: {
      shadowTint: 0x020a08,
      highlightTint: 0x0a1400,
      saturation: 1.1,
      contrast: 1.1,
      vignette: 0.48,
    },
    motes: 0x8aff5a,
  },
};
