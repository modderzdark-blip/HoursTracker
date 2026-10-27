import type { ArenaAssets, Mass, SetPiece } from '../arenaAssets';
import { arc, dais, FORT, kit, wallRun } from '../arenaKit';
import type { Vec2 } from '../arenas';

/**
 * The Bound Spire: a roofless throne hall on the crown of the demon tower. Arcaded walls with
 * cabinets, shelves and statues between their arches, two rows of columns down the aisle, and to
 * the north an apse with a stepped dais where a crowned statue sits on the throne before the great
 * door, horses of stone on either side, the chained spire hanging over it all.
 */

const C: Vec2 = [0, 0];
const TOWER = kit('tower_round');

const tower = (x: number, z: number, scale: number, tall: number): SetPiece => ({
  model: FORT,
  node: TOWER,
  x,
  z,
  scale,
  stretch: [1, tall, 1],
  solid: 'round',
});

/** A statue on a plinth along a side wall, facing across the hall. */
const sideStatue = (x: number, z: number, tier: 0 | 1 = 0): { piece: SetPiece; plinth: Mass } => ({
  piece: {
    tier,
    model: 'gothic_statue',
    x,
    z,
    y: 0.8,
    scale: 1.9,
    yaw: x > 0 ? -90 : 90,
    solid: 'round',
  },
  plinth: { x, z, size: [1.7, 0.8, 1.7], surface: 'stone', solid: true },
});

const statues = [
  sideStatue(-18.6, -8),
  sideStatue(18.6, -8),
  sideStatue(-18.6, 6, 1),
  sideStatue(18.6, 6, 1),
];

export const BOUND_SPIRE_ASSETS: ArenaAssets = {
  // The nave's aisles: pointed arcades down both long sides, whole and towering.
  structures: [
    {
      kind: 'arcade',
      x: -18.6,
      z: -4,
      yaw: 90,
      length: 32,
      count: 6,
      height: 5.5,
      pointed: true,
      surface: 'wall',
      seed: 31,
    },
    {
      kind: 'arcade',
      x: 18.6,
      z: -4,
      yaw: 90,
      length: 32,
      count: 6,
      height: 5.5,
      pointed: true,
      surface: 'wall',
      seed: 32,
    },
  ],
  floor: { id: 'patterned_slate_tiles', size: 2.2 },
  floorPatch: { id: 'marble_mosaic_tiles', size: 2 },
  wall: { id: 'stone_tiles_02', size: 2 },
  rock: { id: 'rock_wall_08', size: 1.8 },
  stone: { id: 'stone_tiles_02', size: 1.8 },
  brazier: { model: 'stone_fire_pit', scale: 1.1, fire: 0.38 },
  boulders: { model: 'rock_09' },
  ownWalls: true,
  ownBackdrop: true,
  skip: ['arches', 'banners', 'flags', 'barricades', 'racks'],
  ground: [
    [-60, -60],
    [60, -60],
    [60, 50],
    [-60, 50],
  ],
  pieces: [
    // Arcades east and west (arches facing in), thick walls north and round the apse.
    ...wallRun('wall_walkway_straight_01', [21, -22], [21, 21], {
      scale: 0.75,
      out: 1.27,
      face: C,
    }),
    ...wallRun('wall_walkway_straight_01', [-21, -22], [-21, 21], {
      scale: 0.75,
      out: 1.27,
      face: C,
    }),
    ...wallRun('wall_thick_straight_01', [-21, -22], [-9, -22], { scale: 0.85, out: 1.8, face: C }),
    ...wallRun('wall_thick_straight_01', [9, -22], [21, -22], { scale: 0.85, out: 1.8, face: C }),
    ...wallRun('wall_thick_straight_02', [-9, -22], [-9, -30], { scale: 0.85, out: 1.8, face: C }),
    ...wallRun('wall_thick_straight_02', [9, -22], [9, -30], { scale: 0.85, out: 1.8, face: C }),
    ...wallRun('wall_thick_straight_01', [-9, -30], [9, -30], { scale: 1, out: 2.1, face: C }),
    // South: battlements of a lower wall, the camera looks over them.
    ...wallRun('wall_thin_straight_01', [21, 21], [-21, 21], { scale: 0.62, out: 0.8, y: -3 }),
    // Towers at the corners of the hall and flanking the apse.
    tower(-23.6, -24.6, 0.5, 1.7),
    tower(23.6, -24.6, 0.5, 1.7),
    tower(-11.6, -32.4, 0.42, 2),
    tower(11.6, -32.4, 0.42, 2),
    // The throne: a crowned statue on its seat before the great door, horses of stone beside it.
    { model: 'gothic_statue', x: 0, z: -27.2, y: 1.6, scale: 2.3, solid: 'round' },
    { model: 'large_castle_door', x: 0, z: -29.8, y: 1, scale: 2.2 },
    { model: 'horse_statue_01', x: -6.6, z: -24.6, y: 1.75, scale: 12, yaw: 90 },
    { model: 'horse_statue_01', x: 6.6, z: -24.6, y: 1.75, scale: 12, yaw: 90 },
    { model: 'treasure_chest', x: -7.4, z: -28.2, y: 0.75, scale: 1.4, yaw: 30, tier: 1 },
    { model: 'treasure_chest', x: 7.4, z: -28.2, y: 0.75, scale: 1.4, yaw: -30, tier: 1 },
    // Statues along the side walls; cabinets and shelves between the arches.
    ...statues.map((s) => s.piece),
    { model: 'GothicCabinet_01', x: -19.9, z: -16.5, scale: 1.5, yaw: 90, solid: 'box' },
    { model: 'GothicCabinet_01', x: 19.9, z: -16.5, scale: 1.5, yaw: -90, solid: 'box' },
    { model: 'wooden_bookshelf_worn', x: -20.1, z: -1.2, scale: 1.6, yaw: 90, solid: 'box' },
    { model: 'wooden_bookshelf_worn', x: 20.1, z: -1.2, scale: 1.6, yaw: -90, solid: 'box' },
    {
      model: 'wooden_bookshelf_worn',
      x: -20.1,
      z: 12.8,
      scale: 1.6,
      yaw: 90,
      solid: 'box',
      tier: 1,
    },
    {
      model: 'wooden_bookshelf_worn',
      x: 20.1,
      z: 12.8,
      scale: 1.6,
      yaw: -90,
      solid: 'box',
      tier: 1,
    },
    { model: 'marble_bust_01', x: -14.5, z: -20.6, y: 1.2, scale: 2.6, tier: 1 },
    { model: 'marble_bust_01', x: 14.5, z: -20.6, y: 1.2, scale: 2.6, tier: 1 },
    // Chandeliers hung high between the columns.
    { model: 'lantern_chandelier_01', x: -11, z: -10.5, y: 8.4, scale: 2.4, fire: 9.2 },
    { model: 'lantern_chandelier_01', x: 11, z: -10.5, y: 8.4, scale: 2.4, fire: 9.2 },
    { model: 'lantern_chandelier_01', x: -11, z: 7.5, y: 8.4, scale: 2.4, fire: 9.2, tier: 1 },
    { model: 'lantern_chandelier_01', x: 11, z: 7.5, y: 8.4, scale: 2.4, fire: 9.2, tier: 1 },
    // Far below the crown: mountains in the haze.
    ...arc('mountainside_far', {
      from: -120,
      to: 120,
      count: 7,
      radius: 72,
      scale: [4.5, 5.5],
      seed: 31,
      tier: 1,
      y: -26,
      jitter: 30,
      spread: 5,
      far: true,
    }),
  ],
  masses: [
    // The throne dais: four steps (walkable), the throne on top.
    ...dais(0, -26, 17, 8, 4, 0.25, 0.7),
    { x: 0, z: -27.2, size: [3, 0.6, 2.4], y: 1, surface: 'wall', solid: true },
    { x: 0, z: -28.6, size: [3.6, 6.2, 0.8], y: 1, surface: 'wall', solid: true },
    { x: -1.9, z: -27.2, size: [0.6, 1.5, 2.4], y: 1, surface: 'wall' },
    { x: 1.9, z: -27.2, size: [0.6, 1.5, 2.4], y: 1, surface: 'wall' },
    // Plinths for the horses, busts and wall statues.
    { x: -6.6, z: -24.6, size: [1.5, 1, 2.8], y: 0.75, surface: 'wall' },
    { x: 6.6, z: -24.6, size: [1.5, 1, 2.8], y: 0.75, surface: 'wall' },
    { x: -14.5, z: -20.6, size: [1.1, 1.2, 1.1], surface: 'wall', solid: true },
    { x: 14.5, z: -20.6, size: [1.1, 1.2, 1.1], surface: 'wall', solid: true },
    ...statues.map((s) => s.plinth),
  ],
  banners: [
    { x: -5.2, y: 8, z: -27.85, yaw: 0, w: 2, h: 5 },
    { x: 5.2, y: 8, z: -27.85, yaw: 0, w: 2, h: 5 },
    ...[-15.5, -4.5, 9.5].flatMap((z) => [
      { x: -20.85, y: 5.4, z, yaw: 90, w: 1.3, h: 3 },
      { x: 20.85, y: 5.4, z, yaw: -90, w: 1.3, h: 3 },
    ]),
  ],
  props: [],
  scatter: [
    { model: 'wooden_candlestick', count: 18, band: [0.8, 0.95], scale: [2.2, 3] },
    {
      model: 'kite_shield',
      count: 3,
      band: [0.7, 0.92],
      scale: [1.1, 1.25],
      tilt: 70,
      sink: 0.05,
    },
  ],
};
