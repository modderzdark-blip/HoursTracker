import { describe, expect, it } from 'vitest';
import { Vector3, type BufferGeometry } from 'three';
import { mulberry32 } from '../../src/core/random';
import { ARENA_LOOKS } from '../../src/data/arenaLooks';
import { ARENAS, type ArenaDef, type ArenaId } from '../../src/data/arenas';
import { ArenaDresser } from '../../src/modes/arenaDressing';
import type { PhysicsWorld } from '../../src/physics/PhysicsWorld';
import {
  flakeGeometry,
  pebbleGeometry,
  scatter,
  shardGeometry,
  tuftGeometry,
} from '../../src/render/env/clutter';
import {
  colossusRibsGeometry,
  floatingSpireGeometry,
  mushroomClusterGeometry,
  portcullisGeometry,
  puddleGeometry,
  pylonGeometry,
  towerGeometry,
  volcanoGeometry,
} from '../../src/render/env/landmarks';
import { PropBatch } from '../../src/render/env/PropBatch';
import {
  angelStatueGeometry,
  archGeometry,
  bannerClothGeometry,
  barricadeGeometry,
  cageGeometry,
  candleClusterGeometry,
  chainGeometry,
  chunkGeometry,
  crystalClusterGeometry,
  deadTreeGeometry,
  femurGeometry,
  flagPoleGeometry,
  gargoyleGeometry,
  knightStatueGeometry,
  longBoneGeometry,
  ribcageGeometry,
  rootsGeometry,
  sarcophagusGeometry,
  skullGeometry,
  weaponRackGeometry,
} from '../../src/render/env/props';
import { lavaPoolGeometry, lavaRingGeometry } from '../../src/vfx/LavaSurface';

function check(g: BufferGeometry, maxTris: number): void {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const col = g.getAttribute('color');
  expect(pos).toBeDefined();
  expect(nor).toBeDefined();
  expect(col, 'baked occlusion in vertex colours').toBeDefined();
  for (let i = 0; i < pos.count; i++) {
    expect(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i))).toBe(true);
    expect(Number.isFinite(nor.getX(i) + nor.getY(i) + nor.getZ(i))).toBe(true);
    const ao = col.getX(i);
    expect(ao).toBeGreaterThanOrEqual(0);
    expect(ao).toBeLessThanOrEqual(1);
  }
  const tris = (g.getIndex()?.count ?? pos.count) / 3;
  expect(tris).toBeGreaterThan(1);
  expect(tris).toBeLessThan(maxTris);
  g.dispose();
}

describe('arena props and landmarks', () => {
  it('every prop geometry is valid, carries occlusion and stays within its triangle budget', () => {
    check(femurGeometry(), 900);
    check(longBoneGeometry(), 500);
    check(skullGeometry(3), 3000);
    check(skullGeometry(2), 1200);
    check(ribcageGeometry(), 2500);
    for (const d of ['none', 'head', 'arm', 'top'] as const)
      check(knightStatueGeometry(3, d), 7000);
    check(angelStatueGeometry(4, false), 7000);
    check(angelStatueGeometry(4, true), 7000);
    check(sarcophagusGeometry(5), 4000);
    check(archGeometry(6, false), 4000);
    check(archGeometry(6, true), 4000);
    check(cageGeometry(), 2500);
    check(chainGeometry([new Vector3(0, 3, 0), new Vector3(1, 2, 0), new Vector3(2, 3, 0)]), 2000);
    check(deadTreeGeometry(7), 6000);
    check(rootsGeometry(8), 2500);
    check(crystalClusterGeometry(9, 6, 2), 600);
    check(chunkGeometry(10), 200);
    check(towerGeometry(11, 4, 12), 12000);
    check(portcullisGeometry(4.6, 4.4), 4000);
    check(colossusRibsGeometry(12, 7, 7.5), 12000);
    check(
      puddleGeometry([
        [0, 0, 1],
        [3, 2, 1.5],
      ]),
      200,
    );
    const multi = [
      gargoyleGeometry(1),
      barricadeGeometry(2),
      weaponRackGeometry(3),
      candleClusterGeometry(4, 5),
      flagPoleGeometry(5, 6),
      floatingSpireGeometry(7, 11, 1.7),
      volcanoGeometry(8, 38, 34),
      mushroomClusterGeometry(9, 5),
      pylonGeometry(10, 9),
    ];
    for (const p of multi)
      for (const g of Object.values(p.parts)) if (g !== undefined) check(g, 8000);
    expect(candleClusterGeometry(4, 5).flames?.length).toBe(5);
  });

  it('a femur is about 0.46 m long and a skull about 0.22 m deep with its jaw below', () => {
    const f = femurGeometry();
    f.computeBoundingBox();
    const fb = f.boundingBox;
    expect((fb?.max.x ?? 0) - (fb?.min.x ?? 0)).toBeGreaterThan(0.4);
    expect((fb?.max.x ?? 0) - (fb?.min.x ?? 0)).toBeLessThan(0.52);
    const s = skullGeometry(3);
    s.computeBoundingBox();
    const sb = s.boundingBox;
    expect((sb?.max.z ?? 0) - (sb?.min.z ?? 0)).toBeGreaterThan(0.18);
    expect(sb?.min.y ?? 0).toBeLessThan(-0.09);
  });

  it('banner cloth carries the wind attribute (weight 0 at the fixed edge, 1 at the free edge)', () => {
    const g = bannerClothGeometry(1, 2);
    const c = g.getAttribute('aCloth');
    let min = 9;
    let max = -9;
    for (let i = 0; i < c.count; i++) {
      min = Math.min(min, c.getX(i));
      max = Math.max(max, c.getX(i));
    }
    expect(min).toBeCloseTo(0, 5);
    expect(max).toBeCloseTo(1, 5);
    g.computeBoundingBox();
    expect(g.boundingBox?.max.y ?? 1).toBeCloseTo(0, 5);
  });

  it('lava geometry is indexed with a shore weight in 0..1', () => {
    for (const g of [lavaPoolGeometry(3, 4, 1.5, 1), lavaRingGeometry(26, 30, 2)]) {
      const e = g.getAttribute('aEdge');
      for (let i = 0; i < e.count; i++) {
        expect(e.getX(i)).toBeGreaterThanOrEqual(0);
        expect(e.getX(i)).toBeLessThanOrEqual(1);
      }
      expect(g.getIndex()).not.toBeNull();
      g.dispose();
    }
  });
});

describe('ground clutter', () => {
  it('clutter shapes are tiny and valid', () => {
    check(pebbleGeometry(1), 24);
    check(shardGeometry(2), 24);
    check(tuftGeometry(3), 24);
    const flake = flakeGeometry();
    expect((flake.getIndex()?.count ?? 0) / 3).toBe(2);
  });

  it('scatter never places clutter inside the fight radius or a keep-out circle', () => {
    const out = scatter({
      count: 2000,
      clearRadius: 10,
      maxRadius: 24,
      keepOut: [[15, 0, 3]],
      rand: mulberry32(5),
      scale: [0.05, 0.2],
      tilt: 0.5,
      lift: 0.1,
      edgeBias: 1.5,
    });
    expect(out.length).toBeGreaterThan(1800);
    const p = new Vector3();
    for (const m of out) {
      p.setFromMatrixPosition(m);
      const r = Math.hypot(p.x, p.z);
      expect(r).toBeGreaterThanOrEqual(10 - 1e-6);
      expect(r).toBeLessThanOrEqual(24 + 1e-6);
      expect(Math.hypot(p.x - 15, p.z)).toBeGreaterThanOrEqual(3);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });
});

describe('arena dressing', () => {
  for (const id of Object.keys(ARENAS) as ArenaId[]) {
    it(`${id}: props merge cleanly, stay in budget and keep spawns and the centre clear`, () => {
      const def: ArenaDef = ARENAS[id];
      const colliders: [number, number, number][] = [];
      const physics = {
        addStaticCylinder: (x: number, _y: number, z: number, _h: number, r: number) =>
          colliders.push([x, z, r]),
        addStaticCuboid: (x: number, _y: number, z: number, hx: number, _hy: number, hz: number) =>
          colliders.push([x, z, Math.max(hx, hz)]),
        addStaticBall: (x: number, _y: number, z: number, r: number) => colliders.push([x, z, r]),
      } as unknown as PhysicsWorld;
      const R = def.floorRadius;
      const n = def.wall.segments;
      const wall = {
        heights: Array.from({ length: n }, () => def.wall.height * 0.8),
        buttresses: Array.from({ length: n / 2 }, (_, i) => {
          const a = ((i * 2 + 1) / n) * Math.PI * 2;
          return { x: Math.cos(a) * (R + 0.1), y: def.wall.height, z: Math.sin(a) * (R + 0.1), a };
        }),
        torchAngles: [],
      };
      const keepOut: [number, number, number][] = [
        [def.spawn[0], def.spawn[2], 3.5],
        [def.bossSpawn[0], def.bossSpawn[1], 4],
        [def.dummySpawn[0], def.dummySpawn[1], 2],
        ...def.spawnPoints.map(([x, z]): [number, number, number] => [x, z, 2]),
      ];
      const look = ARENA_LOOKS[id];
      const batch = new PropBatch();
      const dresser = new ArenaDresser(def, look, batch, physics, mulberry32(3), keepOut, wall);
      dresser.dress();
      let tris = 0;
      for (const v of batch.triangles.values()) tris += v;
      expect(tris, 'prop triangles').toBeLessThan(200_000);
      for (const kind of [
        'stone',
        'rock',
        'iron',
        'wood',
        'bone',
        'glow',
        'crystal',
        'cloth',
      ] as const) {
        const g = batch.merge(kind);
        if (g === null) continue;
        const pos = g.getAttribute('position');
        for (let i = 0; i < pos.count; i += 7) {
          expect(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i))).toBe(true);
        }
        if (kind === 'iron') expect(g.getAttribute('aSway')).toBeDefined();
        if (kind === 'cloth') expect(g.getAttribute('aCloth')).toBeDefined();
        g.dispose();
      }
      // Solid props stay clear of the spawn points, the boss and the dummy, and of the centre.
      for (const [x, z, r] of colliders) {
        for (const [kx, kz, kr] of keepOut) {
          expect(Math.hypot(x - kx, z - kz)).toBeGreaterThan(Math.min(kr, 2) * 0.9);
        }
        expect(Math.hypot(x, z) + r).toBeGreaterThan(R * 0.45);
      }
      expect(dresser.colliders).toBe(colliders.length);
      for (const p of dresser.pools) expect(Number.isFinite(p.x + p.z + p.radius)).toBe(true);
      expect(dresser.flames.every((f) => Number.isFinite(f.x + f.y + f.z + f.size))).toBe(true);
      // The landmark and the prop counts differ per arena.
      expect(dresser.floating !== null).toBe(look.landmark === 'floating_spire');
      for (const g of dresser.lava) g.dispose();
      batch.dispose();
    });
  }

  it('every arena has its own landmark', () => {
    const marks = new Set(Object.values(ARENA_LOOKS).map((l) => l.landmark));
    expect(marks.size).toBe(Object.keys(ARENAS).length);
  });
});
