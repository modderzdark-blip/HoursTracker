import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/core/EventBus';
import { FixedTimestep } from '../../src/core/FixedTimestep';
import { FrameLimiter } from '../../src/core/FrameLimiter';
import { GameClock } from '../../src/core/GameClock';
import { ServiceRegistry } from '../../src/core/ServiceRegistry';
import { TimeControl } from '../../src/core/TimeControl';

interface Ev {
  a: number;
  b: string;
}

describe('EventBus', () => {
  it('delivers typed payloads and unsubscribes', () => {
    const bus = new EventBus<Ev>();
    const fn = vi.fn();
    const off = bus.on('a', fn);
    bus.emit('a', 5);
    off();
    bus.emit('a', 6);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(5);
    expect(bus.listenerCount('a')).toBe(0);
  });

  it('handles removal of other handlers during emit without skipping', () => {
    const bus = new EventBus<Ev>();
    const calls: string[] = [];
    const second = (): void => {
      calls.push('second');
    };
    bus.on('a', () => {
      calls.push('first');
      bus.off('a', second);
    });
    bus.on('a', second);
    bus.on('a', () => calls.push('third'));
    bus.emit('a', 1);
    expect(calls).toEqual(['first', 'third']);
    bus.emit('a', 1);
    expect(calls).toEqual(['first', 'third', 'first', 'third']);
    expect(bus.listenerCount('a')).toBe(2);
  });

  it('once fires a single time', () => {
    const bus = new EventBus<Ev>();
    const fn = vi.fn();
    bus.once('b', fn);
    bus.emit('b', 'x');
    bus.emit('b', 'y');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('handlers added during emit run from the next emit', () => {
    const bus = new EventBus<Ev>();
    const late = vi.fn();
    bus.on('a', () => bus.on('a', late));
    bus.emit('a', 1);
    expect(late).not.toHaveBeenCalled();
    bus.emit('a', 2);
    expect(late).toHaveBeenCalledOnce();
  });
});

describe('ServiceRegistry', () => {
  it('registers, gets and rejects duplicates / missing', () => {
    const reg = new ServiceRegistry<{ x: number; y: string }>();
    reg.register('x', 3);
    expect(reg.get('x')).toBe(3);
    expect(() => reg.register('x', 4)).toThrow();
    expect(() => reg.get('y')).toThrow();
    expect(reg.tryGet('y')).toBeUndefined();
  });
});

describe('FixedTimestep', () => {
  const cfg = { stepHz: 60, maxSubSteps: 5, maxFrameMs: 250 };

  it('runs the right number of steps and carries the remainder', () => {
    const ts = new FixedTimestep(cfg);
    const step = vi.fn();
    expect(ts.advance(10, step)).toBe(0);
    expect(ts.advance(10, step)).toBe(1); // 20 ms accumulated → 1 step, 3.33 left
    expect(ts.alpha).toBeCloseTo(3.333 / 16.667, 2);
    expect(step).toHaveBeenCalledWith(1 / 60);
  });

  it('is frame-rate independent: 1 s of frames = 60 steps at any rate', () => {
    for (const fps of [30, 60, 90, 120, 144]) {
      const ts = new FixedTimestep(cfg);
      let steps = 0;
      for (let i = 0; i < fps; i++) steps += ts.advance(1000 / fps, () => undefined);
      expect(Math.abs(steps - 60)).toBeLessThanOrEqual(1);
    }
  });

  it('caps sub-steps and drops backlog (no spiral of death)', () => {
    const ts = new FixedTimestep(cfg);
    const steps = ts.advance(200, () => undefined);
    expect(steps).toBe(5);
    expect(ts.droppedMs).toBeGreaterThan(0);
    expect(ts.alpha).toBeLessThan(1);
  });

  it('clamps huge and negative deltas', () => {
    const ts = new FixedTimestep(cfg);
    expect(ts.advance(-50, () => undefined)).toBe(0);
    expect(ts.advance(10_000, () => undefined)).toBe(5);
  });
});

describe('TimeControl', () => {
  it('passes real time through by default', () => {
    expect(new TimeControl().advance(16)).toBe(16);
  });

  it('hit-stop freezes game time for exactly its duration in real time', () => {
    const t = new TimeControl();
    t.hitStop(80);
    expect(t.advance(50)).toBe(0);
    expect(t.isFrozen).toBe(true);
    expect(t.advance(50)).toBe(20); // 30 frozen + 20 normal
    expect(t.isFrozen).toBe(false);
  });

  it('overlapping hit-stops keep the longer one instead of stacking', () => {
    const t = new TimeControl();
    t.hitStop(60);
    t.hitStop(40);
    expect(t.advance(100)).toBe(40);
  });

  it('slow motion scales time then returns to normal', () => {
    const t = new TimeControl();
    t.slowMotion(0.25, 100);
    expect(t.advance(100)).toBeCloseTo(25);
    expect(t.advance(100)).toBeCloseTo(100);
  });

  it('hit-stop takes priority over slow motion', () => {
    const t = new TimeControl();
    t.slowMotion(0.5, 100);
    t.hitStop(50);
    expect(t.advance(100)).toBeCloseTo(25); // 50 frozen, then 50 × 0.5
  });
});

describe('FrameLimiter', () => {
  function renders(cap: number, hz: number, seconds: number, jitterMs = 0): number {
    const lim = new FrameLimiter(cap);
    let n = 0;
    const frames = hz * seconds;
    for (let i = 0; i < frames; i++) {
      const jitter = jitterMs * Math.sin(i * 12.9898);
      if (lim.shouldRender((i * 1000) / hz + jitter)) n++;
    }
    return n / seconds;
  }

  it('60 cap on a 60 Hz display renders every frame, even with vsync jitter', () => {
    expect(renders(60, 60, 5)).toBeCloseTo(60, 0);
    expect(renders(60, 60, 5, 1.2)).toBeGreaterThan(59);
  });

  it('30 cap on 60 Hz renders every other frame', () => {
    expect(renders(30, 60, 5)).toBeCloseTo(30, 0);
  });

  it('60 cap on 120 Hz / 90 Hz holds ~60', () => {
    expect(renders(60, 120, 5)).toBeCloseTo(60, 0);
    const at90 = renders(60, 90, 5);
    expect(at90).toBeGreaterThan(44);
    expect(at90).toBeLessThanOrEqual(61);
  });

  it('cap 0 is uncapped', () => {
    expect(renders(0, 120, 2)).toBe(120);
  });
});

describe('GameClock', () => {
  it('advances only by ticks', () => {
    const c = new GameClock();
    c.tick(1 / 60);
    c.tick(1 / 60);
    expect(c.nowMs).toBeCloseTo(33.333, 2);
  });
});
