import type { AssetRequest } from '../render/env/AssetLibrary';
import { ASHEN_WASTES_ASSETS } from './sets/ashenWastes';
import { ASH_GATE_ASSETS } from './sets/ashGate';
import { CINDER_COURT_ASSETS } from './sets/cinderCourt';
import type { DressingPart } from '../modes/arenaDressing';
import type { SmokeCard } from '../vfx/SmokeCards';
import type { ArenaId, Vec2 } from './arenas';

/**
 * Scanned CC0 assets (Poly Haven, see public/assets/CREDITS.md) dressing each arena: the PBR
 * surfaces for floor / walls / rock / dressed stone and the props placed around the fight. Pure
 * data; ArenaBuilder places it. Angles are compass degrees from the arena centre: 0 = north
 * (−Z, the far side the camera looks at), 90 = east (+X). Radii are fractions of the floor
 * radius unless `metres` is set.
 */

export interface SurfaceRef {
  readonly id: string;
  /** Real size of one texture tile (m). */
  readonly size: number;
  readonly tint?: number;
}

export interface PropPlacement {
  readonly model: string;
  /** One node of the model (a wall piece of a kit, one rock of a set); default: all of it. */
  readonly node?: string;
  readonly deg: number;
  readonly r: number;
  /** `r` in metres instead of a fraction of the floor radius. */
  readonly metres?: boolean;
  readonly scale?: number;
  /** Yaw in degrees relative to facing the centre (0 = faces the centre). */
  readonly yaw?: number;
  /** Lean (degrees) about the prop's own X axis (swords stuck in the ground, shields). */
  readonly tilt?: number;
  readonly sink?: number;
  /** Solid: a cylinder collider sized from the prop's footprint. */
  readonly solid?: boolean;
  /** Fire on top of it at this height (m, after scaling). */
  readonly fire?: number;
  /** Lowest quality showing it (as for set pieces). */
  readonly tier?: 0 | 1 | 2;
}

/** Scattered copies of a prop near the wall: deterministic per arena. */
export interface PropScatter {
  readonly model: string;
  readonly node?: string;
  readonly count: number;
  /** Radius band (fractions of the floor radius). */
  readonly band: readonly [number, number];
  readonly scale: readonly [number, number];
  readonly solid?: boolean;
  readonly tilt?: number;
  readonly sink?: number;
  /** The model is a set (rocks, branches): scatter its pieces one by one. */
  readonly pick?: boolean;
}

/**
 * A scanned model (or one node of it) placed in world space: the composed architecture, cliffs,
 * backdrop terrain and landmarks of an arena.
 */
export interface SetPiece {
  readonly model: string;
  readonly node?: string;
  readonly x: number;
  readonly z: number;
  /** Height of the piece's base above the floor (negative sinks it). */
  readonly y?: number;
  /** Yaw in degrees (counter-clockwise seen from above; 0 = as modelled). */
  readonly yaw?: number;
  readonly scale?: number;
  /** Non-uniform stretch (x, y, z) on top of `scale`. */
  readonly stretch?: readonly [number, number, number];
  /** Pitch / roll in degrees (fallen columns, leaning ruins). */
  readonly tilt?: number;
  readonly roll?: number;
  /** Collider: a cylinder or an oriented box from the piece's footprint. */
  readonly solid?: 'round' | 'box';
  /** Fire burning at this height above the floor. */
  readonly fire?: number;
  /** Lowest quality showing it: 0 = always (key set piece), 1 = Medium and up, 2 = High. */
  readonly tier?: 0 | 1 | 2;
  /** Highest quality showing it (a cheaper stand-in for Low). */
  readonly upTo?: 0 | 1 | 2;
  /** Backdrop: casts no shadow. */
  readonly far?: boolean;
}

/**
 * Built stone: terraces, daises, ledges, plinths, stair flights and slabs, textured with the
 * arena's scanned surfaces (merged into one mesh per surface).
 */
export interface Mass {
  readonly x: number;
  readonly z: number;
  /** Full size (x, y, z) before yaw. */
  readonly size: readonly [number, number, number];
  readonly y?: number;
  readonly yaw?: number;
  readonly tilt?: number;
  readonly roll?: number;
  readonly surface?: 'stone' | 'rock' | 'wall';
  /** Blocks movement (a flight's steps stay walkable while each rise is low enough). */
  readonly solid?: boolean;
  /** A stair flight of this many steps, rising toward local −Z. */
  readonly steps?: number;
  readonly tier?: 0 | 1 | 2;
}

/** A banner hanging on a wall face: top centre, facing yaw (degrees), cloth size. */
export interface BannerHang {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly w: number;
  readonly h: number;
}

/** A lava channel along a polyline (x, z), `width` m across. */
export interface LavaChannel {
  readonly points: readonly Vec2[];
  readonly width: number;
}

export interface ArenaAssets {
  readonly floor: SurfaceRef;
  readonly floorPatch: SurfaceRef;
  readonly wall: SurfaceRef;
  readonly rock: SurfaceRef;
  readonly stone: SurfaceRef;
  /** Model placed at each brazier spot (fire on top). */
  readonly brazier?: { readonly model: string; readonly scale: number; readonly fire: number };
  /** Model (or set, picked piece by piece) standing in for the arena's rock outcrops. */
  readonly boulders?: { readonly model: string; readonly pick?: boolean };
  /** Small dressing at compass positions near the edge. */
  readonly props: readonly PropPlacement[];
  readonly scatter: readonly PropScatter[];
  /** The composed place: architecture, cliffs, landmark and backdrop in world space. */
  readonly pieces?: readonly SetPiece[];
  readonly masses?: readonly Mass[];
  readonly banners?: readonly BannerHang[];
  readonly lava?: readonly LavaChannel[];
  /** Still water (x, z, radius). */
  readonly pools?: readonly (readonly [number, number, number])[];
  /** The ground's extent (polygon); absent = a disc well past the walls. */
  readonly ground?: readonly Vec2[];
  /** The pieces form the boundary walls: no procedural wall ring. */
  readonly ownWalls?: boolean;
  /** The pieces form the backdrop: no procedural cliff ring. */
  readonly ownBackdrop?: boolean;
  /** Procedural dressing the composition replaces (besides what scanned props always replace). */
  readonly skip?: readonly DressingPart[];
  /** Procedural dressing kept although scanned props usually replace it (dead trees). */
  readonly keep?: readonly DressingPart[];
  /** Extra smoke (0) or mist (1) cards: chasms, fire, the far side of the walls. */
  readonly mist?: readonly SmokeCard[];
}

/** Props framing the north gate: a pair of statues, candles, a chest, banners of war. */
function gateGroup(statueScale: number): PropPlacement[] {
  return [
    { model: 'gothic_statue', deg: -14, r: 0.84, scale: statueScale, solid: true },
    { model: 'gothic_statue', deg: 14, r: 0.84, scale: statueScale, solid: true },
    { model: 'brass_candleholders', deg: -20, r: 0.86, scale: 1.4 },
    { model: 'brass_candleholders', deg: 20, r: 0.86, scale: 1.4, yaw: 180 },
  ];
}

export const ARENA_ASSETS: Readonly<Record<ArenaId, ArenaAssets>> = {
  cinder_court: CINDER_COURT_ASSETS,
  ash_gate: ASH_GATE_ASSETS,
  ashen_wastes: ASHEN_WASTES_ASSETS,
  bound_spire: {
    floor: { id: 'patterned_slate_tiles', size: 2.2 },
    floorPatch: { id: 'marble_mosaic_tiles', size: 2 },
    wall: { id: 'stone_wall_04', size: 1.7 },
    rock: { id: 'rock_wall_08', size: 1.8 },
    stone: { id: 'slate_floor', size: 2.3 },
    brazier: { model: 'stone_fire_pit', scale: 1.1, fire: 0.38 },
    boulders: { model: 'rock_09' },
    props: [
      ...gateGroup(2.3),
      { model: 'large_castle_door', deg: 0, r: 0.995, scale: 1.5 },
      { model: 'gothic_statue', deg: 72, r: 0.86, scale: 2.1, solid: true },
      { model: 'gothic_statue', deg: 288, r: 0.86, scale: 2.1, solid: true },
      { model: 'gothic_statue', deg: 144, r: 0.86, scale: 2, solid: true },
      { model: 'gothic_statue', deg: 216, r: 0.86, scale: 2, solid: true },
      { model: 'treasure_chest', deg: 36, r: 0.88, scale: 1.3, yaw: -10 },
      { model: 'treasure_chest', deg: 324, r: 0.88, scale: 1.3, yaw: 10 },
      { model: 'lantern_chandelier_01', deg: 108, r: 0.95, scale: 1.8, sink: -3.4 },
      { model: 'lantern_chandelier_01', deg: 252, r: 0.95, scale: 1.8, sink: -3.4 },
      { model: 'marble_bust_01', deg: 50, r: 0.9, scale: 2.6 },
      { model: 'marble_bust_01', deg: 310, r: 0.9, scale: 2.6 },
    ],
    scatter: [
      { model: 'wooden_candlestick', count: 18, band: [0.82, 0.95], scale: [2.2, 3] },
      { model: 'brass_candleholders', count: 4, band: [0.88, 0.95], scale: [1.3, 1.5] },
    ],
  },
  hollow_deep: {
    // Wet cave rock, darker and cooler than the scan's daylight colour.
    floor: { id: 'mossy_rock', size: 3, tint: 0x6f7c74 },
    floorPatch: { id: 'brown_mud_rocks_01', size: 1.3, tint: 0x8a8278 },
    wall: { id: 'rock_wall_08', size: 1.8 },
    rock: { id: 'mossy_rock', size: 3 },
    stone: { id: 'rock_wall_08', size: 1.8 },
    brazier: { model: 'stone_fire_pit', scale: 1, fire: 0.35 },
    boulders: { model: 'rock_moss_set_02', pick: true },
    props: [
      { model: 'root_cluster_01', deg: -30, r: 0.88, scale: 1.8, yaw: 10 },
      { model: 'root_cluster_01', deg: 120, r: 0.88, scale: 1.6, yaw: 60 },
      { model: 'root_cluster_01', deg: 230, r: 0.88, scale: 1.7, yaw: -40 },
      { model: 'pine_roots', deg: 30, r: 0.86, scale: 2 },
      { model: 'pine_roots', deg: 300, r: 0.86, scale: 1.8, yaw: 90 },
      { model: 'rock_face_01', deg: 0, r: 1, scale: 1.4, solid: true },
      { model: 'rock_face_02', deg: 80, r: 0.97, scale: 1.6, solid: true },
      { model: 'rock_face_02', deg: 180, r: 0.97, scale: 1.5, yaw: 140, solid: true },
      { model: 'rock_face_02', deg: 270, r: 0.97, scale: 1.6, yaw: 220, solid: true },
      { model: 'treasure_chest', deg: 160, r: 0.86, scale: 1.3, yaw: 30 },
      { model: 'wooden_crate_01', deg: 168, r: 0.9, scale: 1.4, yaw: -20 },
      { model: 'tree_stump_02', deg: 200, r: 0.86, scale: 1.4, solid: true },
    ],
    scatter: [
      {
        model: 'rock_moss_set_01',
        pick: true,
        count: 6,
        band: [0.8, 0.96],
        scale: [0.9, 1.3],
        solid: true,
      },
      {
        model: 'rock_moss_set_02',
        pick: true,
        count: 6,
        band: [0.8, 0.96],
        scale: [0.9, 1.3],
        solid: true,
      },
      { model: 'wooden_lantern_01', count: 6, band: [0.84, 0.95], scale: [1.6, 1.9] },
      {
        model: 'dry_branches_medium_01',
        pick: true,
        count: 5,
        band: [0.72, 0.94],
        scale: [1.2, 1.5],
      },
    ],
  },
};

/** Everything an arena needs loaded before it is built. */
export function arenaAssetRequest(id: ArenaId): AssetRequest {
  const a = ARENA_ASSETS[id];
  const surfaces = new Set([a.floor.id, a.floorPatch.id, a.wall.id, a.rock.id, a.stone.id]);
  const models = new Set<string>();
  for (const p of a.props) models.add(p.model);
  for (const s of a.scatter) models.add(s.model);
  if (a.brazier !== undefined) models.add(a.brazier.model);
  if (a.boulders !== undefined) models.add(a.boulders.model);
  for (const p of a.pieces ?? []) models.add(p.model);
  return { surfaces: [...surfaces], models: [...models] };
}
