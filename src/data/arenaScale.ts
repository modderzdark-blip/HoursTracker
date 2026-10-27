import type { ArenaAssets, PropPlacement, SetPiece } from './arenaAssets';
import type { ArenaDef, Vec2 } from './arenas';

/**
 * Builds an arena bigger than it was authored: every position, the outline, the architecture and
 * the terrain grow by `k` around the centre, so the composition (walls meeting, statues on their
 * plinths, lights on their walls) stays intact while the place gets wider and taller. Hand-sized
 * dressing (crates, barrels, chests, lanterns) moves with it but keeps its real size. Stair and
 * dais rises grow too: the sets keep them low enough to stay walkable at their scale (tested).
 */

/** Hand-sized dressing: placed further out, never made bigger. */
const LIFE_SIZE = new Set([
  'wooden_crate_01',
  'wine_barrel_01',
  'wooden_barrels_01',
  'worn_metal_rack',
  'treasure_chest',
  'caged_hanging_light',
  'wooden_lantern_01',
  'wooden_candlestick',
  'brass_candleholders',
  'kite_shield',
  'antique_estoc',
  'wooden_bookshelf_worn',
  'GothicCabinet_01',
  'lantern_chandelier_01',
  'stone_fire_pit',
  'marble_bust_01',
  'dry_branches_medium_01',
  'tree_stump_01',
  'tree_stump_02',
]);

const v2 = (p: Vec2, k: number): Vec2 => [p[0] * k, p[1] * k];

export function scaleArenaDef(d: ArenaDef, k: number): ArenaDef {
  if (k === 1) return d;
  return {
    ...d,
    floorRadius: d.floorRadius * k,
    wall: { ...d.wall, height: d.wall.height * k, thickness: d.wall.thickness * k },
    outline: d.outline?.map((p) => v2(p, k)),
    spawn: [d.spawn[0] * k, d.spawn[1], d.spawn[2] * k],
    spawnPoints: d.spawnPoints.map((p) => v2(p, k)),
    bossSpawn: v2(d.bossSpawn, k),
    dummySpawn: v2(d.dummySpawn, k),
    pillars: d.pillars.map((p) => ({
      x: p.x * k,
      z: p.z * k,
      radius: p.radius * k,
      height: p.height * k,
    })),
    blocks: d.blocks.map((b) => ({
      ...b,
      position: [b.position[0] * k, b.position[1] * k, b.position[2] * k],
      size: [b.size[0] * k, b.size[1] * k, b.size[2] * k],
    })),
    rocks: d.rocks.map((r) => ({ x: r.x * k, z: r.z * k, scale: r.scale * k })),
    braziers: d.braziers.map((b) => ({ x: b.x * k, z: b.z * k })),
    // The same haze over a longer distance.
    palette: { ...d.palette, fogDensity: d.palette.fogDensity / k },
  };
}

function scalePiece(p: SetPiece, k: number): SetPiece {
  const grow = !LIFE_SIZE.has(p.model);
  return {
    ...p,
    x: p.x * k,
    z: p.z * k,
    y: p.y === undefined ? undefined : p.y * k,
    scale: (p.scale ?? 1) * (grow ? k : 1),
    fire: p.fire === undefined ? undefined : grow ? p.fire * k : p.fire + (p.y ?? 0) * (k - 1),
  };
}

function scaleProp(p: PropPlacement, k: number): PropPlacement {
  // Radii are fractions of the (already scaled) floor radius unless given in metres.
  return p.metres === true ? { ...p, r: p.r * k } : p;
}

export function scaleArenaAssets(a: ArenaAssets, k: number): ArenaAssets {
  if (k === 1) return a;
  return {
    ...a,
    props: a.props.map((p) => scaleProp(p, k)),
    pieces: a.pieces?.map((p) => scalePiece(p, k)),
    masses: a.masses?.map((m) => ({
      ...m,
      x: m.x * k,
      z: m.z * k,
      y: m.y === undefined ? undefined : m.y * k,
      size: [m.size[0] * k, m.size[1] * k, m.size[2] * k],
    })),
    structures: a.structures?.map((st) => ({
      ...st,
      x: st.x * k,
      z: st.z * k,
      y: st.y === undefined ? undefined : st.y * k,
      scale: (st.scale ?? 1) * k,
    })),
    banners: a.banners?.map((b) => ({
      ...b,
      x: b.x * k,
      y: b.y * k,
      z: b.z * k,
      w: b.w * k,
      h: b.h * k,
    })),
    lava: a.lava?.map((c) => ({ points: c.points.map((p) => v2(p, k)), width: c.width * k })),
    pools: a.pools?.map(([x, z, r]) => [x * k, z * k, r * k] as const),
    ground: a.ground?.map((p) => v2(p, k)),
    mist: a.mist?.map((c) => ({
      ...c,
      x: c.x * k,
      y: c.y * k,
      z: c.z * k,
      w: c.w * k,
      h: c.h * k,
    })),
  };
}
