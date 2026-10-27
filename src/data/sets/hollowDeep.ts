import type { ArenaAssets, SetPiece } from '../arenaAssets';
import { arc } from '../arenaKit';

/**
 * The Hollow Deep: a cavern of wet rock. Its walls close all round (low shelves to the south so
 * the camera sees over them, the rock rising again behind it), root mounds and mossy shelves
 * gather at their foot, stalactites hang from the dark, a still pool lies to the north-west and
 * the great crystal breaks out of the north wall.
 */

/** The cave wall: close rock in full detail from Medium up, its far version on Low. */
function caveWall(o: Parameters<typeof arc>[1]): SetPiece[] {
  return [
    ...arc('mountainside_mid', { ...o, tier: 1 }),
    ...arc('mountainside_far', { ...o, tier: 0, upTo: 0 }),
  ];
}

export const HOLLOW_DEEP_ASSETS: ArenaAssets = {
  // Wet cave rock, darker and cooler than the scan's daylight colour.
  floor: { id: 'mossy_rock', size: 3, tint: 0x6f7c74 },
  floorPatch: { id: 'brown_mud_rocks_01', size: 1.3, tint: 0x8a8278 },
  wall: { id: 'rock_wall_08', size: 1.8 },
  rock: { id: 'mossy_rock', size: 3 },
  stone: { id: 'rock_wall_08', size: 1.8 },
  brazier: { model: 'stone_fire_pit', scale: 1, fire: 0.35 },
  boulders: { model: 'rock_moss_set_02', pick: true },
  ownWalls: true,
  pools: [
    [-13.5, -9.5, 3.8],
    [12.5, 9.5, 2.4],
  ],
  mist: [
    { x: -14, y: -0.3, z: -10, w: 9, h: 2.5, kind: 1, alpha: 0.4 },
    { x: 18, y: -0.3, z: -16, w: 8, h: 2.5, kind: 1, alpha: 0.35 },
  ],
  pieces: [
    // The cave wall all round; behind the camera it stands back past the south shelves.
    ...caveWall({
      from: -132,
      to: 132,
      count: 12,
      radius: 29.5,
      scale: [1.45, 1.75],
      seed: 41,
      y: -2.5,
      jitter: 25,
      spread: 1.5,
      far: true,
    }),
    ...arc('mountainside_far', {
      from: 150,
      to: 210,
      count: 3,
      radius: 45,
      scale: [1.8, 2],
      seed: 42,
      y: -2,
      jitter: 20,
      far: true,
    }),
    // Root mounds and mossy shelves at the foot of the walls.
    { model: 'root_cluster_01', x: -20.5, z: -13.5, scale: 2.4, yaw: 50, solid: 'round' },
    { model: 'root_cluster_01', x: 19.6, z: 13.2, scale: 2.2, yaw: -130, solid: 'round' },
    { model: 'root_cluster_01', x: 21.2, z: -3.2, scale: 2, yaw: -90, solid: 'round', tier: 1 },
    { model: 'pine_roots', x: -17.5, z: 15.5, scale: 2.4, yaw: 30, tier: 1 },
    { model: 'pine_roots', x: 13.2, z: -18.6, scale: 2.2, yaw: 160, tier: 1 },
    { model: 'rock_moss_set_01', x: -22.4, z: 3.2, scale: 1.4, yaw: 80, y: -0.4 },
    { model: 'rock_moss_set_01', x: 22.8, z: 6.2, scale: 1.3, yaw: -100, y: -0.4, tier: 1 },
    { model: 'rock_moss_set_01', x: -10, z: -23.6, scale: 1.2, yaw: 10, y: -0.4, tier: 1 },
    // The south: low mossy shelves only (the camera looks over them).
    { model: 'rock_moss_set_02', x: -8, z: 25.4, scale: 1.4, yaw: 180, y: -0.3 },
    { model: 'rock_moss_set_02', x: 9, z: 24.6, scale: 1.3, yaw: 170, y: -0.3 },
    // Cave dwellers' leavings.
    { model: 'treasure_chest', x: 17.2, z: 15.8, scale: 1.3, yaw: -140, tier: 1 },
    { model: 'wooden_crate_01', x: 15.6, z: 17.6, scale: 1.4, yaw: -20, tier: 1 },
    { model: 'tree_stump_02', x: -16.6, z: 17.8, scale: 1.4, solid: 'round' },
  ],
  props: [],
  scatter: [
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
};
