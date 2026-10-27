import type { ArenaAssets, SetPiece } from '../arenaAssets';
import { arc, FORT, kit, rim, wallPath, wallRun } from '../arenaKit';
import type { Vec2 } from '../arenas';

/**
 * Widow's Pass: a paved ledge high in the mountains. A sheer cliff rises to the west, boulders
 * piled at its foot; to the east the ground ends at a parapet over a drop full of mist, the far
 * peaks across it; to the north a fortified gate closes the pass between two towers. The road
 * falls away south past a low wall the camera sees over.
 */

const C: Vec2 = [0, 0];

/** A slab of the west cliff, facing the pass. */
const cliff = (x: number, z: number, scale: number, turn: number, tier: 0 | 1 = 0): SetPiece => ({
  model: 'mountainside_mid',
  x,
  z,
  y: -2,
  scale,
  yaw: (Math.atan2(-x, -z) * 180) / Math.PI + turn,
  tier,
  far: true,
});

const EAST: Vec2[] = [
  [8, -28],
  [16, -18],
  [18.5, -4],
  [18, 10],
  [14, 22],
];

export const WIDOWS_PASS_ASSETS: ArenaAssets = {
  floor: { id: 'slate_floor_02', size: 2.4, tint: 0xb8b0a8 },
  floorPatch: { id: 'dry_ground_rocks', size: 3 },
  wall: { id: 'castle_wall_varriation', size: 2 },
  rock: { id: 'rock_wall', size: 2.4 },
  stone: { id: 'castle_wall_varriation', size: 2 },
  brazier: { model: 'stone_fire_pit', scale: 1.1, fire: 0.38 },
  boulders: { model: 'rock_09' },
  ownWalls: true,
  ownBackdrop: true,
  skip: ['landmark', 'arches', 'gargoyles', 'chains', 'banners'],
  keep: ['barricades'],
  // The ground stops at the brink in the east.
  ground: [
    [-80, -80],
    [21.5, -80],
    [21.5, 60],
    [-80, 60],
  ],
  mist: [
    { x: 27, y: -3, z: -18, w: 16, h: 9, kind: 1, alpha: 0.55 },
    { x: 28, y: -3, z: 0, w: 18, h: 9, kind: 1, alpha: 0.6 },
    { x: 27, y: -3, z: 18, w: 16, h: 9, kind: 1, alpha: 0.55 },
    { x: 40, y: -6, z: -4, w: 26, h: 14, kind: 1, alpha: 0.45 },
  ],
  pieces: [
    // The gate closing the pass: arch, portcullis, two towers and the walls out to the brink.
    ...wallRun('wall_thin_gate_01', [-4.45, -29.6], [4.45, -29.6], { scale: 1.2 }),
    {
      model: FORT,
      node: kit('tower_round'),
      x: -9.4,
      z: -30.6,
      scale: 0.6,
      stretch: [1, 1.45, 1],
      solid: 'round',
    },
    {
      model: FORT,
      node: kit('tower_round'),
      x: 9.4,
      z: -30.6,
      scale: 0.6,
      stretch: [1, 1.45, 1],
      solid: 'round',
    },
    { model: 'large_iron_gate', x: 0, z: -29, scale: 1.4 },
    ...wallRun('wall_thick_straight_01', [13, -28], [22, -26], { scale: 0.75, out: 1.6, face: C }),
    ...wallRun('wall_thick_straight_01', [-13, -28], [-22, -27], {
      scale: 0.75,
      out: 1.6,
      face: C,
    }),
    { model: 'caged_hanging_light', x: -3.2, z: -27.8, y: 5.2, scale: 1.4, fire: 5.35 },
    { model: 'caged_hanging_light', x: 3.2, z: -27.8, y: 5.2, scale: 1.4, fire: 5.35 },
    // The west cliff, boulders at its foot.
    cliff(-25.5, -20, 1.9, 0),
    cliff(-26.5, -5, 2, 10),
    cliff(-26, 10, 1.8, -10),
    cliff(-24.5, 24, 1.7, 15, 1),
    ...rim(
      'namaqualand_cliff_01',
      [
        [-16, -18],
        [-18.5, -4],
        [-18, 10],
      ],
      { every: 9, out: 2.6, scale: [0.7, 0.9], seed: 61, jitter: 40, y: -0.6, tier: 1 },
    ),
    ...rim(
      'namaqualand_cliff_01_far',
      [
        [-16, -18],
        [-18.5, -4],
        [-18, 10],
      ],
      { every: 9, out: 2.6, scale: [0.7, 0.9], seed: 61, jitter: 40, y: -0.6, upTo: 0 },
    ),
    // The brink: a low parapet, rock falling away below it.
    ...wallPath('wall_thin_straight_01', EAST, { scale: 0.5, out: 0.65, y: -3.2, face: C }),
    ...rim('namaqualand_cliff_02_mid', EAST, {
      every: 12,
      out: 4.2,
      scale: [0.9, 1],
      seed: 62,
      yaw: 90,
      jitter: 8,
      y: -7.2,
      tier: 1,
    }),
    // The road down to the south behind a low wall.
    ...wallRun('wall_thin_straight_01', [14, 22], [-14, 22], { scale: 0.5, out: 0.65, y: -3 }),
    ...wallRun('wall_thin_straight_01', [-14, 22], [-18, 10], { scale: 0.5, out: 0.65, y: -3 }),
    // Across the drop and all round: the peaks.
    ...arc('mountainside_far', {
      from: 20,
      to: 170,
      count: 7,
      radius: 62,
      scale: [5, 6.2],
      seed: 63,
      y: -26,
      jitter: 30,
      spread: 6,
      far: true,
    }),
    ...arc('mountainside_far', {
      from: -60,
      to: 15,
      count: 4,
      radius: 58,
      scale: [4.5, 5.5],
      seed: 64,
      y: -12,
      jitter: 30,
      spread: 4,
      far: true,
      tier: 1,
    }),
    // A guard post by the gate: crates, barrels, a rack of arms.
    { model: 'wooden_barrels_01', x: 11.6, z: -21.4, scale: 1, yaw: -30, tier: 1 },
    { model: 'wooden_crate_01', x: -11.8, z: -21.6, scale: 1.4, yaw: 20, tier: 1 },
    { model: 'wooden_crate_01', x: -12.6, z: -20.4, scale: 1.4, yaw: -15, tier: 1 },
    { model: 'worn_metal_rack', x: -6.8, z: -24.6, scale: 1.2, yaw: 0 },
  ],
  masses: [{ x: 0, z: -27.9, size: [10, 0.25, 2.4], surface: 'stone', solid: true }],
  banners: [
    { x: -9.4, y: 9.4, z: -26.3, yaw: 0, w: 1.6, h: 3.8 },
    { x: 9.4, y: 9.4, z: -26.3, yaw: 0, w: 1.6, h: 3.8 },
    { x: 0, y: 9.6, z: -27.75, yaw: 0, w: 2.2, h: 4 },
  ],
  props: [],
  scatter: [
    {
      model: 'namaqualand_boulders_01',
      pick: true,
      count: 7,
      band: [0.78, 0.96],
      scale: [1.5, 2.5],
    },
    {
      model: 'antique_estoc',
      count: 4,
      band: [0.6, 0.9],
      scale: [1.1, 1.3],
      tilt: 16,
      sink: 0.35,
    },
    {
      model: 'kite_shield',
      count: 3,
      band: [0.66, 0.92],
      scale: [1.1, 1.25],
      tilt: 70,
      sink: 0.05,
    },
  ],
};
