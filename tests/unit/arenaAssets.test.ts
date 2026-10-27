import { Box3, InstancedMesh, Matrix4, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/core/random';
import { ARENA_ASSETS, arenaAssetRequest, type SetPiece } from '../../src/data/arenaAssets';
import { ARENAS, ARENA_IDS, type ArenaId } from '../../src/data/arenas';
import { QUALITY_PRESETS, type QualityLevel } from '../../src/data/quality';
import { detailTier, ScannedProps } from '../../src/modes/ScannedProps';
import type { PhysicsWorld } from '../../src/physics/PhysicsWorld';
import { boxLibrary, loadModelInfo, modelTris } from './arenaModels';

const IDS = ARENA_IDS;

/** Processed asset files on disk (keys only; nothing is loaded). */
const FILES = new Set(
  Object.keys(import.meta.glob('../../public/assets/{surfaces/*/*.webp,models/*.glb}')).map((k) =>
    k.replace('../../public/assets/', ''),
  ),
);

beforeAll(async () => {
  const models = new Set<string>();
  for (const id of IDS) for (const m of arenaAssetRequest(id).models) models.add(m);
  for (const m of models) await loadModelInfo(m);
}, 60_000);

describe('scanned arena assets', () => {
  it('every arena references processed files that exist in public/assets', () => {
    for (const id of IDS) {
      const req = arenaAssetRequest(id);
      expect(req.surfaces.length).toBeGreaterThanOrEqual(3);
      for (const s of req.surfaces)
        for (const map of ['albedo', 'normal', 'orm'])
          expect(FILES.has(`surfaces/${s}/${map}.webp`), `${id}: ${s}/${map}`).toBe(true);
      for (const m of req.models) expect(FILES.has(`models/${m}.glb`), `${id}: ${m}`).toBe(true);
    }
  });

  it('every node a set piece names exists in its model', () => {
    const lib = boxLibrary();
    for (const id of IDS)
      for (const p of ARENA_ASSETS[id].pieces ?? []) {
        if (p.node === undefined) continue;
        const parts = lib.model(p.model) ?? [];
        expect(
          parts.some((part) => part.node === p.node),
          `${id}: ${p.model} / ${p.node}`,
        ).toBe(true);
      }
  });

  it('placements are sane: inside the wall band, positive scales, tiles at real sizes', () => {
    for (const id of IDS) {
      const a = ARENA_ASSETS[id];
      for (const s of [a.floor, a.floorPatch, a.wall, a.rock, a.stone])
        expect(s.size).toBeGreaterThan(0.5);
      for (const p of a.props) {
        expect(Number.isFinite(p.deg)).toBe(true);
        expect(p.r).toBeGreaterThan(0.5);
        expect(p.r).toBeLessThanOrEqual(1.05);
        expect(p.scale ?? 1).toBeGreaterThan(0);
      }
      for (const s of a.scatter) {
        expect(s.band[0]).toBeGreaterThanOrEqual(0.5);
        expect(s.band[1]).toBeLessThanOrEqual(1);
        expect(s.band[0]).toBeLessThan(s.band[1]);
        expect(s.scale[0]).toBeGreaterThan(0);
        expect(s.count).toBeGreaterThan(0);
      }
      for (const p of a.pieces ?? []) {
        expect(Number.isFinite(p.x + p.z + (p.y ?? 0) + (p.yaw ?? 0)), `${id} ${p.model}`).toBe(
          true,
        );
        expect(p.scale ?? 1).toBeGreaterThan(0);
        for (const k of p.stretch ?? [1, 1, 1]) expect(k).toBeGreaterThan(0.3);
      }
      for (const m of a.masses ?? []) for (const k of m.size) expect(k).toBeGreaterThan(0);
    }
  });
});

interface Collider {
  readonly x: number;
  readonly z: number;
  /** Half sizes along the box's own axes (a cylinder: r, r). */
  readonly hx: number;
  readonly hz: number;
  readonly yaw: number;
  readonly round: boolean;
}

/** Distance from (x, z) to a collider's footprint (0 inside). */
function gap(c: Collider, x: number, z: number): number {
  if (c.round) return Math.max(0, Math.hypot(x - c.x, z - c.z) - c.hx);
  // Into the box's frame (yaw about Y turns local X to (cos, −sin)).
  const dx = x - c.x;
  const dz = z - c.z;
  const lx = dx * Math.cos(c.yaw) - dz * Math.sin(c.yaw);
  const lz = dx * Math.sin(c.yaw) + dz * Math.cos(c.yaw);
  return Math.hypot(Math.max(0, Math.abs(lx) - c.hx), Math.max(0, Math.abs(lz) - c.hz));
}

const yawOf = (q?: { x: number; y: number; z: number; w: number }): number =>
  q === undefined ? 0 : 2 * Math.atan2(q.y, q.w);

function build(
  id: ArenaId,
  quality: QualityLevel = 'medium',
): { props: ScannedProps; colliders: Collider[] } {
  const def = ARENAS[id];
  const colliders: Collider[] = [];
  const physics = {
    addStaticCylinder: (x: number, _y: number, z: number, _h: number, r: number) =>
      colliders.push({ x, z, hx: r, hz: r, yaw: 0, round: true }),
    addStaticCuboid: (
      x: number,
      _y: number,
      z: number,
      hx: number,
      _hy: number,
      hz: number,
      q?: { x: number; y: number; z: number; w: number },
    ) => colliders.push({ x, z, hx, hz, yaw: yawOf(q), round: false }),
  } as unknown as PhysicsWorld;
  const keepOut: [number, number, number][] = [
    [def.spawn[0], def.spawn[2], 3.5],
    [def.bossSpawn[0], def.bossSpawn[1], 4],
    [def.dummySpawn[0], def.dummySpawn[1], 2],
    ...def.spawnPoints.map(([x, z]): [number, number, number] => [x, z, 2]),
  ];
  const props = new ScannedProps(
    boxLibrary(),
    def,
    ARENA_ASSETS[id],
    physics,
    QUALITY_PRESETS[quality],
    mulberry32(7),
    keepOut,
  );
  props.build();
  return { props, colliders };
}

/** Scanned triangles an arena draws at a quality (instances × the real model's triangles). */
function scannedTriangles(id: ArenaId, quality: QualityLevel): number {
  const a = ARENA_ASSETS[id];
  const def = ARENAS[id];
  const tier = detailTier(QUALITY_PRESETS[quality]);
  let tris = 0;
  for (const p of a.pieces ?? [])
    if ((p.tier ?? 0) <= tier && tier <= (p.upTo ?? 2)) tris += modelTris(p.model, p.node);
  for (const p of a.props) if ((p.tier ?? 0) <= tier) tris += modelTris(p.model, p.node);
  if (tier > 0)
    for (const s of a.scatter)
      tris += s.pick === true ? (modelTris(s.model) / 3) * s.count : modelTris(s.model) * s.count;
  if (a.brazier !== undefined) tris += modelTris(a.brazier.model) * def.braziers.length;
  if (a.boulders !== undefined)
    tris += (modelTris(a.boulders.model) / (a.boulders.pick === true ? 3 : 1)) * def.rocks.length;
  return tris;
}

/** World footprint centre, half extents and top of a set piece from the model's real bounds. */
function pieceBounds(p: SetPiece): { x: number; z: number; r: number; top: number } {
  const parts = boxLibrary().model(p.model) ?? [];
  const box = new Box3();
  for (const part of parts) {
    if (p.node !== undefined && part.node !== p.node) continue;
    const b = part.geometry.boundingBox;
    if (b === null) continue;
    const bb = b.clone();
    if (p.node === undefined) bb.translate(part.offset);
    box.union(bb);
  }
  const k = p.scale ?? 1;
  const st = p.stretch ?? [1, 1, 1];
  const size = box.getSize(new Vector3());
  const c = box.getCenter(new Vector3());
  const yaw = ((p.yaw ?? 0) * Math.PI) / 180;
  const lx = c.x * k * st[0];
  const lz = c.z * k * st[2];
  return {
    x: p.x + lx * Math.cos(yaw) + lz * Math.sin(yaw),
    z: p.z - lx * Math.sin(yaw) + lz * Math.cos(yaw),
    r: (Math.max(size.x * st[0], size.z * st[2]) * k) / 2,
    top: (p.y ?? 0) + size.y * k * st[1],
  };
}

describe('scanned props', () => {
  for (const id of IDS) {
    it(`${id}: instanced per part, few draw calls, colliders off spawns and the fight`, () => {
      const def = ARENAS[id];
      const R = def.floorRadius;
      const { props, colliders } = build(id);
      expect(props.objects.length).toBeGreaterThan(5);
      // Every part (merged per material) is drawn once however many copies there are.
      expect(props.objects.length, 'scanned draw calls').toBeLessThanOrEqual(44);
      const m = new Matrix4();
      const p = new Vector3();
      for (const o of props.objects) {
        expect(o).toBeInstanceOf(InstancedMesh);
        const mesh = o as InstancedMesh;
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, m);
          p.setFromMatrixPosition(m);
          expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
        }
      }
      // Solid props get colliders: none on a spawn point, the boss, the hero or the dummy, and
      // none reaching into the open fight circle.
      const points: (readonly [number, number])[] = [
        ...def.spawnPoints,
        def.bossSpawn,
        def.dummySpawn,
        [def.spawn[0], def.spawn[2]],
      ];
      for (const c of colliders) {
        for (const [x, z] of points) expect(gap(c, x, z), `${id} ${x},${z}`).toBeGreaterThan(0.8);
        expect(
          gap(c, 0, 0),
          `${id} collider at ${c.x.toFixed(1)},${c.z.toFixed(1)}`,
        ).toBeGreaterThan(R * 0.45);
      }
      expect(props.flames.length).toBeGreaterThanOrEqual(def.braziers.length);
      props.dispose();
      expect(props.objects.length).toBe(0);
    });
  }

  it('Low keeps only the key set pieces and drops the scattered dressing', () => {
    for (const id of IDS) {
      const low = build(id, 'low').props;
      const high = build(id, 'high').props;
      const count = (s: ScannedProps): number =>
        s.objects.reduce((n, o) => n + (o as InstancedMesh).count, 0);
      expect(count(low), id).toBeLessThan(count(high));
    }
  });

  it('scanned triangles stay within each quality budget', () => {
    // The rest of the arena (floor, columns, clutter, effects) adds 20k (Low) to 60k (High): the
    // whole arena stays under 200k / 400k / 600k triangles (measured in the arena viewer).
    const budget: Record<QualityLevel, number> = {
      low: 165_000,
      medium: 330_000,
      high: 520_000,
      ultra: 520_000,
    };
    for (const id of IDS)
      for (const q of ['low', 'medium', 'high'] as const)
        expect(Math.round(scannedTriangles(id, q)), `${id} ${q}`).toBeLessThan(budget[q]);
  });

  it('nothing tall stands between the camera and a hero at the south edge', () => {
    for (const id of IDS) {
      const R = ARENAS[id].floorRadius;
      for (const piece of ARENA_ASSETS[id].pieces ?? []) {
        const b = pieceBounds(piece);
        const southBand = b.z + b.r > R * 0.55 && b.z - b.r < R + 9 && Math.abs(b.x) < R * 0.8;
        if (southBand)
          expect(
            b.top,
            `${id}: ${piece.node ?? piece.model} at ${b.x.toFixed(1)},${b.z.toFixed(1)}`,
          ).toBeLessThan(3.4);
      }
    }
  });

  it('is deterministic for an arena', () => {
    const a = build('cinder_court').props;
    const b = build('cinder_court').props;
    expect(a.objects.map((o) => (o as InstancedMesh).count)).toEqual(
      b.objects.map((o) => (o as InstancedMesh).count),
    );
  });
});
