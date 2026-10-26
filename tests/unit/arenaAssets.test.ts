import { BoxGeometry, InstancedMesh, Matrix4, MeshStandardMaterial, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/core/random';
import { ARENA_ASSETS, arenaAssetRequest, FORT_MODEL } from '../../src/data/arenaAssets';
import { ARENAS, type ArenaId } from '../../src/data/arenas';
import { QUALITY_PRESETS } from '../../src/data/quality';
import { ScannedProps } from '../../src/modes/ScannedProps';
import type { PhysicsWorld } from '../../src/physics/PhysicsWorld';
import type { AssetLibrary, ModelPart } from '../../src/render/env/AssetLibrary';

const IDS = Object.keys(ARENAS) as ArenaId[];

/** Processed asset files on disk (keys only; nothing is loaded). */
const FILES = new Set(
  Object.keys(import.meta.glob('../../public/assets/{surfaces/*/*.webp,models/*.glb}')).map((k) =>
    k.replace('../../public/assets/', ''),
  ),
);

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
    }
  });
});

/** A library whose every model is a set of unit boxes (named like real nodes). */
function fakeLibrary(): AssetLibrary {
  const mat = new MeshStandardMaterial();
  const cache = new Map<string, ModelPart[]>();
  const make = (nodes: string[], size: [number, number, number]): ModelPart[] =>
    nodes.map((node) => {
      const geometry = new BoxGeometry(...size);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      return { node, geometry, material: mat, offset: new Vector3() };
    });
  return {
    model(id: string): readonly ModelPart[] {
      let parts = cache.get(id);
      if (parts === undefined) {
        parts =
          id === FORT_MODEL
            ? [
                ...make([`${id}_wall_thin_straight_01`], [2.5, 8.6, 14.8]),
                ...make([`${id}_tower_round`], [15.8, 13.5, 15.8]),
              ]
            : make([`${id}_a`, `${id}_b`], [0.8, 1, 0.6]);
        cache.set(id, parts);
      }
      return parts;
    },
  } as unknown as AssetLibrary;
}

function build(id: ArenaId): { props: ScannedProps; colliders: [number, number, number][] } {
  const def = ARENAS[id];
  const colliders: [number, number, number][] = [];
  const physics = {
    addStaticCylinder: (x: number, _y: number, z: number, _h: number, r: number) =>
      colliders.push([x, z, r]),
  } as unknown as PhysicsWorld;
  const keepOut: [number, number, number][] = [
    [def.spawn[0], def.spawn[2], 3.5],
    [def.bossSpawn[0], def.bossSpawn[1], 4],
    ...def.spawnPoints.map(([x, z]): [number, number, number] => [x, z, 2]),
  ];
  const props = new ScannedProps(
    fakeLibrary(),
    def,
    ARENA_ASSETS[id],
    physics,
    QUALITY_PRESETS.medium,
    mulberry32(7),
    keepOut,
  );
  props.build();
  return { props, colliders };
}

describe('scanned props', () => {
  for (const id of IDS) {
    it(`${id}: one instanced mesh per part, few draw calls, props kept off the fight`, () => {
      const def = ARENAS[id];
      const R = def.floorRadius;
      const { props, colliders } = build(id);
      expect(props.objects.length).toBeGreaterThan(5);
      // Every part is drawn once however many copies there are.
      expect(props.objects.length).toBeLessThan(80);
      const m = new Matrix4();
      const p = new Vector3();
      const brazierSpots = def.braziers.map((b) => [b.x, b.z] as const);
      const rockSpots = def.rocks.map((r) => [r.x, r.z] as const);
      for (const o of props.objects) {
        expect(o).toBeInstanceOf(InstancedMesh);
        const mesh = o as InstancedMesh;
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, m);
          p.setFromMatrixPosition(m);
          expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
          const d = Math.hypot(p.x, p.z);
          const placedByLayout = [...brazierSpots, ...rockSpots].some(
            ([x, z]) => Math.hypot(p.x - x, p.z - z) < 0.01,
          );
          // Dressing stays in the outer ring; braziers and outcrops keep their layout spots.
          if (!placedByLayout)
            expect(d, `${mesh.name} at ${d.toFixed(1)} m`).toBeGreaterThan(R * 0.5);
        }
      }
      // Solid props get colliders, none of them on a spawn point.
      expect(colliders.length).toBeGreaterThan(0);
      for (const [x, z] of def.spawnPoints)
        for (const [cx, cz, r] of colliders) expect(Math.hypot(x - cx, z - cz)).toBeGreaterThan(r);
      expect(props.flames.length).toBe(def.braziers.length);
      props.dispose();
      expect(props.objects.length).toBe(0);
    });
  }

  it('castle walls close the ring: enough kit pieces to go all the way round', () => {
    for (const id of IDS) {
      const c = ARENA_ASSETS[id].castle;
      if (c === undefined) continue;
      const def = ARENAS[id];
      const { props } = build(id);
      const wall = props.objects.find((o) => o.name.endsWith('wall_thin_straight_01')) as
        InstancedMesh | undefined;
      expect(wall, id).toBeDefined();
      const circumference = 2 * Math.PI * (def.floorRadius + def.wall.thickness / 2);
      expect((wall?.count ?? 0) * 14.8 * c.scale).toBeGreaterThanOrEqual(circumference);
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
