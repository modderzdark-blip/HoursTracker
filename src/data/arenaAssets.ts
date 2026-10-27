import type { AssetRequest } from '../render/env/AssetLibrary';
import { GRAVEWOOD_ASSETS } from './sets/gravewood';
import { WIDOWS_PASS_ASSETS } from './sets/widowsPass';
import { DROWNED_CLOISTER_ASSETS } from './sets/drownedCloister';
import { HOLLOW_DEEP_ASSETS } from './sets/hollowDeep';
import { BOUND_SPIRE_ASSETS } from './sets/boundSpire';
import { ASHEN_WASTES_ASSETS } from './sets/ashenWastes';
import { ASH_GATE_ASSETS } from './sets/ashGate';
import { CINDER_COURT_ASSETS } from './sets/cinderCourt';
import type { DressingPart } from '../modes/arenaDressing';
import type { SmokeCard } from '../vfx/SmokeCards';
import { ARENA_IDS, ARENA_SCALE, type ArenaId, type Vec2 } from './arenas';
import { scaleArenaAssets } from './arenaScale';

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

export type StructureSurface = 'stone' | 'rock' | 'wall';

/**
 * Procedural architecture (src/modes/structures.ts) in the arena's scanned surfaces, placed at
 * (x, z) turned by `yaw`; all sizes are metres before `scale`.
 */
export interface Structure {
  readonly kind:
    'arcade' | 'ruinWall' | 'obelisk' | 'stones' | 'ribs' | 'stalagmites' | 'tombs' | 'shrine';
  readonly x: number;
  readonly z: number;
  readonly y?: number;
  readonly yaw?: number;
  readonly scale?: number;
  /** Arches / bays / stones / ribs / stalagmites / graves per row. */
  readonly count?: number;
  /** Rows (graveyards). */
  readonly rows?: number;
  /** Length of a run, radius of a ring or field, width of a shrine. */
  readonly length?: number;
  readonly height?: number;
  /** 0 = whole, 1 = mostly fallen. */
  readonly ruined?: number;
  /** Gothic pointed arches (arcades). */
  readonly pointed?: boolean;
  /** An altar in the middle (stone circles, shrines). */
  readonly altar?: boolean;
  readonly surface?: StructureSurface;
  /** Default true: colliders on the footprints. */
  readonly solid?: boolean;
  readonly seed?: number;
  /** Lowest quality showing it (as for set pieces). */
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
  /** Procedural architecture: each arena's own arcades, ruins, monuments and bones. */
  readonly structures?: readonly Structure[];
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

/** As authored (see ARENA_SCALE). */
const AUTHORED_ASSETS: Readonly<Record<ArenaId, ArenaAssets>> = {
  cinder_court: CINDER_COURT_ASSETS,
  ash_gate: ASH_GATE_ASSETS,
  ashen_wastes: ASHEN_WASTES_ASSETS,
  bound_spire: BOUND_SPIRE_ASSETS,
  hollow_deep: HOLLOW_DEEP_ASSETS,
  gravewood: GRAVEWOOD_ASSETS,
  widows_pass: WIDOWS_PASS_ASSETS,
  drowned_cloister: DROWNED_CLOISTER_ASSETS,
};

export const ARENA_ASSETS: Readonly<Record<ArenaId, ArenaAssets>> = Object.fromEntries(
  ARENA_IDS.map((id) => [id, scaleArenaAssets(AUTHORED_ASSETS[id], ARENA_SCALE[id])]),
) as Record<ArenaId, ArenaAssets>;

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
