import type { ArenaAssets, SetPiece } from '../arenaAssets';
import { arc, FORT, kit, wallPath, wallRun } from '../arenaKit';
import type { Vec2 } from '../arenas';

/**
 * The Drowned Cloister: the garth of a ruined abbey, flooded and overgrown. Arcades close it on
 * three sides (a low wall to the south, under the camera), standing water fills its corners and
 * the walks behind the arches, roots and moss have taken the paving, and the broken bell tower
 * leans over the north range.
 */

const C: Vec2 = [0, 0];
const ARCADE = { scale: 0.62, out: 1.05, face: C };

const tower = (x: number, z: number, scale: number, tall: number, y = 0, roll = 0): SetPiece => ({
  model: FORT,
  node: kit('tower_round'),
  x,
  z,
  y,
  scale,
  stretch: [1, tall, 1],
  roll,
  solid: y === 0 ? 'round' : undefined,
});

export const DROWNED_CLOISTER_ASSETS: ArenaAssets = {
  floor: { id: 'mossy_cobblestone', size: 2.2 },
  floorPatch: { id: 'forest_ground_04', size: 2.4 },
  wall: { id: 'castle_wall_varriation', size: 2, tint: 0xa8b4a8 },
  rock: { id: 'rock_pitted_mossy', size: 2 },
  stone: { id: 'medieval_blocks_06', size: 1.8, tint: 0xa8b0a0 },
  brazier: { model: 'stone_fire_pit', scale: 1, fire: 0.35 },
  boulders: { model: 'rock_moss_set_02', pick: true },
  ownWalls: true,
  ownBackdrop: true,
  skip: ['landmark', 'arches', 'gargoyles', 'chains', 'banners', 'flags'],
  keep: ['roots'],
  pools: [
    [-14.5, -14.5, 3.4],
    [14.5, -14, 3],
    [-14, 14.5, 3],
    [14.5, 14.5, 3.4],
    [-24, 0, 4],
    [24, -4, 4],
    [0, -25, 4.5],
  ],
  mist: [
    { x: -14, y: -0.3, z: -14, w: 8, h: 2.2, kind: 1, alpha: 0.4 },
    { x: 14, y: -0.3, z: 14, w: 8, h: 2.2, kind: 1, alpha: 0.4 },
    { x: 0, y: -0.3, z: -26, w: 16, h: 3, kind: 1, alpha: 0.45 },
  ],
  pieces: [
    // The arcades, arches facing the garth; a low wall to the south.
    ...wallRun('wall_walkway_straight_01', [-17, -21], [17, -21], ARCADE),
    ...wallRun('wall_walkway_straight_01', [21, -17], [21, 17], ARCADE),
    ...wallRun('wall_walkway_straight_01', [-21, -17], [-21, 17], ARCADE),
    ...wallPath(
      'wall_thin_straight_01',
      [
        [21, 17],
        [17, 21],
        [-17, 21],
        [-21, 17],
      ],
      { scale: 0.55, out: 0.7, y: -2.9, face: C },
    ),
    // Corner piers where the ranges meet.
    tower(20.8, -20.8, 0.3, 1.4),
    tower(-20.8, -20.8, 0.3, 1.4),
    tower(21.4, 21.4, 0.24, 0.45, -1.2),
    tower(-21.4, 21.4, 0.24, 0.45, -1.2),
    // The bell tower over the north range, its upper stage leaning.
    tower(0, -28.5, 0.48, 1.5),
    tower(0.4, -28.6, 0.36, 1.2, 9.6, 5),
    // Beyond the ranges: the abbey's outer walls and the hills.
    ...wallRun('wall_thick_straight_01', [-30, -32], [-12, -34], {
      scale: 0.8,
      tier: 1,
      far: true,
    }),
    ...wallRun('wall_thick_straight_01', [12, -34], [30, -32], { scale: 0.8, tier: 1, far: true }),
    ...arc('mountainside_far', {
      from: -110,
      to: 110,
      count: 7,
      radius: 64,
      scale: [3.8, 4.6],
      seed: 71,
      y: -18,
      jitter: 30,
      spread: 5,
      far: true,
      tier: 1,
    }),
    // Saints in the north walk; a fallen shelf of the library in the east one.
    { model: 'gothic_statue', x: -8.5, z: -19.6, scale: 1.8, yaw: 10, solid: 'round' },
    { model: 'gothic_statue', x: 8.5, z: -19.6, scale: 1.8, yaw: -10, solid: 'round' },
    {
      model: 'wooden_bookshelf_worn',
      x: 19.6,
      z: 9.8,
      scale: 1.5,
      yaw: -90,
      roll: 12,
      solid: 'box',
      tier: 1,
    },
    { model: 'GothicCabinet_01', x: -19.7, z: -9.6, scale: 1.4, yaw: 90, solid: 'box' },
    // The garden gone wild: root mats, mossy stones, a dead trunk.
    { model: 'root_cluster_02', x: -16.4, z: 4.6, scale: 2.4, yaw: 60 },
    { model: 'root_cluster_02', x: 16.2, z: -4.2, scale: 2.2, yaw: 230, tier: 1 },
    { model: 'pine_roots', x: 4.6, z: 17.6, scale: 2.2, yaw: 10, tier: 1 },
    { model: 'rock_moss_set_01', x: 17.6, z: 17.4, scale: 0.8, yaw: -45, y: -0.3, tier: 1 },
    { model: 'rock_moss_set_01', x: -17.6, z: -17.2, scale: 0.8, yaw: 135, y: -0.3 },
    { model: 'dead_tree_trunk_02', x: -6.6, z: 18.4, scale: 1.5, yaw: 15, solid: 'box' },
    { model: 'caged_hanging_light', x: -3, z: -19.8, y: 3.4, scale: 1.2, fire: 3.55 },
    { model: 'caged_hanging_light', x: 3, z: -19.8, y: 3.4, scale: 1.2, fire: 3.55 },
  ],
  masses: [
    // The fallen arch stones in the north-west walk; the saints' plinths.
    { x: -12, z: -19.6, size: [2.4, 0.6, 1.2], yaw: 20, tilt: 8, surface: 'stone' },
    { x: 11.4, z: 19.6, size: [2, 0.5, 1], yaw: -30, tilt: -6, surface: 'stone' },
  ],
  props: [{ model: 'treasure_chest', deg: 225, r: 0.86, scale: 1.2, yaw: 20, tier: 1 }],
  scatter: [
    { model: 'wooden_candlestick', count: 14, band: [0.75, 0.95], scale: [2.2, 2.8] },
    { model: 'wooden_lantern_01', count: 5, band: [0.8, 0.95], scale: [1.6, 1.9] },
    {
      model: 'rock_moss_set_02',
      pick: true,
      count: 6,
      band: [0.78, 0.96],
      scale: [0.8, 1.1],
      solid: true,
    },
  ],
};
