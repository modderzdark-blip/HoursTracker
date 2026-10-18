import { describe, expect, it } from 'vitest';
import { Cooldowns } from '../../src/combat/Cooldowns';
import { UltimateMeter } from '../../src/combat/UltimateMeter';

describe('Cooldowns', () => {
  it('blocks reuse until the cooldown elapses', () => {
    const c = new Cooldowns([1000, 2000]);
    expect(c.tryUse(0)).toBe(true);
    expect(c.tryUse(0)).toBe(false);
    c.tick(999);
    expect(c.isReady(0)).toBe(false);
    expect(c.fraction(0)).toBeCloseTo(0.001);
    c.tick(1);
    expect(c.tryUse(0)).toBe(true);
  });

  it('slots are independent and out-of-range slots fail safely', () => {
    const c = new Cooldowns([1000, 2000]);
    c.tryUse(1);
    expect(c.isReady(0)).toBe(true);
    expect(c.tryUse(5)).toBe(false);
    expect(c.tryUse(-1)).toBe(false);
  });

  it('never goes negative', () => {
    const c = new Cooldowns([500]);
    c.tryUse(0);
    c.tick(10_000);
    expect(c.remainingMs(0)).toBe(0);
  });
});

describe('UltimateMeter', () => {
  it('clamps to 1, ignores bad input, and consumes only when full', () => {
    const u = new UltimateMeter();
    u.add(0.6);
    expect(u.tryConsume()).toBe(false);
    u.add(Number.NaN);
    u.add(-1);
    expect(u.value).toBeCloseTo(0.6);
    u.add(5);
    expect(u.value).toBe(1);
    expect(u.tryConsume()).toBe(true);
    expect(u.value).toBe(0);
  });
});
