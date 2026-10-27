import { mulberry32 } from '../../core/random';
import type { ArenaAssets, Mass, SetPiece } from '../arenaAssets';
import { arc, FORT, kit, wallPath, wallRun } from '../arenaKit';
import type { Vec2 } from '../arenas';

/**
 * The Gravewood: a graveyard in a wood of dead trees under a big moon. Low cemetery walls ring
 * it; leaning headstones and crosses stand in rows east and west of the open ground; a crypt
 * with two squat towers and its angels closes the north side; dead trees crowd in from outside.
 */

const C: Vec2 = [0, 0];

/** Rows of headstones and crosses (x from, x to, z rows), leaning every which way. */
function graves(xs: readonly number[], zs: readonly number[], seed: number): Mass[] {
  const rand = mulberry32(seed);
  const out: Mass[] = [];
  for (const x of xs)
    for (const z of zs) {
      const gx = x + (rand() - 0.5) * 0.8;
      const gz = z + (rand() - 0.5) * 0.8;
      const yaw = 90 + (rand() - 0.5) * 24;
      const tilt = (rand() - 0.5) * 22;
      const roll = (rand() - 0.5) * 14;
      if (rand() < 0.3) {
        // A cross: an upright and its arms.
        out.push(
          { x: gx, z: gz, size: [0.26, 2.1, 0.26], yaw, tilt, roll, surface: 'wall', solid: true },
          { x: gx, z: gz, y: 1.3, size: [1.1, 0.26, 0.26], yaw, tilt, roll, surface: 'wall' },
        );
      } else {
        const h = 1.2 + rand() * 0.7;
        out.push({
          x: gx,
          z: gz,
          y: -0.15,
          size: [1 + rand() * 0.5, h, 0.28],
          yaw,
          tilt,
          roll,
          surface: 'wall',
          solid: true,
        });
      }
    }
  return out;
}

const deadTree = (x: number, z: number, scale: number, yaw: number, tier: 0 | 1 = 0): SetPiece => ({
  model: 'dead_quiver_trunk',
  x,
  z,
  y: -0.1,
  scale,
  yaw,
  tilt: ((x * 7 + z * 3) % 9) - 4,
  tier,
});

/** The cemetery wall: kit walls sunk so only a man-high run of stone and its coping show. */
const LOW = { scale: 0.55, out: 0.7, y: -2.9, face: C };

export const GRAVEWOOD_ASSETS: ArenaAssets = {
  // Graves crowd the clearing's edge; a pillared mausoleum and a chapel ruin stand in the trees.
  structures: [
    { kind: 'tombs', x: -19.5, z: -5, yaw: 80, count: 3, rows: 2, seed: 51 },
    { kind: 'tombs', x: 19.5, z: -5, yaw: -80, count: 3, rows: 2, seed: 52 },
    { kind: 'tombs', x: 0, z: -22, count: 4, rows: 1, seed: 57 },
    { kind: 'tombs', x: -19, z: 6.5, yaw: 90, count: 3, rows: 1, seed: 53, tier: 1 },
    { kind: 'tombs', x: 19, z: 6.5, yaw: -90, count: 3, rows: 1, seed: 54, tier: 1 },
    {
      kind: 'shrine',
      x: -27,
      z: -27,
      yaw: 45,
      length: 7,
      height: 5,
      ruined: 0.15,
      altar: true,
      seed: 55,
      solid: false,
    },
    {
      kind: 'ruinWall',
      x: 26,
      z: -29,
      yaw: -40,
      length: 14,
      count: 4,
      height: 10,
      ruined: 0.4,
      surface: 'wall',
      seed: 56,
      solid: false,
    },
  ],
  floor: { id: 'forest_ground_04', size: 2.6 },
  floorPatch: { id: 'grassy_cobblestone', size: 2.2 },
  wall: { id: 'old_stone_wall', size: 1.6, tint: 0xb0b4b8 },
  rock: { id: 'rock_pitted_mossy', size: 2 },
  stone: { id: 'old_stone_wall', size: 1.8, tint: 0xb0b4b8 },
  brazier: { model: 'stone_fire_pit', scale: 1, fire: 0.35 },
  ownWalls: true,
  ownBackdrop: true,
  skip: ['landmark', 'arches', 'gargoyles', 'chains', 'banners', 'flags'],
  keep: ['trees', 'sarcophagi'],
  ground: [
    [-80, -80],
    [80, -80],
    [80, 60],
    [-80, 60],
  ],
  mist: [
    { x: -16, y: -0.3, z: 0, w: 9, h: 2.4, kind: 1, alpha: 0.45 },
    { x: 16, y: -0.3, z: 1, w: 9, h: 2.4, kind: 1, alpha: 0.45 },
    { x: 0, y: -0.3, z: -27, w: 14, h: 3, kind: 1, alpha: 0.4 },
    { x: -30, y: -0.5, z: -10, w: 18, h: 5, kind: 1, alpha: 0.4 },
    { x: 30, y: -0.5, z: -8, w: 18, h: 5, kind: 1, alpha: 0.4 },
  ],
  pieces: [
    // The crypt: an arched door between two squat towers, lamps at its threshold.
    ...wallRun('wall_thin_gate_01', [-2.6, -25.1], [2.6, -25.1], { scale: 0.7 }),
    {
      model: FORT,
      node: kit('tower_round'),
      x: -4.6,
      z: -25.8,
      scale: 0.3,
      stretch: [1, 1.3, 1],
      solid: 'round',
    },
    {
      model: FORT,
      node: kit('tower_round'),
      x: 4.6,
      z: -25.8,
      scale: 0.3,
      stretch: [1, 1.3, 1],
      solid: 'round',
    },
    { model: 'large_castle_door', x: 0, z: -25.2, scale: 1.15 },
    { model: 'caged_hanging_light', x: -1.9, z: -23.7, y: 2.7, scale: 1.2, fire: 2.85 },
    { model: 'caged_hanging_light', x: 1.9, z: -23.7, y: 2.7, scale: 1.2, fire: 2.85 },
    // Angels keep watch either side of it.
    { model: 'gothic_statue', x: -8.2, z: -21.6, y: 0.7, scale: 1.8, yaw: 12, solid: 'round' },
    { model: 'gothic_statue', x: 8.2, z: -21.6, y: 0.7, scale: 1.8, yaw: -12, solid: 'round' },
    // The cemetery wall all round.
    ...wallPath(
      'wall_thin_straight_01',
      [
        [-7.2, -24],
        [-10, -24],
        [-20, -15],
        [-24, -2],
        [-22, 12],
        [-12, 22],
        [12, 22],
        [22, 12],
        [24, -2],
        [20, -15],
        [10, -24],
        [7.2, -24],
      ],
      LOW,
    ),
    // Dead trees: a few inside the walls, the wood crowding in outside.
    deadTree(-19.6, -11, 3.4, 30),
    deadTree(20.4, 7.5, 3.1, 160),
    deadTree(-18.6, 9.4, 2.8, 250, 1),
    deadTree(-27, -6, 4.2, 60),
    deadTree(-29, 8, 3.8, 200),
    deadTree(28, -10, 4, 120),
    deadTree(27.5, 6, 3.6, 300),
    deadTree(-16, -29, 4.4, 10),
    deadTree(15, -30, 4.1, 80),
    deadTree(-33, -20, 4.8, 140, 1),
    deadTree(34, -18, 4.6, 20, 1),
    deadTree(-24, 22, 3.5, 330, 1),
    deadTree(25, 24, 3.4, 45, 1),
    { model: 'dead_tree_trunk_02', x: 18.2, z: -12.6, scale: 1.4, yaw: 40, solid: 'box' },
    { model: 'tree_stump_01', x: -17.4, z: 13.6, scale: 1.4, solid: 'round', tier: 1 },
    { model: 'root_cluster_02', x: 15.4, z: 16.4, scale: 2, yaw: 30, tier: 1 },
    // Hills of the dead wood on the horizon.
    ...arc('mountainside_far', {
      from: -120,
      to: 120,
      count: 7,
      radius: 70,
      scale: [3.6, 4.4],
      seed: 51,
      y: -22,
      jitter: 30,
      spread: 5,
      far: true,
      tier: 1,
    }),
  ],
  masses: [
    // Headstones and crosses in rows east and west of the open ground.
    ...graves([-19, -16.8, -14.6], [-7, -4.2, -1.4, 1.4, 4.2, 7], 3),
    ...graves([14.6, 16.8, 19], [-7, -4.2, -1.4, 1.4, 4.2, 7], 5),
    // The crypt's step and the angels' plinths.
    { x: 0, z: -23.4, size: [6.4, 0.3, 1.8], surface: 'stone', solid: true },
    { x: -8.2, z: -21.6, size: [1.6, 0.7, 1.6], surface: 'stone', solid: true },
    { x: 8.2, z: -21.6, size: [1.6, 0.7, 1.6], surface: 'stone', solid: true },
  ],
  props: [
    { model: 'treasure_chest', deg: 20, r: 0.9, scale: 1.2, yaw: -30, tier: 1 },
    { model: 'tree_stump_02', deg: 160, r: 0.88, scale: 1.3, solid: true, tier: 1 },
  ],
  scatter: [
    { model: 'wooden_lantern_01', count: 7, band: [0.6, 0.95], scale: [1.6, 1.9] },
    { model: 'wooden_candlestick', count: 10, band: [0.6, 0.9], scale: [2.2, 2.8] },
    {
      model: 'dry_branches_medium_01',
      pick: true,
      count: 8,
      band: [0.6, 0.95],
      scale: [1.2, 1.6],
    },
  ],
};
