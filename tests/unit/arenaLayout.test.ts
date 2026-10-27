import { describe, expect, it } from 'vitest';
import { findAdventureStage } from '../../src/data/adventure';
import { ARENA_ASSETS } from '../../src/data/arenaAssets';
import {
  ARENAS,
  ARENA_IDS,
  arenaOutline,
  insideOutline,
  outlineDistance,
  outlineEdges,
  wallBoxes,
  type WallBox,
} from '../../src/data/arenas';
import { CHALLENGE_CONFIG, DUNGEON_CONFIG, TOWER_CONFIG } from '../../src/data/modes';
import { CHAPTERS } from '../../src/data/stages';
import { challengeStage, towerStage } from '../../src/modes/meta';

/** Inside a wall box's footprint (with a little slack). */
function inBox(b: WallBox, x: number, z: number, slack = 0.02): boolean {
  const dx = x - b.x;
  const dz = z - b.z;
  const lx = dx * Math.cos(b.yaw) - dz * Math.sin(b.yaw);
  const lz = dx * Math.sin(b.yaw) + dz * Math.cos(b.yaw);
  return Math.abs(lx) <= b.halfLength + slack && Math.abs(lz) <= b.halfThickness + slack;
}

const NEW_ARENAS = ['gravewood', 'widows_pass', 'drowned_cloister'] as const;

describe('arena layouts', () => {
  for (const id of ARENA_IDS) {
    it(`${id}: the outline holds the fight circle and its walls seal every edge`, () => {
      const def = ARENAS[id];
      const R = def.floorRadius;
      expect(insideOutline(def, 0, 0)).toBe(true);
      expect(outlineDistance(def, 0, 0), 'fight circle inside the outline').toBeGreaterThanOrEqual(
        R - 0.01,
      );
      const boxes = wallBoxes(def);
      const t = def.wall.thickness;
      // Every point just outside every edge is inside a wall collider.
      for (const e of outlineEdges(def)) {
        const n = Math.ceil(e.length / 0.25);
        for (let i = 0; i <= n; i++) {
          const f = i / n;
          const x = e.a[0] + (e.b[0] - e.a[0]) * f + e.normal[0] * (t / 2);
          const z = e.a[1] + (e.b[1] - e.a[1]) * f + e.normal[1] * (t / 2);
          expect(
            boxes.some((b) => inBox(b, x, z)),
            `${id}: gap at ${x.toFixed(2)},${z.toFixed(2)}`,
          ).toBe(true);
        }
      }
      // Walking straight out from the centre in any direction always meets a wall.
      for (let k = 0; k < 360; k++) {
        const a = (k / 360) * Math.PI * 2;
        let hit = false;
        for (let r = 0; r < 80 && !hit; r += 0.1)
          hit = boxes.some((b) => inBox(b, Math.cos(a) * r, Math.sin(a) * r, 0));
        expect(hit, `${id}: open toward ${k}°`).toBe(true);
      }
    });

    it(`${id}: hero, dummy, boss and every spawn point stand clear inside the walls`, () => {
      const def = ARENAS[id];
      const points: (readonly [number, number])[] = [
        [def.spawn[0], def.spawn[2]],
        def.dummySpawn,
        def.bossSpawn,
        ...def.spawnPoints,
      ];
      // Footprints: circles (pillars, rocks, braziers) and boxes (blocks, solid built stone).
      const round = [
        ...def.pillars.map((p) => ({ x: p.x, z: p.z, r: p.radius })),
        ...def.rocks.map((k) => ({ x: k.x, z: k.z, r: k.scale * 0.95 })),
        ...def.braziers.map((b) => ({ x: b.x, z: b.z, r: 0.7 })),
      ];
      const boxes = [
        ...def.blocks.map((b) => ({
          x: b.position[0],
          z: b.position[2],
          hx: b.size[0] / 2,
          hz: b.size[2] / 2,
          yaw: (b.rotationYDeg * Math.PI) / 180,
        })),
        ...(ARENA_ASSETS[id].masses ?? [])
          .filter((m) => m.solid === true)
          .map((m) => ({
            x: m.x,
            z: m.z,
            hx: m.size[0] / 2,
            hz: m.size[2] / 2,
            yaw: ((m.yaw ?? 0) * Math.PI) / 180,
          })),
      ];
      for (const [x, z] of points) {
        expect(insideOutline(def, x, z, 1.5), `${id}: ${x},${z} inside`).toBe(true);
        for (const s of round)
          expect(Math.hypot(x - s.x, z - s.z), `${id}: ${x},${z} vs ${s.x},${s.z}`).toBeGreaterThan(
            s.r + 0.6,
          );
        for (const b of boxes) {
          const box: WallBox = {
            x: b.x,
            z: b.z,
            halfLength: b.hx,
            halfThickness: b.hz,
            yaw: b.yaw,
          };
          expect(inBox(box, x, z, 0.6), `${id}: ${x},${z} vs box at ${b.x},${b.z}`).toBe(false);
        }
      }
    });

    it(`${id}: built stone keeps out of the open fight circle`, () => {
      const def = ARENAS[id];
      for (const m of ARENA_ASSETS[id].masses ?? []) {
        if (m.solid !== true) continue;
        const r = Math.hypot(m.size[0], m.size[2]) / 2;
        expect(Math.hypot(m.x, m.z) + r, `${id}: mass at ${m.x},${m.z}`).toBeGreaterThan(
          def.floorRadius * 0.45,
        );
      }
      expect(arenaOutline(def).length).toBeGreaterThanOrEqual(6);
    });
  }
});

describe('arenas in the modes', () => {
  it('the tower climbs through every arena', () => {
    expect([...TOWER_CONFIG.arenas].sort()).toEqual([...ARENA_IDS].sort());
    const seen = new Set<string>();
    for (let f = 1; f <= ARENA_IDS.length; f++) seen.add(towerStage(f).arena);
    expect(seen.size).toBe(ARENA_IDS.length);
  });

  it('the new arenas host Adventure stages and dungeon rooms', () => {
    const adventure = new Set(CHAPTERS.slice(0, 4).flatMap((c) => c.stages.map((s) => s.arena)));
    const dungeon = new Set<string>(DUNGEON_CONFIG.rooms.map((r) => r.arena));
    for (const id of NEW_ARENAS) {
      expect(adventure.has(id), `${id} in chapters 1-4`).toBe(true);
      expect(dungeon.has(id), `${id} in the dungeon`).toBe(true);
    }
  });

  it('challenges and hunts fight a boss where Adventure met it', () => {
    for (const entry of CHALLENGE_CONFIG.bosses) {
      // Hand-made chapters and generated (endless) ones alike.
      const stage = findAdventureStage(entry.stage);
      expect(challengeStage(entry, 1).arena).toBe(stage?.arena ?? entry.arena);
    }
  });
});
