import { describe, expect, it } from 'vitest';
import { ARENA_ASSETS, type Structure } from '../../src/data/arenaAssets';
import { ARENAS, ARENA_IDS, ARENA_SCALE } from '../../src/data/arenas';
import { buildStructure } from '../../src/modes/structures';

const KINDS: Structure['kind'][] = [
  'arcade',
  'ruinWall',
  'obelisk',
  'stones',
  'ribs',
  'stalagmites',
  'tombs',
  'shrine',
];

describe('procedural architecture', () => {
  for (const kind of KINDS) {
    it(`${kind}: indexed, finite, standing on the ground, deterministic`, () => {
      const st: Structure = { kind, x: 3, z: -4, yaw: 30, ruined: 0.4, altar: true, seed: 9 };
      const a = buildStructure(st);
      expect(a.parts.length).toBeGreaterThan(0);
      for (const p of a.parts) {
        const g = p.geometry;
        expect(g.index).not.toBeNull();
        for (const name of ['position', 'normal', 'color'])
          expect(g.getAttribute(name), name).toBeDefined();
        expect(g.getAttribute('uv')).toBeUndefined();
        const pos = g.getAttribute('position');
        let minY = Infinity;
        for (let i = 0; i < pos.count; i++) {
          expect(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i))).toBe(true);
          minY = Math.min(minY, pos.getY(i));
        }
        // Rests on (or sinks into) the ground, never floats.
        expect(minY).toBeLessThanOrEqual(0.05);
        expect(minY).toBeGreaterThan(-3);
      }
      const b = buildStructure(st);
      expect(b.parts.map((p) => p.geometry.getAttribute('position').count)).toEqual(
        a.parts.map((p) => p.geometry.getAttribute('position').count),
      );
      for (const c of a.colliders) {
        expect(Number.isFinite(c.x + c.z + c.hx + c.hz + c.h + c.yaw)).toBe(true);
        expect(c.hx).toBeGreaterThan(0);
        expect(c.h).toBeGreaterThan(0);
      }
    });
  }

  it('scale grows the structure around its position', () => {
    const one = buildStructure({ kind: 'obelisk', x: 5, z: 5, seed: 1 });
    const two = buildStructure({ kind: 'obelisk', x: 5, z: 5, scale: 2, seed: 1 });
    const top = (s: typeof one): number => {
      let y = -Infinity;
      for (const p of s.parts) p.geometry.computeBoundingBox();
      for (const p of s.parts) y = Math.max(y, p.geometry.boundingBox?.max.y ?? -Infinity);
      return y;
    };
    expect(top(two)).toBeCloseTo(top(one) * 2, 3);
  });

  it('every arena has its own architecture, clear of the fight and the spawn points', () => {
    const kindsSeen = new Set<string>();
    for (const id of ARENA_IDS) {
      const def = ARENAS[id];
      const R = def.floorRadius;
      const list = ARENA_ASSETS[id].structures ?? [];
      expect(list.length, id).toBeGreaterThan(0);
      for (const st of list) kindsSeen.add(st.kind);
      const points: (readonly [number, number])[] = [
        ...def.spawnPoints,
        def.bossSpawn,
        def.dummySpawn,
        [def.spawn[0], def.spawn[2]],
      ];
      for (const st of list) {
        const built = buildStructure(st);
        for (const c of built.colliders) {
          // Footprint reach (conservative: the box's half diagonal).
          const reach = c.round ? c.hx : Math.hypot(c.hx, c.hz);
          const d0 = Math.hypot(c.x, c.z) - reach;
          expect(
            d0,
            `${id} ${st.kind} collider at ${c.x.toFixed(1)},${c.z.toFixed(1)}`,
          ).toBeGreaterThan(R * 0.45);
          for (const [x, z] of points)
            expect(
              Math.hypot(c.x - x, c.z - z) - reach,
              `${id} ${st.kind} near ${x},${z}`,
            ).toBeGreaterThan(0.8);
        }
      }
      // Built at the arena's scale.
      expect(def.floorRadius).toBeGreaterThan(20 * Math.min(1, ARENA_SCALE[id]));
    }
    // Not one kit everywhere.
    expect(kindsSeen.size).toBeGreaterThanOrEqual(6);
  });

  it('nothing tall stands between the camera and a hero at the south edge', () => {
    for (const id of ARENA_IDS) {
      const R = ARENAS[id].floorRadius;
      for (const st of ARENA_ASSETS[id].structures ?? []) {
        const built = buildStructure(st);
        for (const p of built.parts) {
          const pos = p.geometry.getAttribute('position');
          for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const z = pos.getZ(i);
            if (z > R * 0.55 && z < R + 9 && Math.abs(x) < R * 0.8)
              expect(
                pos.getY(i),
                `${id} ${st.kind} at ${x.toFixed(1)},${z.toFixed(1)}`,
              ).toBeLessThan(3.4);
          }
        }
      }
    }
  });
});
