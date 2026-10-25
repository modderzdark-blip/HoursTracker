import type { ColorGrade } from '../render/GradePass';
import type { SynthMaterialId } from '../render/env/synthShaders';
import type { MoteLayer } from '../vfx/AmbientMotes';
import type { SigilStyle } from '../vfx/GroundSigil';
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

export type LandmarkId =
  'chained_colossus' | 'burning_gate' | 'volcano' | 'floating_spire' | 'great_crystal';

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
  /** Set dressing counts (placed around the edges, clear of the fight centre and spawns). */
  readonly dressing: {
    readonly rubble: number;
    /** Scattered skeletal remains. */
    readonly bones: number;
    readonly spires: number;
    readonly brokenColumns: number;
    readonly statues: number;
    readonly statueKind: 'knight' | 'angel' | 'mixed';
    /** Gargoyles crouched on the wall buttresses (or pillar tops). */
    readonly gargoyles: number;
    /** Gibbet cages hanging from gallows arms. */
    readonly cages: number;
    /** Chain swags along the wall tops. */
    readonly chains: number;
    readonly barricades: number;
    readonly racks: number;
    /** Banners hung on the inner wall face. */
    readonly banners: number;
    /** Flags on tall poles (outdoor arenas). */
    readonly flags: number;
    readonly skullPiles: number;
    readonly candles: number;
    readonly sarcophagi: number;
    readonly arches: number;
    readonly trees: number;
    readonly roots: number;
    readonly crystals: number;
    readonly stalactites: number;
    readonly mushrooms: number;
    readonly lavaPools: number;
    readonly puddles: number;
  };
  /** The signature piece seen from the fight (north side, beyond or at the wall). */
  readonly landmark: LandmarkId;
  /** Colours of prop materials (vertex tints; glow is a display colour boosted for bloom). */
  readonly tints: {
    readonly wood: number;
    readonly bone: number;
    readonly iron: number;
    readonly cloth: number;
    readonly trim: number;
    readonly emblem: number;
    readonly glow: number;
    readonly crystal: number;
  };
  /** Ground clutter per kind at density 1 (QualityPreset.clutterDensity scales it). */
  readonly clutter: {
    readonly pebbles: number;
    readonly shards: number;
    readonly tufts: number;
    readonly flakes: number;
    readonly tuftColor: number;
    readonly flakeColor: number;
  };
  readonly fx: {
    readonly motes: readonly MoteLayer[];
    /** Smoke columns rising beyond the wall. */
    readonly smokeColumns: number;
    readonly smoke: number;
    readonly smokeGlow: number;
    readonly fogBanks: number;
    /** Distant lightning: mean seconds between strikes and flash colour (null = none). */
    readonly lightning: { readonly every: number; readonly color: number } | null;
    readonly drips: number;
    /** A river of lava circling outside the wall. */
    readonly lavaMoat: boolean;
    readonly sigil: { readonly radius: number; readonly color: number; readonly style: SigilStyle };
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
    dressing: {
      rubble: 80,
      bones: 8,
      spires: 0,
      brokenColumns: 4,
      statues: 4,
      statueKind: 'knight',
      gargoyles: 6,
      cages: 2,
      chains: 5,
      barricades: 2,
      racks: 2,
      banners: 8,
      flags: 0,
      skullPiles: 4,
      candles: 10,
      sarcophagi: 1,
      arches: 1,
      trees: 0,
      roots: 0,
      crystals: 0,
      stalactites: 0,
      mushrooms: 0,
      lavaPools: 2,
      puddles: 0,
    },
    landmark: 'chained_colossus',
    tints: {
      wood: 0x4a3a2e,
      bone: 0xd6c8ae,
      iron: 0x403a36,
      cloth: 0x6a1410,
      trim: 0xb08a3a,
      emblem: 0x1a0d08,
      glow: 0xff6a20,
      crystal: 0xff7a30,
    },
    clutter: {
      pebbles: 900,
      shards: 300,
      tufts: 0,
      flakes: 500,
      tuftColor: 0x4a3c2a,
      flakeColor: 0x3a3430,
    },
    fx: {
      motes: [
        { kind: 'embers', color: 0xff7a2a, share: 0.65 },
        { kind: 'ash', color: 0x8a8480, share: 0.35 },
      ],
      smokeColumns: 6,
      smoke: 0x1c1614,
      smokeGlow: 0xff5a14,
      fogBanks: 4,
      lightning: { every: 14, color: 0xffc8a0 },
      drips: 0,
      lavaMoat: true,
      sigil: {
        radius: 6.5,
        color: 0xffa040,
        style: { starA: [8, 3], starB: [4, 1], spokes: 0, flower: false, runes: 1 },
      },
    },
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
    dressing: {
      rubble: 100,
      bones: 10,
      spires: 0,
      brokenColumns: 3,
      statues: 2,
      statueKind: 'angel',
      gargoyles: 4,
      cages: 3,
      chains: 4,
      barricades: 4,
      racks: 2,
      banners: 8,
      flags: 2,
      skullPiles: 5,
      candles: 4,
      sarcophagi: 0,
      arches: 1,
      trees: 3,
      roots: 3,
      crystals: 0,
      stalactites: 0,
      mushrooms: 0,
      lavaPools: 0,
      puddles: 0,
    },
    landmark: 'burning_gate',
    tints: {
      wood: 0x2e2620,
      bone: 0xc8bca6,
      iron: 0x36302e,
      cloth: 0x2a2624,
      trim: 0x8a2a18,
      emblem: 0xb03a1a,
      glow: 0xff5a14,
      crystal: 0xff6a20,
    },
    clutter: {
      pebbles: 800,
      shards: 400,
      tufts: 250,
      flakes: 900,
      tuftColor: 0x3a3228,
      flakeColor: 0x8a8682,
    },
    fx: {
      motes: [
        { kind: 'ash', color: 0xa8a4a0, share: 0.7 },
        { kind: 'embers', color: 0xff6a1a, share: 0.3 },
      ],
      smokeColumns: 6,
      smoke: 0x161212,
      smokeGlow: 0xff4a10,
      fogBanks: 5,
      lightning: { every: 9, color: 0xe0c8ff },
      drips: 0,
      lavaMoat: false,
      sigil: {
        radius: 6,
        color: 0xd8c8b0,
        style: { starA: [12, 5], starB: [0, 0], spokes: 24, flower: false, runes: 2 },
      },
    },
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
    dressing: {
      rubble: 70,
      bones: 14,
      spires: 0,
      brokenColumns: 6,
      statues: 2,
      statueKind: 'knight',
      gargoyles: 0,
      cages: 1,
      chains: 0,
      barricades: 3,
      racks: 1,
      banners: 0,
      flags: 5,
      skullPiles: 6,
      candles: 0,
      sarcophagi: 0,
      arches: 1,
      trees: 6,
      roots: 6,
      crystals: 0,
      stalactites: 0,
      mushrooms: 0,
      lavaPools: 3,
      puddles: 0,
    },
    landmark: 'volcano',
    tints: {
      wood: 0x2a2018,
      bone: 0xe0d2b8,
      iron: 0x3a3230,
      cloth: 0x5a2a14,
      trim: 0x2a1a10,
      emblem: 0xd8a050,
      glow: 0xff4a10,
      crystal: 0xff5a20,
    },
    clutter: {
      pebbles: 1200,
      shards: 150,
      tufts: 500,
      flakes: 400,
      tuftColor: 0x5a4630,
      flakeColor: 0x4a3c34,
    },
    fx: {
      motes: [
        { kind: 'embers', color: 0xff6a20, share: 0.55 },
        { kind: 'ash', color: 0x9a8a80, share: 0.45 },
      ],
      smokeColumns: 7,
      smoke: 0x2a1a14,
      smokeGlow: 0xff4010,
      fogBanks: 4,
      lightning: { every: 11, color: 0xffa070 },
      drips: 0,
      lavaMoat: false,
      sigil: {
        radius: 6.5,
        color: 0xffb060,
        style: { starA: [5, 2], starB: [3, 1], spokes: 0, flower: false, runes: 3 },
      },
    },
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
    dressing: {
      rubble: 50,
      bones: 6,
      spires: 0,
      brokenColumns: 2,
      statues: 5,
      statueKind: 'angel',
      gargoyles: 8,
      cages: 2,
      chains: 8,
      barricades: 0,
      racks: 0,
      banners: 10,
      flags: 0,
      skullPiles: 2,
      candles: 18,
      sarcophagi: 2,
      arches: 0,
      trees: 0,
      roots: 0,
      crystals: 5,
      stalactites: 0,
      mushrooms: 0,
      lavaPools: 0,
      puddles: 0,
    },
    landmark: 'floating_spire',
    tints: {
      wood: 0x2a2230,
      bone: 0xd0c8d8,
      iron: 0x34303c,
      cloth: 0x2a1048,
      trim: 0xa08ad0,
      emblem: 0xd8c8ff,
      glow: 0xa060ff,
      crystal: 0xa060ff,
    },
    clutter: {
      pebbles: 300,
      shards: 500,
      tufts: 0,
      flakes: 300,
      tuftColor: 0x302838,
      flakeColor: 0x2a2632,
    },
    fx: {
      motes: [
        { kind: 'arcane', color: 0xb080ff, share: 0.6 },
        { kind: 'spores', color: 0x7a60ff, share: 0.4 },
      ],
      smokeColumns: 0,
      smoke: 0x140e1c,
      smokeGlow: 0x8a50ff,
      fogBanks: 8,
      lightning: { every: 7, color: 0xc8a8ff },
      drips: 0,
      lavaMoat: false,
      sigil: {
        radius: 7,
        color: 0xb080ff,
        style: { starA: [7, 3], starB: [7, 2], spokes: 0, flower: false, runes: 4 },
      },
    },
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
    dressing: {
      rubble: 60,
      bones: 10,
      spires: 26,
      brokenColumns: 0,
      statues: 0,
      statueKind: 'knight',
      gargoyles: 0,
      cages: 0,
      chains: 0,
      barricades: 0,
      racks: 0,
      banners: 0,
      flags: 0,
      skullPiles: 3,
      candles: 0,
      sarcophagi: 0,
      arches: 0,
      trees: 0,
      roots: 5,
      crystals: 12,
      stalactites: 34,
      mushrooms: 14,
      lavaPools: 0,
      puddles: 9,
    },
    landmark: 'great_crystal',
    tints: {
      wood: 0x3a3428,
      bone: 0xc8c8b4,
      iron: 0x34383a,
      cloth: 0x1a2a22,
      trim: 0x5a7a6a,
      emblem: 0xa0e0c0,
      glow: 0x40ffb0,
      crystal: 0x30e0b0,
    },
    clutter: {
      pebbles: 1300,
      shards: 0,
      tufts: 300,
      flakes: 0,
      tuftColor: 0x2a4a2a,
      flakeColor: 0x202a22,
    },
    fx: {
      motes: [
        { kind: 'spores', color: 0x60ffb0, share: 0.55 },
        { kind: 'fireflies', color: 0xb0ff70, share: 0.45 },
      ],
      smokeColumns: 0,
      smoke: 0x0c1410,
      smokeGlow: 0x40ffb0,
      fogBanks: 10,
      lightning: null,
      drips: 16,
      lavaMoat: false,
      sigil: {
        radius: 6,
        color: 0x60f0c0,
        style: { starA: [6, 2], starB: [0, 0], spokes: 0, flower: true, runes: 5 },
      },
    },
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
