import type { ArenaAssets, SetPiece } from '../arenaAssets';
import { arc, rim } from '../arenaKit';
import type { Vec2 } from '../arenas';

/**
 * The Smoldering Wastes: a plateau of cracked, burnt clay. Cliffs close it to the west and north,
 * a river of lava running at their foot; to the east the plateau ends in a lip of rock over a lava
 * lake, mesas standing in the haze beyond it; to the south only a low ledge and a glowing crack,
 * so the camera sees over them. The volcano smokes on the horizon.
 */

const EAST: Vec2[] = [
  [19, -19],
  [25, -8],
  [26, 4],
  [22, 15],
];
const SOUTH: Vec2[] = [
  [22, 15],
  [13, 23],
  [0, 25.5],
  [-13, 23],
  [-22, 15],
];

const quiver = (x: number, z: number, scale: number, yaw: number): SetPiece => ({
  model: 'quiver_tree_01',
  x,
  z,
  scale,
  yaw,
  tier: 1,
});

export const ASHEN_WASTES_ASSETS: ArenaAssets = {
  // The bones of a fallen colossus on the eastern bank, its ribs arching over the fire; a ring
  // of standing stones with an altar beyond it and a lone obelisk to the south-east.
  structures: [
    {
      kind: 'ribs',
      x: 35,
      z: -4,
      yaw: 95,
      length: 28,
      count: 8,
      height: 12,
      ruined: 0.25,
      seed: 21,
      solid: false,
    },
    {
      kind: 'stones',
      x: 42,
      z: -30,
      length: 6.5,
      count: 10,
      height: 5,
      ruined: 0.3,
      altar: true,
      seed: 22,
      solid: false,
    },
    { kind: 'obelisk', x: 33, z: 17, height: 10, seed: 23, solid: false, tier: 1 },
  ],
  // Scorched clay: cracked mud plates burnt red, red stony mud gathering toward the edge.
  floor: { id: 'mud_cracked_dry_03', size: 2.2, tint: 0x8a6656 },
  floorPatch: { id: 'red_mud_stones', size: 1.5 },
  wall: { id: 'rock_boulder_cracked', size: 1.4, tint: 0x9a7466 },
  rock: { id: 'rock_boulder_cracked', size: 1.4 },
  stone: { id: 'rock_boulder_cracked', size: 1.6, tint: 0x9a7466 },
  brazier: { model: 'stone_fire_pit', scale: 1.2, fire: 0.42 },
  boulders: { model: 'rock_07' },
  ownWalls: true,
  ownBackdrop: true,
  skip: ['arches', 'flags', 'barricades'],
  ground: [
    [-90, -90],
    [90, -90],
    [90, 70],
    [-90, 70],
  ],
  lava: [
    // The river under the north cliffs.
    {
      points: [
        [-44, -24],
        [-32, -29],
        [-18, -30],
        [-4, -29.5],
        [10, -30.5],
        [24, -29.5],
        [34, -26],
      ],
      width: 4.4,
    },
    // The lake east of the plateau.
    {
      points: [
        [36, -28],
        [41, -14],
        [43, 0],
        [41, 14],
        [36, 26],
      ],
      width: 12,
    },
    // A crack glowing beyond the south ledge.
    {
      points: [
        [-26, 31],
        [-12, 29.5],
        [0, 30.5],
        [14, 29],
        [28, 31.5],
      ],
      width: 1.8,
    },
  ],
  mist: [
    { x: -14, y: -1, z: -31, w: 10, h: 18, kind: 0, alpha: 0.45 },
    { x: 18, y: -1, z: -30, w: 9, h: 16, kind: 0, alpha: 0.4 },
    { x: 42, y: -1, z: -6, w: 12, h: 14, kind: 0, alpha: 0.4 },
    { x: 41, y: -1, z: 14, w: 12, h: 12, kind: 0, alpha: 0.35 },
  ],
  pieces: [
    // Cliff walls closing the west and the north (the river runs at the foot of the north one).
    ...arc('mountainside_mid', {
      from: 232,
      to: 322,
      count: 6,
      radius: 31.5,
      scale: [1.35, 1.65],
      seed: 21,
      y: -3,
      jitter: 20,
      spread: 1.5,
      far: true,
    }),
    ...arc('mountainside_mid', {
      from: 330,
      to: 400,
      count: 5,
      radius: 37.5,
      scale: [1.6, 1.9],
      seed: 22,
      y: -3,
      jitter: 20,
      spread: 1.5,
      far: true,
    }),
    // The east lip over the lava lake, and the low south ledge.
    ...rim('namaqualand_cliff_01', EAST, {
      every: 9,
      out: 2.8,
      scale: [0.75, 0.95],
      seed: 23,
      jitter: 40,
      y: -1.4,
      tier: 1,
    }),
    ...rim('namaqualand_cliff_01_far', EAST, {
      every: 9,
      out: 2.8,
      scale: [0.75, 0.95],
      seed: 23,
      jitter: 40,
      y: -1.4,
      upTo: 0,
    }),
    ...rim('namaqualand_cliff_02_far', SOUTH, {
      every: 9,
      out: 2.4,
      scale: [0.42, 0.5],
      seed: 24,
      yaw: 90,
      jitter: 12,
      y: -2.3,
    }),
    // Across the lake: mesas; on every side the mountains, the volcano among them.
    { model: 'namaqualand_cliff_01_far', x: 57, z: -10, scale: 2.6, yaw: -80, far: true },
    { model: 'namaqualand_cliff_01_far', x: 58, z: 14, scale: 2.2, yaw: -120, far: true },
    ...arc('mountainside_far', {
      from: -10,
      to: 160,
      count: 6,
      radius: 70,
      scale: [3.8, 4.8],
      seed: 7,
      y: -15,
      jitter: 30,
      spread: 5,
      far: true,
    }),
    // Quiver trees on the flats; fallen trunks and stumps inside the rim.
    quiver(-23.5, -12.5, 2.3, 20),
    quiver(-21, 13.5, 2, 140),
    { model: 'dead_tree_trunk_02', x: 16.6, z: -15.8, scale: 1.7, yaw: 35, solid: 'box' },
    { model: 'dead_tree_trunk_02', x: -9.5, z: 20, scale: 1.6, yaw: 10, solid: 'box' },
    { model: 'tree_stump_02', x: -20.6, z: -6, scale: 1.5, solid: 'round', tier: 1 },
    { model: 'tree_stump_01', x: 9, z: 21.2, scale: 1.4, solid: 'round', tier: 1 },
  ],
  props: [],
  scatter: [
    {
      model: 'namaqualand_boulders_01',
      pick: true,
      count: 10,
      band: [0.75, 0.96],
      scale: [1.6, 3],
    },
    {
      model: 'antique_estoc',
      count: 6,
      band: [0.55, 0.9],
      scale: [1.1, 1.3],
      tilt: 18,
      sink: 0.35,
    },
    { model: 'kite_shield', count: 3, band: [0.6, 0.9], scale: [1.1, 1.2], tilt: 72, sink: 0.05 },
  ],
};
