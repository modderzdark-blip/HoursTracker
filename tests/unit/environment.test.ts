import { describe, expect, it } from 'vitest';
import type { BufferGeometry } from 'three';
import { ARENA_LOOKS } from '../../src/data/arenaLooks';
import { ARENAS, type ArenaId } from '../../src/data/arenas';
import {
  boneGeometry,
  cliffRingGeometry,
  columnGeometry,
  rockGeometry,
  skullGeometry,
  spireGeometry,
  stoneBlockGeometry,
} from '../../src/render/env/shapes';

function check(g: BufferGeometry, maxTris: number): void {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const col = g.getAttribute('color');
  expect(pos).toBeDefined();
  expect(nor).toBeDefined();
  expect(col, 'baked occlusion in vertex colours').toBeDefined();
  for (let i = 0; i < pos.count; i += 3) {
    expect(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i))).toBe(true);
    expect(Number.isFinite(nor.getX(i) + nor.getY(i) + nor.getZ(i))).toBe(true);
    const ao = col.getX(i);
    expect(ao).toBeGreaterThanOrEqual(0);
    expect(ao).toBeLessThanOrEqual(1);
  }
  const tris = (g.getIndex()?.count ?? pos.count) / 3;
  expect(tris).toBeGreaterThan(10);
  expect(tris).toBeLessThan(maxTris);
  g.dispose();
}

describe('environment shapes', () => {
  it('rocks, blocks, columns, spires, bones and skulls are valid and within budget', () => {
    check(rockGeometry(1, 4), 6000);
    check(rockGeometry(5, 2, 1.2), 600);
    check(stoneBlockGeometry(2), 1500);
    check(columnGeometry(3, false, 7, 0.8), 4000);
    check(columnGeometry(9, true, 2.6, 0.9), 4000);
    check(spireGeometry(4), 1200);
    check(boneGeometry(), 400);
    check(skullGeometry(), 1000);
    check(cliffRingGeometry(30, 16, 7, 128, 16), 9000);
  });

  it('columns keep base and capital proportions at any height', () => {
    for (const h of [2, 7]) {
      const g = columnGeometry(3, false, h, 0.8);
      g.computeBoundingBox();
      const box = g.boundingBox;
      expect(box?.max.y).toBeCloseTo(h, 1);
      // The base flare never exceeds 1.42 × the radius, whatever the height.
      expect(box?.max.x ?? 0).toBeLessThan(0.8 * 1.5);
      g.dispose();
    }
  });

  it('a broken column stops short of its nominal height', () => {
    const g = columnGeometry(9, true, 4, 0.9);
    g.computeBoundingBox();
    expect(g.boundingBox?.max.y ?? 99).toBeLessThan(4);
    g.dispose();
  });

  it('every arena has a look', () => {
    for (const id of Object.keys(ARENAS) as ArenaId[]) expect(ARENA_LOOKS[id]).toBeDefined();
  });
});
