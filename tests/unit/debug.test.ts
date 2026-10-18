import { describe, expect, it } from 'vitest';
import { FrameStats } from '../../src/debug/FrameStats';
import { LogRing, stringifyArg } from '../../src/debug/LogCapture';
import { buildDebugReport } from '../../src/debug/report';
import type { DeviceInfo } from '../../src/debug/deviceInfo';

describe('LogRing', () => {
  it('keeps the newest entries in order and counts levels', () => {
    const r = new LogRing(3);
    for (let i = 0; i < 5; i++)
      r.push({ t: i, level: i % 2 === 0 ? 'error' : 'warn', message: `m${i}` });
    expect(r.entries().map((e) => e.message)).toEqual(['m2', 'm3', 'm4']);
    expect(r.errorCount).toBe(3);
    expect(r.warnCount).toBe(2);
    expect(r.length).toBe(3);
  });
});

describe('stringifyArg', () => {
  it('formats errors, primitives, objects and circular objects', () => {
    expect(stringifyArg(new Error('boom'))).toContain('Error: boom');
    expect(stringifyArg(3)).toBe('3');
    expect(stringifyArg({ a: 1 })).toBe('{"a":1}');
    const circ: Record<string, unknown> = {};
    circ['self'] = circ;
    expect(stringifyArg(circ)).toBe('[object Object]');
  });
});

describe('FrameStats', () => {
  it('computes fps, mean, max and p95 over the window', () => {
    const s = new FrameStats(10);
    for (let i = 0; i < 9; i++) s.push(16, 1);
    s.push(50, 3);
    expect(s.meanMs).toBeCloseTo(19.4);
    expect(s.maxMs).toBe(50);
    expect(s.percentileMs(95)).toBe(50);
    expect(s.percentileMs(50)).toBe(16);
    expect(s.lastSteps).toBe(3);
    // Window rolls: old spike falls out.
    for (let i = 0; i < 10; i++) s.push(16, 1);
    expect(s.maxMs).toBe(16);
    expect(s.fps).toBeCloseTo(62.5);
    expect(s.totalFrames).toBe(20);
  });
});

describe('buildDebugReport', () => {
  it('includes build, device, stats, settings and recent log lines', () => {
    const ring = new LogRing(10);
    ring.push({ t: 1.5, level: 'error', message: 'kaboom' });
    const device = { userAgent: 'UA', gpuRenderer: 'GPU' } as unknown as DeviceInfo;
    const text = buildDebugReport({
      build: { version: '0.1.0', sha: 'abc1234', time: 'now' },
      device,
      stats: 'FPS 60',
      settings: { quality: 'auto' },
      log: ring,
      maxEntries: 5,
    });
    expect(text).toContain('v0.1.0 (abc1234)');
    expect(text).toContain('gpuRenderer: GPU');
    expect(text).toContain('FPS 60');
    expect(text).toContain('"quality":"auto"');
    expect(text).toContain('[1.50s] ERROR kaboom');
  });
});
