import type { ArenaAssets, SetPiece } from '../arenaAssets';
import { arc, FORT, kit, wallRun } from '../arenaKit';
import type { Vec2 } from '../arenas';

/**
 * Gate of Soot: the old road climbs between a broken colonnade to a gatehouse whose passage is
 * on fire. One tower still stands; the other leans over a rubble slope. Collapsed curtain walls
 * and dead trees line the west; to the east the ground ends at a ravine, a low parapet on its
 * lip and cliffs across the drop.
 */

const C: Vec2 = [0, 0];
const TOWER = kit('tower_round');

const deadTree = (x: number, z: number, scale: number, yaw: number, lean = 0): SetPiece => ({
  model: 'dead_quiver_trunk',
  x,
  z,
  scale,
  yaw,
  tilt: lean,
  y: -0.1,
});

export const ASH_GATE_ASSETS: ArenaAssets = {
  // The old processional road west of the gate: a broken colonnade of round arches; a chapel
  // ruin and two obelisks on the ridge north of the gatehouse.
  structures: [
    {
      kind: 'arcade',
      x: -33,
      z: 0,
      yaw: 90,
      length: 34,
      count: 7,
      height: 6,
      ruined: 0.5,
      seed: 11,
      solid: false,
    },
    {
      kind: 'ruinWall',
      x: -27,
      z: -33,
      yaw: 35,
      length: 16,
      count: 4,
      height: 9,
      ruined: 0.45,
      surface: 'wall',
      seed: 12,
      solid: false,
    },
    { kind: 'obelisk', x: -15, z: -37, height: 11, seed: 13, solid: false },
    { kind: 'obelisk', x: 15, z: -38, height: 11, seed: 14, solid: false, tier: 1 },
  ],
  floor: { id: 'volcanic_rock_tiles', size: 1.8 },
  floorPatch: { id: 'brown_mud_rocks_01', size: 1.3 },
  wall: { id: 'cobblestone_square', size: 1.6 },
  rock: { id: 'rock_wall_13', size: 2 },
  stone: { id: 'castle_wall_varriation', size: 2 },
  brazier: { model: 'stone_fire_pit', scale: 1.1, fire: 0.38 },
  boulders: { model: 'rock_07' },
  ownWalls: true,
  ownBackdrop: true,
  skip: ['landmark', 'arches', 'chains', 'gargoyles', 'banners'],
  keep: ['trees'],
  // Mist welling up out of the ravine; smoke from the burning gate.
  mist: [
    { x: 30, y: -2, z: -14, w: 14, h: 8, kind: 1, alpha: 0.5 },
    { x: 31, y: -2, z: 2, w: 16, h: 8, kind: 1, alpha: 0.55 },
    { x: 29, y: -2, z: 18, w: 14, h: 8, kind: 1, alpha: 0.5 },
    { x: 38, y: -4, z: 6, w: 22, h: 12, kind: 1, alpha: 0.45 },
    { x: 0, y: 1, z: -28, w: 7, h: 22, kind: 0, alpha: 0.55 },
  ],
  // The ground stops at the ravine lip in the east.
  ground: [
    [-80, -80],
    [24, -80],
    [24, 70],
    [-80, 70],
  ],
  pieces: [
    // The gatehouse: a burning passage, the portcullis half raised, one tower standing and one
    // leaning over the rubble of its own fall.
    ...wallRun('wall_thin_gate_01', [-4.26, -25.55], [4.26, -25.55], { scale: 1.15 }),
    {
      model: FORT,
      node: TOWER,
      x: -8.7,
      z: -26.4,
      scale: 0.55,
      stretch: [1, 1.35, 1],
      solid: 'round',
    },
    {
      model: FORT,
      node: TOWER,
      x: 9.3,
      z: -27.4,
      y: -3.5,
      scale: 0.55,
      stretch: [1, 1.2, 1],
      roll: -7,
      tilt: 4,
    },
    { model: 'large_iron_gate', x: 0, z: -24.6, y: 3.1, scale: 1.3 },
    { model: 'stone_fire_pit', x: 0, z: -26.2, scale: 1.7, fire: 0.6 },
    { model: 'caged_hanging_light', x: -3, z: -23.6, y: 4.9, scale: 1.4, fire: 5.05 },
    // Curtain walls: broken down to stubs toward the ravine, collapsed along the west.
    ...wallRun('wall_thin_straight_01', [8, -24], [14, -21], {
      scale: 0.62,
      out: 0.8,
      y: -1.2,
      face: C,
    }),
    ...wallRun('wall_thin_straight_01', [14, -21], [20, -14], {
      scale: 0.62,
      out: 0.8,
      y: -2.8,
      face: C,
    }),
    ...wallRun('wall_thin_straight_02', [-8, -24], [-13, -22], { scale: 0.62, out: 0.8, face: C }),
    ...wallRun('wall_thin_straight_02', [-13, -22], [-18, -17], {
      scale: 0.62,
      out: 0.8,
      y: -1.6,
      face: C,
    }),
    ...wallRun('wall_thin_straight_01', [-18, -17], [-22, -6], {
      scale: 0.62,
      out: 0.8,
      y: -3.6,
      face: C,
      tilt: 4,
    }),
    ...wallRun('wall_thin_straight_02', [-22, -6], [-21.5, 8], {
      scale: 0.62,
      out: 0.8,
      y: -1.4,
      face: C,
    }),
    ...wallRun('wall_thin_straight_01', [-21.5, 8], [-17, 19], {
      scale: 0.62,
      out: 0.8,
      y: -4,
      face: C,
    }),
    // The road out to the south between two wall stubs.
    {
      model: FORT,
      node: kit('wall_thick_end_01'),
      x: -10.5,
      z: 23.4,
      y: -4.2,
      scale: 0.62,
      yaw: 90,
    },
    {
      model: FORT,
      node: kit('wall_thick_end_01'),
      x: 10.5,
      z: 23.4,
      y: -4.2,
      scale: 0.62,
      yaw: -90,
    },
    // The ravine: a low parapet on the lip, rock dropping away below it.
    ...wallRun('wall_thin_straight_01', [20, -14], [21, -2], {
      scale: 0.5,
      out: 0.65,
      y: -3.3,
      face: C,
    }),
    ...wallRun('wall_thin_straight_01', [21, -2], [20.5, 10], {
      scale: 0.5,
      out: 0.65,
      y: -3.3,
      face: C,
    }),
    ...wallRun('wall_thin_straight_01', [20.5, 10], [18, 18], {
      scale: 0.5,
      out: 0.65,
      y: -3.3,
      face: C,
    }),
    ...[
      [25.5, -16, -6.8, 90],
      [25.5, 2, -6.9, 95],
      [24.5, 20, -6.8, 80],
    ].flatMap(([x = 0, z = 0, y = 0, yaw = 0]): SetPiece[] => [
      { model: 'namaqualand_cliff_02', x, z, y, yaw, tier: 1 },
      { model: 'namaqualand_cliff_02_far', x, z, y, yaw, upTo: 0 },
    ]),
    // Across the ravine: cliffs and mountains.
    ...arc('mountainside_far', {
      from: -70,
      to: 110,
      count: 7,
      radius: 66,
      scale: [3.8, 4.8],
      seed: 11,
      y: -16,
      jitter: 30,
      spread: 5,
      far: true,
    }),
    // Dead trees: a thin wood to the west and along the road.
    deadTree(-25.5, -4, 3.4, 20, 6),
    { ...deadTree(-26.5, 9, 3, 140, -4), tier: 1 },
    deadTree(-23.5, -19, 3.6, 75, 3),
    { ...deadTree(-19, 24, 3.1, 200, 5), tier: 1 },
    deadTree(23, 27, 3.3, 30, -6),
    { ...deadTree(-30, 18, 3.8, 300, 0), tier: 1 },
    { model: 'dead_tree_trunk_02', x: -19.4, z: 13.6, scale: 1.6, yaw: -68, solid: 'box' },
    { model: 'dead_tree_trunk', x: 12.6, z: -18.2, scale: 1.5, yaw: -30, tier: 1 },
    { model: 'pine_roots', x: -18.6, z: -10.4, scale: 1.7, tier: 1 },
    { model: 'tree_stump_01', x: -16.4, z: 15.8, scale: 1.5, solid: 'round' },
    // Rubble slope under the leaning tower.
    {
      model: 'namaqualand_boulders_01',
      x: 11.5,
      z: -21.4,
      scale: 4.2,
      yaw: 30,
      solid: 'round',
    },
  ],
  masses: [
    // Rubble ramps fallen from the walls.
    { x: 12.4, z: -23.2, size: [6, 2.2, 3.4], yaw: -28, tilt: 18, y: -0.9, surface: 'rock' },
    { x: -19.6, z: -12.8, size: [5, 1.8, 3], yaw: 70, tilt: 16, y: -0.8, surface: 'rock' },
    { x: -20, z: 13, size: [4.4, 1.6, 2.6], yaw: 110, tilt: 14, y: -0.7, surface: 'rock' },
    // The gate's threshold.
    { x: 0, z: -24.6, size: [9.5, 0.3, 2], surface: 'stone' },
  ],
  banners: [{ x: -8.7, y: 9.2, z: -22, yaw: 0, w: 1.6, h: 3.8 }],
  props: [
    { model: 'worn_metal_rack', deg: -40, r: 0.9, scale: 1.2, tier: 1 },
    { model: 'wooden_crate_01', deg: 38, r: 0.86, scale: 1.4, yaw: 15, tier: 1 },
    { model: 'wooden_crate_01', deg: 42, r: 0.82, scale: 1.4, yaw: -40, tier: 1 },
    { model: 'wine_barrel_01', deg: 300, r: 0.86, scale: 1.3, solid: true, tier: 1 },
    { model: 'tree_stump_02', deg: 200, r: 0.9, scale: 1.3, solid: true, tier: 1 },
  ],
  scatter: [
    {
      model: 'dry_branches_medium_01',
      pick: true,
      count: 8,
      band: [0.7, 0.95],
      scale: [1.2, 1.6],
    },
    {
      model: 'antique_estoc',
      count: 5,
      band: [0.6, 0.9],
      scale: [1.1, 1.3],
      tilt: 16,
      sink: 0.35,
    },
    {
      model: 'kite_shield',
      count: 4,
      band: [0.66, 0.92],
      scale: [1.1, 1.25],
      tilt: 70,
      sink: 0.05,
    },
    {
      model: 'namaqualand_boulders_01',
      pick: true,
      count: 6,
      band: [0.82, 0.96],
      scale: [1.5, 2.4],
    },
  ],
};
