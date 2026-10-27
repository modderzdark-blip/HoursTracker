import { describe, expect, it } from 'vitest';
import {
  DYNAMIC_RES_CONFIG,
  DynamicResolution,
  dynamicResTargetMs,
} from '../../src/render/DynamicResolution';

/** Feeds `ms` frames for about `windows` averaging windows; returns the changes seen. */
function run(d: DynamicResolution, ms: number, windows: number, targetMs = 16.7): number[] {
  const out: number[] = [];
  const frames = Math.ceil((DYNAMIC_RES_CONFIG.windowMs * windows) / ms);
  for (let i = 0; i < frames; i++) {
    const r = d.frame(ms, targetMs);
    if (r !== null) out.push(r);
  }
  return out;
}

describe('dynamic resolution', () => {
  it('holds full resolution while the target is met', () => {
    const d = new DynamicResolution();
    expect(run(d, 16.7, 10)).toEqual([]);
    expect(d.scale).toBe(1);
  });

  it('drops step by step when frames run long, never below the floor', () => {
    const d = new DynamicResolution();
    const changes = run(d, 40, 20);
    expect(changes[0]).toBeCloseTo(1 - DYNAMIC_RES_CONFIG.stepDown, 5);
    expect(d.scale).toBe(DYNAMIC_RES_CONFIG.min);
  });

  it('climbs back slowly once there is headroom', () => {
    const d = new DynamicResolution();
    run(d, 40, 4);
    expect(d.scale).toBeLessThan(1);
    const ups = run(d, 10, 200);
    expect(ups.length).toBeGreaterThan(1);
    // Never more than one small step at a time, and it ends back at full resolution.
    for (let i = 1; i < ups.length; i++)
      expect((ups[i] ?? 0) - (ups[i - 1] ?? 0)).toBeLessThanOrEqual(
        DYNAMIC_RES_CONFIG.stepUp + 1e-9,
      );
    expect(d.scale).toBe(1);
  });

  it('ignores hitches and resets', () => {
    const d = new DynamicResolution();
    expect(run(d, 500, 10)).toEqual([]);
    run(d, 40, 5);
    d.reset();
    expect(d.scale).toBe(1);
  });

  it('aims for 60 FPS unless capped lower', () => {
    expect(dynamicResTargetMs(120)).toBeCloseTo(16.67, 1);
    expect(dynamicResTargetMs(0)).toBeCloseTo(16.67, 1);
    expect(dynamicResTargetMs(30)).toBeCloseTo(33.3, 1);
  });
});
