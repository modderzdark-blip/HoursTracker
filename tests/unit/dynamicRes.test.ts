import { describe, expect, it } from 'vitest';
import {
  DYNAMIC_RES_CONFIG,
  DynamicResolution,
  dynamicResTargetMs,
} from '../../src/render/DynamicResolution';

const TARGET = 1000 / 60;

/** Plays one battle of `frames` frames at `ms` each and returns the next battle's scale. */
function battle(d: DynamicResolution, ms: number, frames = 1200): number {
  for (let i = 0; i < frames; i++) d.frame(ms);
  return d.settle(TARGET);
}

describe('dynamic resolution (between battles)', () => {
  it('keeps full resolution while the target is met', () => {
    const d = new DynamicResolution();
    expect(battle(d, 16.7)).toBe(1);
    expect(battle(d, 15)).toBe(1);
  });

  it('only changes when a battle ends, never during one', () => {
    const d = new DynamicResolution();
    for (let i = 0; i < 5000; i++) d.frame(40);
    // Nothing applied mid-fight: the scale moves only at settle().
    expect(d.scale).toBe(1);
    expect(d.settle(TARGET)).toBeLessThan(1);
  });

  it('lowers it for slow battles, by a bounded step, never below the floor', () => {
    const d = new DynamicResolution();
    const first = battle(d, 30);
    expect(first).toBeLessThan(1);
    expect(first).toBeGreaterThanOrEqual(1 - DYNAMIC_RES_CONFIG.maxStepDown - 1e-9);
    for (let i = 0; i < 20; i++) battle(d, 60);
    expect(d.scale).toBe(DYNAMIC_RES_CONFIG.min);
  });

  it('climbs back a step per smooth battle', () => {
    const d = new DynamicResolution();
    battle(d, 30);
    const low = d.scale;
    const next = battle(d, 10);
    expect(next).toBeCloseTo(Math.min(1, low + DYNAMIC_RES_CONFIG.stepUp), 5);
    for (let i = 0; i < 20; i++) battle(d, 10);
    expect(d.scale).toBe(1);
  });

  it('ignores short battles, hitches and discarded frames', () => {
    const d = new DynamicResolution();
    expect(battle(d, 40, DYNAMIC_RES_CONFIG.minFrames - 1)).toBe(1);
    expect(battle(d, 500)).toBe(1);
    for (let i = 0; i < 2000; i++) d.frame(40);
    d.discard();
    expect(d.settle(TARGET)).toBe(1);
  });

  it('aims for 60 FPS unless capped lower', () => {
    expect(dynamicResTargetMs(120)).toBeCloseTo(16.67, 1);
    expect(dynamicResTargetMs(0)).toBeCloseTo(16.67, 1);
    expect(dynamicResTargetMs(30)).toBeCloseTo(33.3, 1);
  });
});
