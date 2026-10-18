/**
 * Rapier interaction groups: (membership << 16) | filter. Two colliders interact when each one's
 * membership overlaps the other's filter. Queries pass a group value the same way.
 */
export const GROUP = {
  world: 1 << 0,
  player: 1 << 1,
  enemy: 1 << 2,
  neutral: 1 << 3,
} as const;

const ALL = 0xffff;

export function groups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

/** Level geometry: member of world, interacts with everything. */
export const WORLD_GROUPS = groups(GROUP.world, ALL);
/** Character controller movement: only collide with level geometry. */
export const MOVE_QUERY_GROUPS = groups(ALL, GROUP.world);
/** Ray/shape queries against level geometry only. */
export const WORLD_QUERY_GROUPS = groups(ALL, GROUP.world);

export function characterGroups(membership: number): number {
  return groups(membership, ALL);
}

export function hitQueryGroups(targets: number): number {
  return groups(ALL, targets);
}
