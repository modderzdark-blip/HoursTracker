import type { ArenaAssets, SetPiece } from '../arenaAssets';
import { arc, dais, FORT, kit, wallRun } from '../arenaKit';
import type { Vec2 } from '../arenas';

/**
 * Cinder Court: a castle courtyard. Fort walls close an octagonal yard (arcades on the east and
 * west, low battlements to the south so the camera sees over them), a gatehouse between two
 * great towers on the north side behind a stepped dais, the keep rising beyond it on its own
 * terrace and a ring of mountains on the horizon.
 */

const S = 0.62;
const C: Vec2 = [0, 0];
const TOWER = kit('tower_round');

const tower = (x: number, z: number, scale: number, tall: number, y = 0): SetPiece => ({
  model: FORT,
  node: TOWER,
  x,
  z,
  y,
  scale,
  stretch: [1, tall, 1],
  yaw: (Math.atan2(-x, -z) * 180) / Math.PI,
  solid: y === 0 ? 'round' : undefined,
});

export const CINDER_COURT_ASSETS: ArenaAssets = {
  // Beyond the walls: the cathedral ruin to the north-west, twin obelisks before the keep and
  // an aqueduct striding away east.
  structures: [
    {
      kind: 'ruinWall',
      x: -31,
      z: -31,
      yaw: 45,
      length: 22,
      count: 6,
      height: 12,
      ruined: 0.35,
      surface: 'wall',
      seed: 3,
      solid: false,
    },
    { kind: 'obelisk', x: -15, z: -35, height: 13, seed: 4, solid: false },
    { kind: 'obelisk', x: 15, z: -35, height: 13, seed: 5, solid: false },
    {
      kind: 'arcade',
      x: 35,
      z: -8,
      yaw: 90,
      length: 32,
      count: 6,
      height: 7,
      ruined: 0.3,
      seed: 6,
      solid: false,
      tier: 1,
    },
  ],
  floor: { id: 'cobblestone_floor_07', size: 2 },
  floorPatch: { id: 'dry_ground_rocks', size: 4 },
  wall: { id: 'castle_wall_varriation', size: 2.5 },
  rock: { id: 'rock_wall_13', size: 2 },
  stone: { id: 'castle_wall_varriation', size: 2 },
  brazier: { model: 'stone_fire_pit', scale: 1, fire: 0.35 },
  boulders: { model: 'rock_09' },
  ownWalls: true,
  ownBackdrop: true,
  skip: ['landmark', 'arches', 'chains', 'gargoyles', 'banners', 'lavaPools'],
  ground: [
    [-80, -80],
    [80, -80],
    [80, 60],
    [-80, 60],
  ],
  pieces: [
    // Gatehouse: the gate between two great towers, its iron gate shut.
    ...wallRun('wall_thin_gate_01', [-4.1, -23.5], [4.1, -23.5], { scale: 1.1 }),
    tower(-8.4, -24.4, 0.55, 1.3),
    tower(8.4, -24.4, 0.55, 1.3),
    { model: 'large_iron_gate', x: 0, z: -23.1, scale: 1.3 },
    // Curtain walls on the diagonals, arcades east and west, corner towers.
    ...wallRun('wall_thin_straight_01', [9.11, -22], [22, -9.11], { scale: S, out: 0.8, face: C }),
    ...wallRun('wall_thin_straight_01', [-9.11, -22], [-22, -9.11], {
      scale: S,
      out: 0.8,
      face: C,
    }),
    ...wallRun('wall_walkway_straight_01', [22, -9.11], [22, 9.11], {
      scale: S,
      out: 1.05,
      face: C,
    }),
    ...wallRun('wall_walkway_straight_01', [-22, -9.11], [-22, 9.11], {
      scale: S,
      out: 1.05,
      face: C,
    }),
    tower(23.2, -9.9, 0.36, 1.25),
    tower(-23.2, -9.9, 0.36, 1.25),
    tower(23.2, 9.9, 0.36, 1.1),
    tower(-23.2, 9.9, 0.36, 1.1),
    // Stairs up to the arcade walks.
    {
      model: FORT,
      node: kit('wall_stairs_straight_01'),
      x: 20.8,
      z: 4.9,
      scale: S,
      yaw: 180,
      solid: 'box',
    },
    {
      model: FORT,
      node: kit('wall_stairs_straight_01'),
      x: -20.8,
      z: 4.9,
      scale: S,
      yaw: 180,
      solid: 'box',
    },
    // South: the battlements of a lower wall (the camera looks over them).
    ...wallRun('wall_thin_straight_01', [22, 9.11], [9.11, 22], { scale: S, out: 0.8, y: -3 }),
    ...wallRun('wall_thin_straight_01', [9.11, 22], [-9.11, 22], { scale: S, out: 0.8, y: -3 }),
    ...wallRun('wall_thin_straight_01', [-9.11, 22], [-22, 9.11], { scale: S, out: 0.8, y: -3 }),
    // The keep on its terrace beyond the gatehouse.
    ...wallRun('wall_thick_straight_01', [-12, -36], [12, -36], { scale: 0.9, y: 3, tier: 0 }),
    tower(-16, -38, 0.78, 1.15, 3),
    tower(16, -38, 0.78, 1.15, 3),
    tower(0, -47, 0.9, 1.5, 3),
    // Outer curtain beyond the arcades.
    ...wallRun('wall_thick_straight_01', [33, -24], [33, 6], { scale: 0.8, tier: 1, far: true }),
    ...wallRun('wall_thick_straight_01', [-33, -24], [-33, 6], { scale: 0.8, tier: 1, far: true }),
    // Mountains all round the north half.
    ...arc('mountainside_far', {
      from: -115,
      to: 115,
      count: 9,
      radius: 64,
      scale: [4, 4.8],
      seed: 3,
      y: -16,
      jitter: 25,
      spread: 6,
      far: true,
    }),
    // Statues guarding the dais; fire cages hung from the gate.
    {
      model: 'gothic_statue',
      x: -4.6,
      z: -20.2,
      y: 0.6,
      scale: 2.1,
      yaw: 15,
      solid: 'round',
    },
    { model: 'gothic_statue', x: 4.6, z: -20.2, y: 0.6, scale: 2.1, yaw: -15, solid: 'round' },
    { model: 'caged_hanging_light', x: -2.9, z: -21.6, y: 4.6, scale: 1.4, fire: 4.75 },
    { model: 'caged_hanging_light', x: 2.9, z: -21.6, y: 4.6, scale: 1.4, fire: 4.75 },
  ],
  masses: [
    // The dais before the gate: three low steps (walkable).
    ...dais(0, -19.9, 14.5, 4.6, 3, 0.2, 0.55),
    // The keep's terrace and its retaining wall.
    { x: 0, z: -41, size: [44, 3, 13], surface: 'wall' },
    // Plinths under the corner towers' feet.
    { x: 0, z: -24.6, size: [26, 0.5, 3.4], surface: 'wall' },
  ],
  banners: [
    { x: 0, y: 8.4, z: -21.95, yaw: 0, w: 2.4, h: 4.2 },
    { x: -8.4, y: 8.6, z: -19.9, yaw: 0, w: 1.6, h: 3.6 },
    { x: 8.4, y: 8.6, z: -19.9, yaw: 0, w: 1.6, h: 3.6 },
    { x: 20.85, y: 4.3, z: -5.4, yaw: -90, w: 1.2, h: 2.6 },
    { x: -20.85, y: 4.3, z: -5.4, yaw: 90, w: 1.2, h: 2.6 },
  ],
  props: [
    { model: 'treasure_chest', deg: -32, r: 0.84, scale: 1.3, yaw: 20 },
    { model: 'wooden_barrels_01', deg: 60, r: 0.84, scale: 1, yaw: 30, tier: 1 },
    { model: 'wooden_barrels_01', deg: 300, r: 0.84, scale: 1, yaw: -40, tier: 1 },
    { model: 'worn_metal_rack', deg: 80, r: 0.9, scale: 1.2, tier: 1 },
    { model: 'worn_metal_rack', deg: 280, r: 0.9, scale: 1.2, tier: 1 },
    { model: 'wine_barrel_01', deg: 128, r: 0.86, scale: 1.3, solid: true, tier: 1 },
    { model: 'wine_barrel_01', deg: 133, r: 0.82, scale: 1.3, yaw: 70, solid: true, tier: 1 },
    { model: 'wooden_crate_01', deg: 232, r: 0.86, scale: 1.4, yaw: 15, tier: 1 },
    { model: 'wooden_crate_01', deg: 236, r: 0.82, scale: 1.4, yaw: -30, tier: 1 },
  ],
  scatter: [
    {
      model: 'antique_estoc',
      count: 6,
      band: [0.62, 0.9],
      scale: [1.1, 1.3],
      tilt: 14,
      sink: 0.35,
    },
    {
      model: 'kite_shield',
      count: 5,
      band: [0.66, 0.92],
      scale: [1.1, 1.25],
      tilt: 70,
      sink: 0.05,
    },
    { model: 'wooden_lantern_01', count: 8, band: [0.88, 0.96], scale: [1.6, 1.9] },
  ],
};
