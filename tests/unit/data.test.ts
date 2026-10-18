import { describe, expect, it } from 'vitest';
import { TEST_ARENA } from '../../src/data/arenas';
import { CAMERA_CONFIG, INPUT_CONFIG, LOOP_CONFIG } from '../../src/data/config';
import { HEROES } from '../../src/data/heroes';

describe('data sanity', () => {
  it('heroes have positive movement stats and 3 skills with cooldowns', () => {
    for (const h of Object.values(HEROES)) {
      expect(h.movement.moveSpeed).toBeGreaterThan(0);
      expect(h.movement.acceleration).toBeGreaterThan(0);
      expect(h.movement.deceleration).toBeGreaterThan(0);
      expect(h.skills).toHaveLength(3);
      for (const s of h.skills) expect(s.cooldownMs).toBeGreaterThan(0);
    }
  });

  it('arena props sit inside the wall ring and the spawn is clear of pillars', () => {
    const r = TEST_ARENA.floorRadius;
    for (const p of TEST_ARENA.pillars) expect(Math.hypot(p.x, p.z) + p.radius).toBeLessThan(r);
    for (const b of TEST_ARENA.blocks)
      expect(Math.hypot(b.position[0], b.position[2])).toBeLessThan(r);
    for (const k of TEST_ARENA.rocks) expect(Math.hypot(k.x, k.z)).toBeLessThan(r);
    const [sx, , sz] = TEST_ARENA.spawn;
    for (const p of TEST_ARENA.pillars)
      expect(Math.hypot(p.x - sx, p.z - sz)).toBeGreaterThan(p.radius + 1);
  });

  it('config values are in sane ranges', () => {
    expect(INPUT_CONFIG.bufferMs).toBe(150);
    expect(INPUT_CONFIG.joystick.deadZone).toBeGreaterThan(0);
    expect(INPUT_CONFIG.joystick.deadZone).toBeLessThan(0.5);
    expect(LOOP_CONFIG.logicHz).toBeGreaterThanOrEqual(30);
    expect(CAMERA_CONFIG.distance).toBeGreaterThan(0);
    expect(CAMERA_CONFIG.height).toBeGreaterThan(0);
  });
});
